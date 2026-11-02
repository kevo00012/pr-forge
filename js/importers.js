/* PR Forge — Fitbod CSV import. Pure functions, no DOM, no storage.
 * Expected columns: Date, Exercise, Reps, Weight(kg), Duration(s), Distance(m), Incline, Resistance, isWarmup, Note, multiplier.
 * Dates look like "2023-03-01 14:23:10 -0700". One calendar day becomes one workout. */
(function (root) {
  'use strict';

  var units = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./units.js')
    : root.PRF.units;

  // Fitbod names that word-matching can't connect to a curated exercise.
  var FITBOD_NAMES = {
    'lying hamstrings curl': 'lying-leg-curl',
    'machine leg press': 'leg-press',
    'cable face pull': 'face-pull',
    'cable rope tricep extension': 'rope-pushdown',
    'dumbbell row': 'db-row',
    'cable crossover fly': 'cable-fly',
    'barbell shoulder press': 'overhead-press',
    'dumbbell incline bench press': 'db-incline-press',
    'dumbbell bulgarian split squat': 'bulgarian-split-squat',
    'single leg cable kickback': 'cable-kickback',
    'dumbbell fly': 'db-fly',
    'dumbbell skullcrusher': 'skull-crusher',
    'dumbbell shoulder press': 'db-shoulder-press'
  };
  var EQUIPMENT_WORDS = { barbell: 1, dumbbell: 1, cable: 1, machine: 1, smith: 1, kettlebell: 1 };
  var SKIP_WORDS = { the: 1, with: 1, a: 1, on: 1 };

  /** Splits CSV text into rows of fields. Handles quotes, escaped quotes, CRLF and a byte-order mark. */
  function parseCsv(text) {
    var s = String(text).replace(/^﻿/, '');
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function words(name) {
    var seen = {};
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(function (w) {
      return w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;
    }).filter(function (w) {
      if (!w || SKIP_WORDS[w] || seen[w]) return false;
      seen[w] = true;
      return true;
    });
  }
  function signature(list) { return list.slice().sort().join(' '); }

  /** Builds a function from a Fitbod exercise name to a known exercise ID, or null. Curated exercises win. */
  function matcher(exercises) {
    var exact = {}, bare = {};
    var ordered = exercises.filter(function (e) { return !e.library; }).concat(exercises.filter(function (e) { return e.library; }));
    ordered.forEach(function (e) {
      [e.name, e.alias].forEach(function (n) {
        if (!n) return;
        var w = words(n), key = signature(w);
        if (!exact[key]) exact[key] = e.id;
        if (!e.library) {
          var b = signature(w.filter(function (x) { return !EQUIPMENT_WORDS[x]; }));
          if (!bare[b]) bare[b] = {};
          bare[b][e.id] = true;
        }
      });
    });
    var known = {};
    exercises.forEach(function (e) { known[e.id] = true; });
    return function (name) {
      var mapped = FITBOD_NAMES[String(name).toLowerCase().trim()];
      if (mapped && known[mapped]) return mapped;
      var w = words(name), key = signature(w);
      if (exact[key]) return exact[key];
      // "Back Squat" means "Back Squat (Barbell)" only when there's a single curated candidate.
      var ids = Object.keys(bare[signature(w.filter(function (x) { return !EQUIPMENT_WORDS[x]; }))] || {});
      return ids.length === 1 ? ids[0] : null;
    };
  }

  function column(header, re) {
    for (var i = 0; i < header.length; i++) if (re.test(header[i].trim())) return i;
    return -1;
  }
  function number(v) {
    var n = Number(String(v == null ? '' : v).trim());
    return isFinite(n) && n > 0 ? n : 0;
  }
  function parseDate(v) {
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(String(v).trim());
    if (!m) return null;
    var zone = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].length === 5 ? m[3].slice(0, 3) + ':' + m[3].slice(3) : m[3]) : '';
    var d = new Date(m[1] + 'T' + m[2] + zone);
    return isNaN(d) ? null : { day: m[1], time: d.getTime() };
  }

  /**
   * Turns a Fitbod export into workouts ready to store, in `targetUnit`.
   * options: { exercises, targetUnit, uid, batchId, existingKeys: {sourceKey:true} }
   * Throws a readable Error when the file isn't a Fitbod export.
   */
  function parseFitbod(text, options) {
    var rows = parseCsv(text);
    if (!rows.length) throw new Error('This file is empty.');
    var header = rows[0];
    var col = {
      date: column(header, /^date$/i), exercise: column(header, /^exercise$/i), reps: column(header, /^reps$/i),
      weight: column(header, /^weight/i), seconds: column(header, /^duration/i), warm: column(header, /^is ?warm-?up$/i)
    };
    var missing = ['date', 'exercise', 'reps', 'weight'].filter(function (k) { return col[k] < 0; });
    if (missing.length) throw new Error('This doesn’t look like a Fitbod export (no ' + missing.join(', ') + ' column).');
    var sourceUnit = /lb/i.test(header[col.weight]) ? 'lb' : 'kg';
    var match = matcher(options.exercises);
    var days = {}, customs = {}, stats = { sets: 0, skipped: 0, duplicateDays: 0, matched: {}, created: {} };
    var duplicates = {};

    rows.slice(1).forEach(function (r) {
      var when = parseDate(r[col.date]);
      var name = String(r[col.exercise] || '').trim();
      var reps = Math.round(number(r[col.reps]));
      var seconds = col.seconds >= 0 ? Math.round(number(r[col.seconds])) : 0;
      if (!when || !name || (!reps && !seconds)) { stats.skipped++; return; }
      var key = 'fitbod:' + when.day;
      if (options.existingKeys && options.existingKeys[key]) { duplicates[key] = true; return; }

      var id = match(name);
      if (id) stats.matched[name] = true;
      else {
        stats.created[name] = true;
        if (!customs[name]) {
          customs[name] = {
            id: 'c-' + options.uid(), name: name.slice(0, 80), muscle: 'Other', equipment: 'Other',
            side: /\b(one|single)[- ]arm/i.test(name) ? 'arm' : /\b(one|single)[- ]leg|lunge|split squat|step[- ]?up/i.test(name) ? 'leg' : '',
            custom: true, importBatch: options.batchId
          };
        }
        id = customs[name].id;
      }

      var day = days[key] || (days[key] = { key: key, first: when.time, last: when.time, order: [], entries: {} });
      day.first = Math.min(day.first, when.time);
      day.last = Math.max(day.last, when.time);
      if (!day.entries[id]) { day.entries[id] = { id: options.uid(), exerciseId: id, sets: [] }; day.order.push(id); }
      var weight = number(r[col.weight]);
      var converted = weight ? units.roundForEntry(units.convert(weight, sourceUnit, options.targetUnit)) : 0;
      var tracking = reps ? (converted ? 'weight' : 'bodyweight') : 'timed';
      day.entries[id].sets.push({
        id: options.uid(), weight: reps ? converted : 0, reps: reps || null, seconds: reps ? null : seconds,
        done: true, warmup: col.warm >= 0 && /^(true|1|yes)$/i.test(String(r[col.warm]).trim()), tracking: tracking
      });
      stats.sets++;
    });

    var workouts = Object.keys(days).map(function (k) {
      var d = days[k];
      return {
        id: options.uid(), name: 'Fitbod workout', templateId: null, unit: options.targetUnit,
        startedAt: new Date(d.first).toISOString(), endedAt: new Date(Math.max(d.last, d.first + 60000)).toISOString(),
        imported: true, importBatch: options.batchId, sourceKey: d.key,
        exercises: d.order.map(function (id) {
          var e = d.entries[id];
          e.tracking = e.sets[e.sets.length - 1].tracking;
          return e;
        })
      };
    }).sort(function (a, b) { return new Date(a.startedAt) - new Date(b.startedAt); });

    stats.duplicateDays = Object.keys(duplicates).length;
    return {
      workouts: workouts,
      customs: Object.keys(customs).map(function (k) { return customs[k]; }),
      stats: {
        workouts: workouts.length, sets: stats.sets, skipped: stats.skipped, duplicateDays: stats.duplicateDays,
        matched: Object.keys(stats.matched).length, created: Object.keys(stats.created).sort()
      }
    };
  }

  var api = { parseCsv: parseCsv, parseFitbod: parseFitbod };
  root.PRF = root.PRF || {};
  root.PRF.importers = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
