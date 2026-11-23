/* PR Forge — saved data (browser localStorage) plus backup export/import.
 * The phone's copy is the working copy; js/sync.js copies it to the person's cloud account. */
(function (root) {
  'use strict';

  var KEY = 'pr-forge:web:v1';
  var SCHEMA = 1;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      schema: SCHEMA,
      settings: { unit: 'lb', restSeconds: 90, barLb: 45, barKg: 20, exerciseTypes: {}, exerciseSides: {}, pinned: [], rpe: false, theme: 'dark', setupDone: false },
      customExercises: [],
      bodyWeights: [],
      templates: [],
      workouts: [],
      imports: [],
      active: null
    };
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  var TRACKING = ['weight', 'bodyweight', 'weighted', 'assisted', 'timed'];
  function trackingOrNull(v) { return TRACKING.indexOf(v) !== -1 ? v : null; }
  function posOr(v, fallback) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function cleanSet(s) {
    var out = {
      id: String(s.id || uid()),
      weight: numOrNull(s.weight),
      reps: numOrNull(s.reps),
      seconds: numOrNull(s.seconds),
      done: !!s.done,
      warmup: !!s.warmup
    };
    if (trackingOrNull(s.tracking)) out.tracking = s.tracking;
    var rpe = Number(s.rpe);
    if (s.rpe != null && s.rpe !== '' && rpe >= 1 && rpe <= 10) out.rpe = Math.round(rpe * 2) / 2;
    return out;
  }

  /** Body weight log: [{ id, date (ISO), weight, unit }], oldest first, believable values only. */
  function cleanBodyWeights(list) {
    return arr(list).filter(function (b) {
      if (!isObj(b) || !b.date || isNaN(new Date(b.date))) return false;
      var w = Number(b.weight), kg = b.unit === 'kg';
      return isFinite(w) && w >= (kg ? 20 : 45) && w <= (kg ? 400 : 900);
    }).map(function (b) {
      return { id: String(b.id || uid()), date: new Date(b.date).toISOString(), weight: Math.round(Number(b.weight) * 10) / 10, unit: b.unit === 'kg' ? 'kg' : 'lb' };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /** Rep target { min, max } (whole reps 1–100), or null. */
  function cleanTarget(t) {
    if (!isObj(t)) return null;
    var a = Math.round(Number(t.min)), b = Math.round(Number(t.max));
    if (!isFinite(a) || !isFinite(b) || a < 1 || b > 100 || a > b) return null;
    return { min: a, max: b };
  }

  function cleanWorkout(w) {
    if (!isObj(w) || !w.startedAt || isNaN(new Date(w.startedAt))) return null;
    var out = {
      id: String(w.id || uid()),
      name: String(w.name || 'Workout'),
      templateId: w.templateId ? String(w.templateId) : null,
      startedAt: new Date(w.startedAt).toISOString(),
      endedAt: w.endedAt && !isNaN(new Date(w.endedAt)) ? new Date(w.endedAt).toISOString() : null,
      unit: w.unit === 'kg' ? 'kg' : 'lb',
      exercises: arr(w.exercises).filter(function (e) { return isObj(e) && e.exerciseId; }).map(function (e) {
        var entry = { id: String(e.id || uid()), exerciseId: String(e.exerciseId), sets: arr(e.sets).filter(isObj).map(cleanSet) };
        if (trackingOrNull(e.tracking)) entry.tracking = e.tracking;
        var tg = cleanTarget(e.target);
        if (tg) entry.target = tg;
        if (e.superNext) entry.superNext = true;
        return entry;
      })
    };
    if (w.edited) out.edited = true;
    if (w.imported) out.imported = true;
    if (w.importBatch) out.importBatch = String(w.importBatch);
    if (w.sourceKey) out.sourceKey = String(w.sourceKey);
    if (!out.endedAt && w.lastSetAt && !isNaN(new Date(w.lastSetAt))) out.lastSetAt = new Date(w.lastSetAt).toISOString(); // workout in progress only
    return out;
  }

  /** Accepts anything; returns a valid state (unknown fields dropped). Throws if it isn't PR Forge data. */
  function normalise(raw) {
    if (!isObj(raw) || !('workouts' in raw || 'templates' in raw)) {
      throw new Error('This file is not a PR Forge backup.');
    }
    var d = defaults();
    var st = isObj(raw.settings) ? raw.settings : {};
    d.settings.unit = st.unit === 'kg' ? 'kg' : 'lb';
    var rest = Number(st.restSeconds);
    d.settings.restSeconds = isFinite(rest) && rest >= 0 && rest <= 600 ? Math.round(rest) : 90;
    d.settings.barLb = posOr(st.barLb, 45);
    d.settings.barKg = posOr(st.barKg, 20);
    if (isObj(st.exerciseTypes)) {
      Object.keys(st.exerciseTypes).forEach(function (id) {
        if (trackingOrNull(st.exerciseTypes[id])) d.settings.exerciseTypes[id] = st.exerciseTypes[id];
      });
    }
    // Your choice of "one arm / one leg at a time / both together" for an exercise; a label only, never a number.
    if (isObj(st.exerciseSides)) {
      Object.keys(st.exerciseSides).forEach(function (id) {
        var v = st.exerciseSides[id];
        if (v === 'arm' || v === 'leg' || v === 'both') d.settings.exerciseSides[id] = v;
      });
    }

    d.customExercises = arr(raw.customExercises).filter(function (e) { return isObj(e) && e.id && e.name; }).map(function (e) {
      var ex = {
        id: String(e.id), name: String(e.name).slice(0, 80),
        muscle: String(e.muscle || 'Other'), equipment: String(e.equipment || 'Other'),
        side: e.side === 'arm' || e.side === 'leg' ? e.side : '', custom: true
      };
      if (trackingOrNull(e.tracking)) ex.tracking = e.tracking;
      if (e.importBatch) ex.importBatch = String(e.importBatch);
      return ex;
    });
    d.templates = arr(raw.templates).filter(function (t) { return isObj(t) && t.id; }).map(function (t) {
      return {
        id: String(t.id), name: String(t.name || 'Workout').slice(0, 60),
        exercises: arr(t.exercises).filter(function (e) { return isObj(e) && e.exerciseId; }).map(function (e) {
          var n = Math.round(Number(e.sets));
          var out = { exerciseId: String(e.exerciseId), sets: isFinite(n) && n >= 1 && n <= 20 ? n : 3 };
          var tg = cleanTarget(e.reps);
          if (tg) out.reps = tg;
          if (e.superNext) out.superNext = true;
          return out;
        })
      };
    });
    d.workouts = arr(raw.workouts).map(cleanWorkout).filter(function (w) { return w && w.endedAt; });
    var active = raw.active ? cleanWorkout(raw.active) : null;
    d.active = active && !active.endedAt ? active : null;
    d.imports = arr(raw.imports).filter(function (b) { return isObj(b) && b.id; }).map(function (b) {
      return { id: String(b.id), source: String(b.source || 'Fitbod'), at: String(b.at || ''), workouts: Number(b.workouts) || 0 };
    });
    // Anyone who already has data has clearly got past the welcome screen.
    // Lifts pinned to the top of Progress, in the order pinned (at most 8, no repeats).
    d.settings.pinned = arr(st.pinned).map(String).filter(function (id, i, a) { return id && a.indexOf(id) === i; }).slice(0, 8);
    d.settings.rpe = st.rpe === true;
    d.settings.theme = st.theme === 'light' || st.theme === 'system' ? st.theme : 'dark';
    d.bodyWeights = cleanBodyWeights(raw.bodyWeights);
    d.settings.setupDone = st.setupDone === true || d.workouts.length > 0 || d.templates.length > 0 || !!d.active;
    return d;
  }

  function load(storage) {
    storage = storage || root.localStorage;
    try {
      var text = storage.getItem(KEY);
      if (!text) return defaults();
      return normalise(JSON.parse(text));
    } catch (e) {
      // Keep the unreadable copy so nothing is lost, then start clean.
      try { storage.setItem(KEY + ':unreadable:' + Date.now(), storage.getItem(KEY)); } catch (e2) { /* ignore */ }
      return defaults();
    }
  }

  function save(state, storage) {
    storage = storage || root.localStorage;
    try {
      storage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportBackup(state, now) {
    var copy = JSON.parse(JSON.stringify(state));
    copy.app = 'PR Forge';
    copy.exportedAt = (now || new Date()).toISOString();
    return JSON.stringify(copy, null, 2);
  }

  /** Parse a backup file's text. Throws a readable Error if it's not usable. */
  function parseBackup(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
    return normalise(raw);
  }

  var api = {
    KEY: KEY, uid: uid, defaults: defaults, normalise: normalise, cleanWorkout: cleanWorkout,
    load: load, save: save, exportBackup: exportBackup, parseBackup: parseBackup
  };

  root.PRF = root.PRF || {};
  root.PRF.store = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
