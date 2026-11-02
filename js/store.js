/* PR Forge — saved data (browser localStorage) plus backup export/import.
 * Everything lives on the device; there is no account and no server. */
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
      settings: { unit: 'lb', restSeconds: 90 },
      customExercises: [],
      templates: [],
      workouts: [],
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

  function cleanSet(s) {
    return {
      id: String(s.id || uid()),
      weight: numOrNull(s.weight),
      reps: numOrNull(s.reps),
      done: !!s.done,
      warmup: !!s.warmup
    };
  }

  function cleanWorkout(w) {
    if (!isObj(w) || !w.startedAt || isNaN(new Date(w.startedAt))) return null;
    return {
      id: String(w.id || uid()),
      name: String(w.name || 'Workout'),
      templateId: w.templateId ? String(w.templateId) : null,
      startedAt: new Date(w.startedAt).toISOString(),
      endedAt: w.endedAt && !isNaN(new Date(w.endedAt)) ? new Date(w.endedAt).toISOString() : null,
      unit: w.unit === 'kg' ? 'kg' : 'lb',
      exercises: arr(w.exercises).filter(function (e) { return isObj(e) && e.exerciseId; }).map(function (e) {
        return { id: String(e.id || uid()), exerciseId: String(e.exerciseId), sets: arr(e.sets).filter(isObj).map(cleanSet) };
      })
    };
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

    d.customExercises = arr(raw.customExercises).filter(function (e) { return isObj(e) && e.id && e.name; }).map(function (e) {
      return {
        id: String(e.id), name: String(e.name).slice(0, 80),
        muscle: String(e.muscle || 'Other'), equipment: String(e.equipment || 'Other'),
        side: e.side === 'arm' || e.side === 'leg' ? e.side : '', custom: true
      };
    });
    d.templates = arr(raw.templates).filter(function (t) { return isObj(t) && t.id; }).map(function (t) {
      return {
        id: String(t.id), name: String(t.name || 'Workout').slice(0, 60),
        exercises: arr(t.exercises).filter(function (e) { return isObj(e) && e.exerciseId; }).map(function (e) {
          var n = Math.round(Number(e.sets));
          return { exerciseId: String(e.exerciseId), sets: isFinite(n) && n >= 1 && n <= 20 ? n : 3 };
        })
      };
    });
    d.workouts = arr(raw.workouts).map(cleanWorkout).filter(function (w) { return w && w.endedAt; });
    var active = raw.active ? cleanWorkout(raw.active) : null;
    d.active = active && !active.endedAt ? active : null;
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
    KEY: KEY, uid: uid, defaults: defaults, normalise: normalise,
    load: load, save: save, exportBackup: exportBackup, parseBackup: parseBackup
  };

  root.PRF = root.PRF || {};
  root.PRF.store = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
