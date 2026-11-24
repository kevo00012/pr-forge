/* PR Forge — cloud sync rules (no network code here; js/cloud.js supplies the remote).
 *
 * The phone's copy is the working copy, so logging never waits for the internet.
 * A sync run pulls what changed in the cloud since last time, merges it, then pushes local changes.
 *
 *  - Finished workouts are one cloud row each. Deleting one leaves a "deleted" row so other phones delete it too.
 *  - Settings, saved workouts, custom exercises and import history are one "profile" row.
 *  - The workout in progress stays on the phone until it is finished.
 *  - "shadow" remembers a fingerprint of each workout as last synced, which tells us what changed locally.
 *    If a workout changed both here and in the cloud, this phone's version wins.
 *  - "profileBase" is the profile as last agreed with the cloud. When the profile changed both here and on another
 *    device, it is merged item by item against that base (routines, custom exercises, imports and body weights by id;
 *    settings field by field), so neither device's changes are lost. Only an item changed on both sides takes this
 *    phone's version.
 */
(function (root) {
  'use strict';

  var ST = root.PRF && root.PRF.store;
  if (!ST && typeof require === 'function') ST = require('./store.js');

  /** FNV-1a, 32-bit. A fingerprint for change detection, not security. */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36) + ':' + str.length.toString(36);
  }

  function cleanW(w) {
    var c = w ? ST.cleanWorkout(w) : null;
    return c && c.endedAt ? c : null;
  }
  function workoutHash(w) { var c = cleanW(w); return c ? hash(JSON.stringify(c)) : undefined; }

  function profileOf(state) {
    var n = ST.normalise({
      settings: state.settings, customExercises: state.customExercises,
      templates: state.templates, imports: state.imports, bodyWeights: state.bodyWeights, workouts: []
    });
    n.settings.setupDone = !!(state.settings && state.settings.setupDone);
    return { settings: n.settings, customExercises: n.customExercises, templates: n.templates, imports: n.imports, bodyWeights: n.bodyWeights };
  }
  function profileHash(state) { return hash(JSON.stringify(profileOf(state))); }

  function emptyMeta() { return { userId: null, email: '', lastPulled: null, shadow: {}, profileHash: null, profileSeen: null, profileBase: null, lastSyncAt: null }; }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isMap(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  /**
   * Three-way merge of a list of items with ids. base = as last synced; local = this phone; remote = the cloud.
   * Changed on one side only → that side's version. New on either side → kept. Deleted on one side and untouched
   * on the other → deleted. Edited on one side and deleted on the other → kept (an edit means it's wanted).
   * Changed on both → this phone's version.
   */
  function mergeList(base, local, remote) {
    var B = byId(base || []), R = byId(remote), out = [], done = {};
    local.forEach(function (x) {
      done[x.id] = true;
      var r = R[x.id], b = B[x.id];
      if (r) out.push(b && same(x, b) ? r : x);
      else if (!b || !same(x, b)) out.push(x);
    });
    remote.forEach(function (r) {
      if (done[r.id]) return;
      var b = B[r.id];
      if (!b || !same(r, b)) out.push(r);
    });
    return out;
  }
  /** Field by field: a field this phone didn't change takes the cloud's value. Maps (e.g. logging types) go key by key. */
  function mergeFields(base, local, remote) {
    var out = {};
    var keys = Object.keys(local).concat(Object.keys(remote).filter(function (k) { return !(k in local); }));
    keys.forEach(function (k) {
      var l = local[k], r = remote[k], b = base ? base[k] : undefined;
      var v = isMap(l) && isMap(r) ? mergeFields(isMap(b) ? b : {}, l, r) : (k in local) && !same(l, b) ? l : r;
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

  /** Number of local items that haven't reached the cloud yet. */
  function pendingCount(state, meta) {
    var n = 0, seen = {};
    state.workouts.forEach(function (w) {
      var h = workoutHash(w);
      if (!h) return;
      seen[w.id] = true;
      if (meta.shadow[w.id] !== h) n++;
    });
    Object.keys(meta.shadow).forEach(function (id) { if (!seen[id]) n++; });
    if (meta.profileHash !== profileHash(state)) n++;
    return n;
  }

  function byId(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  function union(local, remote) {
    var have = byId(local);
    return local.concat(remote.filter(function (x) { return !have[x.id]; }));
  }

  /** Merge pulled workout rows into state. Returns true if the state changed. */
  function mergeWorkouts(state, meta, rows) {
    var changed = false;
    rows.forEach(function (row) {
      var id = String(row.id);
      var idx = -1;
      for (var i = 0; i < state.workouts.length; i++) if (state.workouts[i].id === id) { idx = i; break; }
      var local = idx === -1 ? null : state.workouts[idx];
      var localChanged = workoutHash(local) !== meta.shadow[id];
      if (localChanged) return; // this phone's version wins; the push sends it up
      if (row.deleted) {
        if (idx !== -1) { state.workouts.splice(idx, 1); changed = true; }
        delete meta.shadow[id];
        return;
      }
      var incoming = cleanW(row.data);
      if (!incoming) return;
      incoming.id = id;
      var h = workoutHash(incoming);
      if (h !== workoutHash(local)) {
        if (idx === -1) state.workouts.push(incoming); else state.workouts[idx] = incoming;
        changed = true;
      }
      meta.shadow[id] = h;
    });
    rows.forEach(function (row) {
      if (row.updated_at && (!meta.lastPulled || row.updated_at > meta.lastPulled)) meta.lastPulled = row.updated_at;
    });
    return changed;
  }

  /** Merge the pulled profile row into state. Returns true if the state changed. */
  function mergeProfile(state, meta, remote) {
    if (!remote || !remote.data || remote.updated_at === meta.profileSeen) return false;
    var before = profileHash(state);
    var incoming;
    try {
      var d = remote.data;
      incoming = profileOf({ settings: d.settings || {}, customExercises: d.customExercises || [], templates: d.templates || [], imports: d.imports || [], bodyWeights: d.bodyWeights || [] });
      incoming.settings.setupDone = !!(d.settings && d.settings.setupDone);
    } catch (e) { return false; }
    meta.profileSeen = remote.updated_at;

    if (meta.profileHash !== null && before !== meta.profileHash && meta.profileBase) {
      // Changed here and on another device since the last sync: merge item by item, then push the result.
      var base = meta.profileBase, mine = profileOf(state);
      state.settings = mergeFields(base.settings, mine.settings, incoming.settings);
      state.settings.setupDone = !!(mine.settings.setupDone || incoming.settings.setupDone);
      state.customExercises = mergeList(base.customExercises, mine.customExercises, incoming.customExercises);
      state.templates = mergeList(base.templates, mine.templates, incoming.templates);
      state.imports = mergeList(base.imports, mine.imports, incoming.imports);
      state.bodyWeights = mergeList(base.bodyWeights, mine.bodyWeights, incoming.bodyWeights).sort(byDate);
      meta.profileBase = incoming;
    } else if (meta.profileHash === null || before !== meta.profileHash) {
      // First sync on this phone, or changed on both sides by an app that kept no base copy: keep everything from both.
      var firstTime = meta.profileHash === null;
      // First sync on this phone: keep everything from both sides.
      var setup = incoming.settings.setupDone || state.settings.setupDone;
      var types = Object.assign({}, incoming.settings.exerciseTypes, state.settings.exerciseTypes);
      if (firstTime) state.settings = incoming.settings; // later on, this phone's settings stand
      state.settings.setupDone = setup;
      state.settings.exerciseTypes = types;
      state.customExercises = union(state.customExercises, incoming.customExercises);
      state.templates = union(state.templates, incoming.templates);
      state.imports = union(state.imports, incoming.imports);
      state.bodyWeights = union(state.bodyWeights || [], incoming.bodyWeights).sort(byDate);
      meta.profileBase = incoming;
    } else {
      // Unchanged here since the last sync, so take the cloud's version.
      state.settings = incoming.settings;
      state.customExercises = incoming.customExercises;
      state.templates = incoming.templates;
      state.imports = incoming.imports;
      state.bodyWeights = incoming.bodyWeights;
      meta.profileHash = profileHash(state);
      meta.profileBase = incoming;
    }
    return profileHash(state) !== before;
  }

  /** Rows and profile to upload. */
  function changesToPush(state, meta) {
    var rows = [], seen = {};
    state.workouts.forEach(function (w) {
      var c = cleanW(w);
      if (!c) return;
      seen[c.id] = true;
      var h = hash(JSON.stringify(c));
      if (meta.shadow[c.id] !== h) rows.push({ id: c.id, data: c, deleted: false, hash: h });
    });
    Object.keys(meta.shadow).forEach(function (id) {
      if (!seen[id]) rows.push({ id: id, data: {}, deleted: true, hash: null });
    });
    var ph = profileHash(state);
    return { rows: rows, profile: ph !== meta.profileHash ? profileOf(state) : null, profileHash: ph };
  }

  /**
   * One sync run. remote = { pullWorkouts(since), pushWorkouts(rows), getProfile(), putProfile(data) }, all returning promises.
   * Resolves to { changed } (true if local data changed and should be saved and shown).
   */
  function run(state, meta, remote) {
    var changed = false;
    return remote.pullWorkouts(meta.lastPulled).then(function (rows) {
      if (mergeWorkouts(state, meta, rows || [])) changed = true;
      return remote.getProfile();
    }).then(function (prof) {
      if (mergeProfile(state, meta, prof)) changed = true;
      var out = changesToPush(state, meta);
      var steps = Promise.resolve();
      if (out.rows.length) {
        steps = steps.then(function () {
          return remote.pushWorkouts(out.rows.map(function (r) { return { id: r.id, data: r.data, deleted: r.deleted }; }));
        }).then(function () {
          out.rows.forEach(function (r) { if (r.deleted) delete meta.shadow[r.id]; else meta.shadow[r.id] = r.hash; });
        });
      }
      if (out.profile) {
        steps = steps.then(function () { return remote.putProfile(out.profile); }).then(function (res) {
          meta.profileHash = out.profileHash;
          meta.profileBase = out.profile;
          if (res && res.updated_at) meta.profileSeen = res.updated_at;
        });
      }
      return steps;
    }).then(function () {
      return { changed: changed };
    }, function (err) {
      if (err && typeof err === 'object') err.changed = changed; // a pull may have merged before the failure
      throw err;
    });
  }

  var api = {
    hash: hash, workoutHash: workoutHash, profileOf: profileOf, profileHash: profileHash, emptyMeta: emptyMeta,
    mergeList: mergeList, mergeFields: mergeFields, pendingCount: pendingCount, mergeWorkouts: mergeWorkouts, mergeProfile: mergeProfile, changesToPush: changesToPush, run: run
  };
  root.PRF = root.PRF || {};
  root.PRF.sync = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
