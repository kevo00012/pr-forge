/* PR Forge — Fitbod CSV import and pasted workout plans. Pure functions, no DOM, no storage.
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

  // ---------- Pasted workout plans (e.g. one written by Claude) ----------

  var ABBREV = [[/\bdb\b/g, 'dumbbell'], [/\bbb\b/g, 'barbell'], [/\bkb\b/g, 'kettlebell'], [/\bohp\b/g, 'overhead press'],
    [/\brdls?\b/g, 'romanian deadlift'], [/\bpull[- ]?ups\b/g, 'pull up'], [/\bchin[- ]?ups\b/g, 'chin up'], [/\bpush[- ]?ups\b/g, 'push up'],
    [/\bdips\b/g, 'dip'], [/\bfl(?:y|i)es\b/g, 'fly'], [/\bpulldowns\b/g, 'pulldown'], [/\bpushdowns\b/g, 'pushdown']];
  var MUSCLE_WORDS = /\b(biceps?|triceps?|bicep|tricep|chest|quad|quads|hamstring|hamstrings|calf|calves|glute|glutes|shoulder|lat|lats)\b/g;

  // Plain names a plan often uses that have no single obvious match in the list.
  var PLAN_NAMES = { 'calf raise': 'standing-calf-raise', 'lunge': 'walking-lunge', 'shoulder press': 'db-shoulder-press', 'row': 'barbell-row', 'leg curl': 'lying-leg-curl' };
  var EQUIP_RE = /\b(barbell|dumbbell|cable|machine|smith|kettlebell)\b/;

  /** Tries the name as written, then with common gym abbreviations expanded, then without muscle words ("bicep curl"), then as the barbell version. */
  function planMatcher(exercises) {
    var m = matcher(exercises);
    var byId = {}, plainNames = {};
    exercises.forEach(function (e) { byId[e.id] = e; });
    Object.keys(PLAN_NAMES).forEach(function (k) { plainNames[signature(words(k))] = PLAN_NAMES[k]; });
    return function (name) {
      var n = String(name).toLowerCase();
      var plain = plainNames[signature(words(n))];
      if (plain && byId[plain]) return plain;
      var wanted = EQUIP_RE.exec(n.replace(/\bdb\b/, 'dumbbell').replace(/\bbb\b/, 'barbell'));
      var tries = [n];
      var expanded = ABBREV.reduce(function (t, r) { return t.replace(r[0], r[1]); }, n);
      tries.push(expanded);
      tries.push(expanded.replace(MUSCLE_WORDS, ' ').replace(/\s+/g, ' ').trim());
      // "Bench press" with no equipment named: the barbell version is what people usually mean.
      if (!/\b(barbell|dumbbell|cable|machine|smith|kettlebell|band|bodyweight|ez|trap)\b/.test(expanded)) tries.push('barbell ' + tries[2]);
      for (var i = 0; i < tries.length; i++) {
        if (!tries[i]) continue;
        var id = m(tries[i]);
        if (!id) continue;
        if (i === 3 && byId[id].library) continue;                                   // the barbell guess only counts for the main list
        if (wanted && String(byId[id].equipment).toLowerCase().indexOf(wanted[1]) === -1) continue; // "cable fly" isn't the dumbbell fly
        return id;
      }
      return null;
    };
  }

  // "4x8", "3 × 8-10", "3 sets of 10", "3 sets x 12 reps", "4 sets, 6–8 reps", "3x30s", "3 x AMRAP"
  var SETS_RE = /(\d{1,2})\s*(?:sets?\s*)?(?:[x×*]|sets?\s+of|sets?\s*[,:–—-]?\s*(?=\d))\s*(\d{1,3}(?:\s*[-–—]\s*\d{1,3})?|amrap|max|failure)?\s*(?:reps?|s\b|sec(?:onds?)?\b)?/i;

  function cleanLine(line) {
    return String(line)
      .replace(/\*\*|__|`/g, '')                         // markdown bold / code
      .replace(/^\s*(?:#{1,6}|[-*•●▪◦>]+|\d{1,2}[.)]|[a-z]\d{1,2}[.):]?)\s+/i, '') // headings, bullets, "1.", "A1."
      .replace(/\s+/g, ' ')
      .trim();
  }
  function tidyName(n) {
    return n.replace(/\([^)]*\)/g, ' ').replace(/[–—:|,;]+\s*$/, '').replace(/^[–—:|,;\-\s]+/, '').replace(/\s+[-–—]\s*$/, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Turns pasted text into saved-workout drafts.
   * Returns { workouts: [{ name, exercises: [{ name, exerciseId|null, sets, reps }] }], skipped: [lines] }.
   * A line with sets ("Bench press 4x8") is an exercise; a short line without them ("Upper Body", "Day 2: Pull") starts
   * a new workout; a line that is just a known exercise name gets 3 sets; anything else (warm-up notes, rest times) is skipped.
   */
  function parseWorkoutText(text, options) {
    var match = planMatcher(options.exercises);
    var workouts = [], skipped = [];
    var cur = null;
    function start(name) { cur = { name: name, exercises: [] }; workouts.push(cur); }
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = cleanLine(raw);
      if (!line) return;
      if (/^\|?\s*:?-{3,}/.test(line)) return;                    // markdown table divider
      var name = null, sets = null, reps = '';
      if (line.indexOf('|') !== -1) {                             // markdown table row: | Exercise | Sets | Reps |
        var cells = line.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
        var nameCell = cells.filter(function (c) { return /[a-z]/i.test(c) && !/^(\d+\s*[-–]\s*)?\d+\s*(reps?|s|sec)?$/i.test(c); })[0];
        var nums = cells.filter(function (c) { return /^\d/.test(c); });
        if (!nameCell || /^(exercise|movement|sets?|reps?|rest|notes?)$/i.test(nameCell)) return;
        if (nums.length) { name = nameCell; sets = parseInt(nums[0], 10); reps = nums[1] || ''; }
        else line = nameCell;
      }
      if (name === null) {
        var m = SETS_RE.exec(line);
        if (m && (m[2] || /sets?/i.test(m[0]))) {
          sets = parseInt(m[1], 10);
          reps = m[2] ? m[2].replace(/\s+/g, '') : '';
          name = tidyName(line.slice(0, m.index)) || tidyName(line.slice(m.index + m[0].length).replace(/^\s*(?:reps?)?\s*/, ''));
        }
      }
      if (name !== null) {
        if (!name) { skipped.push(line); return; }
        if (/^(warm[- ]?up|cool[- ]?down|rest|stretch)/i.test(name) && !match(name)) { skipped.push(line); return; }
        if (!cur) start('');
        cur.exercises.push({ name: name.slice(0, 80), exerciseId: match(name), sets: Math.min(20, Math.max(1, sets || 3)), reps: reps });
        return;
      }
      var bare = tidyName(line);
      var id = bare && bare.split(' ').length <= 6 ? match(bare) : null;
      if (id) { if (!cur) start(''); cur.exercises.push({ name: bare, exerciseId: id, sets: 3, reps: '' }); return; }
      var words = bare.split(' ').length;
      var looksLikeTitle = words <= 6 && !/[.!?]$/.test(bare) && !/^(warm|cool|rest|note|tip|perform|do |aim|focus|superset)/i.test(bare);
      if (looksLikeTitle) {
        var title = bare.replace(/^(day|workout|session)\s*\d+\s*[:–—-]\s*/i, '').replace(/\s*[:–—-]\s*$/, '').trim() || bare;
        var dayHeading = /^(day|workout|session|week)\s*\d/i.test(bare);
        if (!cur || cur.exercises.length) start(title.slice(0, 60));
        else if (!cur.name || dayHeading) cur.name = title.slice(0, 60); // "Day 1: Upper" beats a document title above it
        return;
      }
      skipped.push(line);
    });
    return { workouts: workouts.filter(function (w) { return w.exercises.length; }), skipped: skipped };
  }

  /**
   * Rebuilds lines of text from PDF.js text items ({ str, transform: [a, b, c, d, x, y], width, height }).
   * Items on the same baseline become one line, left to right; a wide gap (a table column) becomes " | ".
   */
  function pdfItemsToText(items) {
    var lines = [];
    items.forEach(function (it) {
      if (!it || typeof it.str !== 'string' || !it.str.trim() || !it.transform) return; // blank items would hide column gaps
      var x = it.transform[4], y = it.transform[5], h = Math.abs(it.height || it.transform[3]) || 10;
      var line = null;
      for (var i = 0; i < lines.length; i++) if (Math.abs(lines[i].y - y) <= h * 0.5) { line = lines[i]; break; }
      if (!line) { line = { y: y, h: h, parts: [] }; lines.push(line); }
      line.parts.push({ x: x, w: it.width || 0, s: it.str });
    });
    lines.sort(function (a, b) { return b.y - a.y; });
    return lines.map(function (l) {
      l.parts.sort(function (a, b) { return a.x - b.x; });
      var out = '', end = null;
      l.parts.forEach(function (p) {
        if (end !== null) {
          var gap = p.x - end;
          if (gap > l.h * 1.5) out += ' | ';
          else if (gap > l.h * 0.15 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += ' ';
        }
        out += p.s;
        end = p.x + p.w;
      });
      return out.replace(/\s+/g, ' ').trim();
    }).filter(Boolean).join('\n');
  }

  /** A CSV of exercises (any columns) as table rows the plan reader understands. Refuses a Fitbod history export. */
  function csvToPlanText(text) {
    var rows = parseCsv(text);
    if (rows.length && column(rows[0], /^date$/i) >= 0 && column(rows[0], /^exercise$/i) >= 0 && column(rows[0], /^reps$/i) >= 0) {
      throw new Error('This is a Fitbod history export. Use Settings → Import from Fitbod for it.');
    }
    return rows.map(function (r) { return '| ' + r.join(' | ') + ' |'; }).join('\n');
  }

  var api = { parseCsv: parseCsv, parseFitbod: parseFitbod, parseWorkoutText: parseWorkoutText, pdfItemsToText: pdfItemsToText, csvToPlanText: csvToPlanText };
  root.PRF = root.PRF || {};
  root.PRF.importers = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
