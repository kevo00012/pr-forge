/* PR Forge — web app UI.
 * Plain JavaScript, no build step. State lives in `S` (saved to localStorage);
 * view state lives in `V` (not saved). Clicks are handled by one delegated
 * listener using data-act attributes. */
(function () {
  'use strict';

  var U = PRF.units, M = PRF.metrics, ST = PRF.store, EX = PRF.exercises, P = PRF.plates, IM = PRF.importers, CLOUD = PRF.cloud;
  var VERSION = '2.2.0';

  var S = ST.load();
  var V = {
    tab: 'home',          // home | workouts | progress | history
    screen: null,         // null | 'workout' | 'template' | 'historyDetail' | 'editWorkout' | 'lift'
    historyId: null,
    tplDraft: null,       // { id|null, name, exercises: [{exerciseId, sets}] }
    picker: null,         // { target: 'workout'|'template'|'swap'|'edit', q, muscle, selected: {} }
    edit: null,           // { draft, original } while changing a past workout
    liftId: null,         // exercise shown on the lift detail screen
    liftRange: '3m',      // exercise page chart: '6w' | '3m' | '1y' | 'all' (kept while the app is open)
    typeEntry: null,      // workout entry whose logging type is being chosen
    rest: null,           // { endsAt, total }
    prShown: {},          // set id -> "weight x reps" that showed a PR banner
    prMoment: null,       // the full-screen PR panel being shown (see buildPrMoment)
    focusEntry: null,     // exercise opened by tap; otherwise the first with sets left
    summary: null,        // id of the workout just finished (shows "Workout saved")
    modal: null,          // { resolve }
    greeted: false        // answered the first-open question (this visit only)
  };
  var app = document.getElementById('app');
  var lastViewKey = '';

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return ST.uid(); }
  function unit() { return S.settings.unit; }
  function save() {
    if (!ST.save(S)) toast('Couldn’t save — this browser’s storage may be full. Export a backup.', 'warn');
    CLOUD.changed();
  }
  function commit() { save(); render(); }

  var builtInMap = {};
  EX.BUILT_IN.forEach(function (e) { builtInMap[e.id] = e; });
  function allExercises() { return EX.BUILT_IN.concat(S.customExercises); }
  function exById(id) {
    var ex = baseExercise(id);
    var pick = S.settings.exerciseSides && S.settings.exerciseSides[id];
    if (!pick) return ex;
    var copy = Object.assign({}, ex);
    copy.side = pick === 'both' ? '' : pick;
    return copy;
  }
  function baseExercise(id) {
    if (builtInMap[id]) return builtInMap[id];
    for (var i = 0; i < S.customExercises.length; i++) if (S.customExercises[i].id === id) return S.customExercises[i];
    return { id: id, name: 'Unknown exercise', muscle: 'Other', equipment: 'Other', side: '' };
  }
  var SIDE_OPTS = [
    { v: 'both', label: 'Both sides together', hint: 'Two dumbbells or a bar, like most hammer curls. Enter the weight of one dumbbell.' },
    { v: 'arm', label: 'One arm at a time', hint: 'Reps counted per arm, like concentration curls. Shows "Per arm".' },
    { v: 'leg', label: 'One leg at a time', hint: 'Reps counted per leg, like split squats. Shows "Per leg".' }
  ];
  /** Lets you say whether a lift is done one side at a time. Only the label changes; no number is doubled or halved. */
  function sidesModal(id) {
    var ex = exById(id), current = ex.side === 'arm' ? 'arm' : ex.side === 'leg' ? 'leg' : 'both';
    V.modal = { resolve: null };
    openModal('<h2>One side at a time?</h2><p class="muted small">For ' + esc(ex.name) + '. Changes the label everywhere, past workouts included. Weights, reps and volume stay as you logged them.</p><div class="type-list">' +
      SIDE_OPTS.map(function (o) {
        return '<button class="type-opt' + (o.v === current ? ' on' : '') + '" data-act="ex-side-set" data-id="' + esc(id) + '" data-v="' + o.v + '" aria-pressed="' + (o.v === current) + '"><strong>' + o.label + '</strong><span class="muted small">' + o.hint + '</span></button>';
      }).join('') + '</div><button class="btn ghost block" data-act="modal-cancel">Cancel</button>');
  }
  function sideLabel(ex) { return ex.side === 'arm' ? 'Per arm' : ex.side === 'leg' ? 'Per leg' : ''; }

  function parseNum(v) {
    if (v === null || v === undefined) return null;
    var t = String(v).replace(',', '.').trim();
    if (t === '') return null;
    if (!/^\d*\.?\d*$/.test(t)) return null; // plain numbers only: no "1e5", no hex
    var n = Number(t);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function relDay(iso) {
    var d = new Date(iso);
    var diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric',
      year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function agoText(iso) {
    if (!iso) return 'Not done yet';
    var diff = Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 86400000);
    if (diff <= 0) return 'Last done today';
    if (diff === 1) return 'Last done yesterday';
    return 'Last done ' + diff + ' days ago';
  }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }
  /** Duration for a finished workout. Imports often have no real duration (one timestamp per day). */
  function workoutDuration(wk) {
    var mins = (new Date(wk.endedAt) - new Date(wk.startedAt)) / 60000;
    if (wk.imported && !(mins >= 10 && mins <= 300)) return null;
    return durationText(wk.startedAt, wk.endedAt);
  }
  function durationText(a, b) {
    var mins = Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000));
    return mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
  }
  function w(lb) { return U.fmtWeightLb(lb, unit()); }
  function vol(lb) { return U.fmtVolumeLb(lb, unit()); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

  var ICONS = {
    home: '<path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>',
    workouts: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    progress: '<path d="M4 20h16M6 15.5l4-4.5 3.5 3L19 7"/>',
    history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
    more: '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
    file: '<path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5z"/><path d="M13.5 3.5V8h4M9 13h6M9 16.5h6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    layers: '<path d="M12 4.5 4 8.5l8 4 8-4z"/><path d="M4 12.5l8 4 8-4M4 16.5l8 4 8-4"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
    flat: '<path d="M5 12h14"/>',
    hold: '<path d="M6 9.5h12M6 14.5h12"/>',
    pause: '<path d="M9 6.5v11M15 6.5v11"/>',
    bars: '<path d="M6 18.5v-4M12 18.5v-9M18 18.5v-13"/>',
    fall: '<path d="M4 6.5l6 6 3.5-3.5L20 15.5M20 10.5v5h-5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /** Last-8-sessions bars, newest on the right. Heights show the shape of the trend, not zero-based size. */
  function bars(values, lastCls, label, tall) {
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = max - min;
    var html = '';
    for (var b = values.length; b < 8; b++) html += '<span class="blank"></span>';
    values.forEach(function (v, i) {
      var h = span ? 35 + (63 * (v - min)) / span : 70;
      html += '<span' + (i === values.length - 1 ? ' class="' + lastCls + '"' : '') + ' style="height:' + h.toFixed(1) + '%"></span>';
    });
    return '<div class="bars' + (tall ? ' tall' : '') + '" role="img" aria-label="' + esc(label) + '">' + html + '</div>';
  }

  /** "12.8k" over 10,000, otherwise "5,185". The unit goes in the label under the number. */
  function volNum(lb, u) {
    var v = Math.round(U.fromLb(lb, u));
    return v >= 10000 ? U.fmtNum(v / 1000) + 'k' : v.toLocaleString('en-US');
  }
  /** Saved-workout row: "3 × 195 lb" from last session's first working set, or "3 sets". */
  function planText(exerciseId, sets, u, excludeWorkoutId) {
    var last = M.lastSessionFor(S.workouts, exerciseId, excludeWorkoutId);
    var hasWorking = last && last.sets.some(function (s) { return !s.warmup; });
    var hint = hasWorking ? M.hintFor(last, 0, u, false) : null;
    if (hint && hint.seconds) return sets + ' × ' + hint.seconds + ' sec';
    if (hint && hint.weight > 0) return sets + ' × ' + WEIGHT_SIGN[exKind(exerciseId)] + U.fmtNum(hint.weight) + ' ' + u;
    return sets + ' set' + (sets === 1 ? '' : 's');
  }
  /** "Last time 3 × 5 @ 195 lb" when every working set matched, otherwise the top set. */
  function lastTimeText(last, u, kind) {
    if (!last) return '';
    var count = last.sets.filter(function (s) { return !s.warmup; }).length;
    if (!count) return '';
    var hints = [];
    for (var i = 0; i < count; i++) hints.push(M.hintFor(last, i, u, false));
    var first = hints[0];
    var same = hints.every(function (h) { return h.weight === first.weight && h.reps === first.reps && h.seconds === first.seconds; });
    var sign = WEIGHT_SIGN[kind] || '';
    if (first.seconds && same) return 'Last time ' + count + ' × ' + first.seconds + ' sec';
    if (same) return 'Last time ' + count + ' × ' + first.reps + (first.weight > 0 ? ' @ ' + sign + U.fmtNum(first.weight) + ' ' + u : '');
    if (first.seconds) return 'Last time up to ' + Math.max.apply(null, hints.map(function (h) { return h.seconds || 0; })) + ' sec';
    var top = hints.reduce(function (a, h) { return h.weight > a.weight || (h.weight === a.weight && h.reps > a.reps) ? h : a; });
    return 'Last time top set ' + (top.weight > 0 ? sign + U.fmtNum(top.weight) + ' ' + u + ' × ' + top.reps : top.reps + ' reps');
  }
  function bestText(exerciseId, u, excludeWorkoutId) {
    var e = 0, reps = 0, seconds = 0, assist = null;
    M.sessionsFor(S.workouts, exerciseId, excludeWorkoutId).forEach(function (s) {
      e = Math.max(e, s.topE1rm);
      reps = Math.max(reps, s.maxBwReps);
      seconds = Math.max(seconds, s.maxSeconds);
      if (s.leastAssistLb !== null) assist = assist === null ? s.leastAssistLb : Math.min(assist, s.leastAssistLb);
    });
    if (e > 0) return 'Best ' + Math.round(U.fromLb(e, u));
    if (seconds > 0) return 'Best ' + seconds + ' sec';
    if (assist !== null) return 'Best −' + Math.round(U.fromLb(assist, u));
    return reps > 0 ? 'Best ' + reps + ' reps' : '';
  }

  // ---------- how an exercise is logged ----------
  var WEIGHT_SIGN = { weight: '', bodyweight: '', weighted: '+', assisted: '−', timed: '' };
  function trackingLabel(kind) {
    for (var i = 0; i < EX.TRACKING.length; i++) if (EX.TRACKING[i].id === kind) return EX.TRACKING[i].label;
    return EX.TRACKING[0].label;
  }
  /** The type chosen for this lift before, otherwise its default. */
  function exKind(exerciseId) { return S.settings.exerciseTypes[exerciseId] || EX.defaultTracking(exById(exerciseId)); }
  function entryKind(entry) { return entry.tracking || 'weight'; }
  /** "195 × 5", "+25 × 8", "−40 × 8", "45 sec" or "8 reps". */
  function setText(s) {
    if (s.tracking === 'timed' || (Number(s.seconds) > 0 && !(Number(s.reps) > 0))) return U.fmtNum(s.seconds) + ' sec';
    var rpe = s.rpe != null ? ' @' + U.fmtNum(s.rpe) : '';
    if (Number(s.weight) > 0) return (WEIGHT_SIGN[s.tracking] || '') + U.fmtNum(s.weight) + ' × ' + U.fmtNum(s.reps) + rpe;
    return U.fmtNum(s.reps) + ' reps' + rpe;
  }

  // ---------- plate calculator ----------
  function barFor(u) { return u === 'kg' ? S.settings.barKg : S.settings.barLb; }
  function plateChips(list) {
    var sizes = list.filter(function (p, i) { return list.indexOf(p) === i; });
    return '<span class="plate-chips">' + list.map(function (p) {
      return '<span class="plate-chip p' + Math.min(sizes.indexOf(p), 2) + '">' + U.fmtNum(p) + '</span>';
    }).join('') + '</span>';
  }
  function platesInner(weight, u) {
    var bar = barFor(u);
    var plan = P.calculate(weight, bar, P.PLATES[u]);
    if (!plan) return '';
    if (plan.lessThanBar) return '<span>Less than the ' + U.fmtNum(bar) + ' ' + u + ' bar</span>';
    if (plan.exact) {
      return plan.perSide.length ? '<span>Each side of a ' + U.fmtNum(bar) + ' ' + u + ' bar</span>' + plateChips(plan.perSide)
        : '<span>Just the ' + U.fmtNum(bar) + ' ' + u + ' bar</span>';
    }
    return '<span>Can’t load that exactly. Closest: ' + U.fmtNum(plan.below) + ' or ' + U.fmtNum(plan.above) + ' ' + u + '. For ' + U.fmtNum(plan.below) + ', each side:</span>' +
      (plan.belowPlates.length ? plateChips(plan.belowPlates) : '<span>no plates</span>');
  }

  /** One set's row. opts: { scope: 'active'|'edit', u, hint, active, n, side, kind } */
  function numInput(field, entry, s, opts, label, placeholder, value, mode) {
    return '<span class="cell"><input class="num" data-scope="' + opts.scope + '" data-field="' + field + '" data-e="' + entry.id + '" data-s="' + s.id + '" inputmode="' + mode + '" autocomplete="off" aria-label="' + label + ', set ' + opts.n + '"' +
      ' placeholder="' + placeholder + '" value="' + (value != null ? U.fmtNum(value) : '') + '">' +
      (opts.isPr ? '<span class="pr-tag">PR</span>' : '') + '</span>';
  }
  function setRowHtml(entry, s, opts) {
    var kind = opts.kind, hint = opts.hint, sideLow = opts.side ? ' ' + opts.side.toLowerCase() : '';
    var inputs;
    if (kind === 'timed') {
      inputs = numInput('seconds', entry, s, opts, 'Seconds' + sideLow, hint && hint.seconds ? hint.seconds : '', s.seconds, 'numeric');
    } else if (kind === 'bodyweight') {
      inputs = numInput('reps', entry, s, opts, 'Reps' + sideLow, hint ? hint.reps || '' : '', s.reps, 'numeric');
    } else {
      var weightLabel = (kind === 'assisted' ? 'Assistance' : kind === 'weighted' ? 'Added weight' : 'Weight') + ' (' + opts.u + ')';
      inputs = numInput('weight', entry, s, opts, weightLabel, hint && hint.weight > 0 ? U.fmtNum(hint.weight) : '', s.weight, 'decimal') +
        '<span class="x" aria-hidden="true">×</span>' +
        numInput('reps', entry, s, { scope: opts.scope, n: opts.n }, 'Reps' + sideLow, hint ? hint.reps || '' : '', s.reps, 'numeric');
    }
    var single = kind === 'timed' || kind === 'bodyweight';
    var rpeOn = S.settings.rpe && kind !== 'timed';
    if (rpeOn) inputs += '<span class="cell rpe-cell"><input class="num rpe-in" data-scope="' + opts.scope + '" data-field="rpe" data-e="' + entry.id + '" data-s="' + s.id + '" inputmode="decimal" autocomplete="off" aria-label="RPE (how hard, 1 to 10), set ' + opts.n + '" placeholder="–" value="' + (s.rpe != null ? U.fmtNum(s.rpe) : '') + '"></span>';
    var warmAct = opts.scope === 'edit' ? 'edit-set-warm' : 'set-warmup';
    var endButton = opts.scope === 'edit'
      ? '<button class="check" data-act="edit-set-remove" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="Delete set ' + opts.n + '">' + icon('close') + '</button>'
      : '<button class="check' + (s.done ? ' on' : '') + '" data-act="set-toggle" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="' + (s.done ? 'Unconfirm set ' : 'Confirm set ') + opts.n + '" aria-pressed="' + (s.done ? 'true' : 'false') + '">' + icon('check') + '</button>';
    return '<div class="set-row' + (single ? ' one' : '') + (rpeOn ? ' rpe' : '') + (s.done && opts.scope !== 'edit' ? ' done' : '') + (s.warmup ? ' warm' : '') + (opts.active ? ' active' : '') + '">' +
      '<button class="set-n" data-act="' + warmAct + '" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="Set ' + opts.n + (s.warmup ? ', warm-up' : '') + '. Tap to toggle warm-up">' + (s.warmup ? 'W' : opts.workIdx) + '</button>' +
      inputs + endButton + '</div>';
  }
  function setHeadHtml(kind, u, side) {
    var sideTag = side ? ' <span class="head-side">' + side.toLowerCase() + '</span>' : '';
    if (kind === 'timed') return '<div class="set-row head one"><span>Set</span><span>Seconds' + sideTag + '</span><span></span></div>';
    var r = S.settings.rpe;
    if (kind === 'bodyweight') return '<div class="set-row head one' + (r ? ' rpe' : '') + '"><span>Set</span><span>Reps' + sideTag + '</span>' + (r ? '<span>RPE</span>' : '') + '<span></span></div>';
    return '<div class="set-row head' + (r ? ' rpe' : '') + '"><span>Set</span><span>' + WEIGHT_SIGN[kind] + u + '</span><span></span><span>Reps' + sideTag + '</span>' + (r ? '<span>RPE</span>' : '') + '<span></span></div>';
  }

  // ---------- toasts & modals ----------
  function toast(msg, kind, ms) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.setAttribute('role', 'status');
    el.innerHTML = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, (ms || 2600));
    setTimeout(function () { el.remove(); }, (ms || 2600) + 400);
  }

  function openModal(html) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="backdrop" data-act="modal-cancel"></div><div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    root.hidden = false;
    var first = root.querySelector('input, select');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal(result) {
    var root = document.getElementById('modal-root');
    root.hidden = true;
    root.innerHTML = '';
    var m = V.modal;
    V.modal = null;
    if (m && m.resolve) m.resolve(result);
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      V.modal = { resolve: resolve };
      openModal('<h2>' + esc(title) + '</h2>' + (text ? '<p class="muted">' + text + '</p>' : '') +
        '<div class="modal-actions"><button class="btn ghost" data-act="modal-cancel">Cancel</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-act="modal-ok">' + esc(okLabel || 'OK') + '</button></div>');
    });
  }

  /** Several labelled choices; resolves to the chosen value, or false on Cancel. */
  function choiceBox(title, text, choices) {
    return new Promise(function (resolve) {
      V.modal = { resolve: resolve, choices: choices };
      openModal('<h2>' + esc(title) + '</h2>' + (text ? '<p class="muted">' + text + '</p>' : '') +
        '<div class="modal-choices">' + choices.map(function (c, i) {
          return '<button class="btn block ' + (c.cls || 'ghost') + '" data-act="modal-choice" data-i="' + i + '">' + esc(c.label) + '</button>';
        }).join('') + '<button class="btn ghost block" data-act="modal-cancel">Cancel</button></div>');
    });
  }

  // ---------- render ----------
  function viewKey() {
    var g = gate();
    if (g) return g;
    if (needsSetup()) return CLOUD.restoring() ? 'restoring' : 'setup';
    return V.screen ? V.screen + ':' + (V.screen === 'lift' ? V.liftId : V.historyId || '') : 'tab:' + V.tab;
  }
  function needsSetup() { return !S.settings.setupDone && !S.active; }
  /** 'greet' or 'signin' while nobody has signed in on this phone, else ''. */
  function gate() {
    if (CLOUD.handedOff()) return 'handedoff';
    if (shouldGreet()) return 'greet';
    return CLOUD.owner() ? '' : 'signin';
  }
  // The joke question shows at most once a day (the first open of the day on this phone), never mid-workout
  // or while Google is sending someone back. The day is kept on this phone only, not synced.
  var GREET_KEY = ST.KEY + ':greeted-on';
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function shouldGreet() {
    if (V.greeted || S.active || CLOUD.returningFromSignIn() || CLOUD.signInError()) return false;
    var last = null;
    try { last = localStorage.getItem(GREET_KEY); } catch (e) { /* storage blocked: treat as not shown */ }
    return last !== todayKey();
  }

  // ----- App updates -----
  // A new version has taken over the offline cache; the screen still runs the old code until reloaded.
  // Never shown on the logging screens, so it can't get in the way mid-set.
  function updateBarHtml() {
    if (!V.updateReady || V.screen === 'workout' || V.screen === 'editWorkout') return '';
    return '<div class="update-bar" role="status"><span><strong>Update ready.</strong> Reload to get the newest version.</span>' +
      '<button class="btn primary sm" data-act="app-reload">Reload</button></div>';
  }

  var themeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    var t = S.settings.theme === 'system' ? (themeQuery && themeQuery.matches ? 'light' : 'dark') : S.settings.theme === 'light' ? 'light' : 'dark';
    if (document.documentElement.dataset.theme !== t) {
      document.documentElement.dataset.theme = t;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'light' ? '#F6F3EF' : '#0D0C0B');
    }
  }
  if (themeQuery && themeQuery.addEventListener) themeQuery.addEventListener('change', function () { if (S.settings.theme === 'system') applyTheme(); });
  // The rest timer is kept on the phone too, so it survives the app being closed and reopened mid-rest.
  var REST_KEY = 'pr-forge:web:v1:rest', restSaved = null;
  function keepRest() {
    var v = V.rest && S.active ? JSON.stringify({ w: S.active.id, e: V.rest.endsAt, t: V.rest.total }) : '';
    if (v === restSaved) return;
    restSaved = v;
    try { if (v) localStorage.setItem(REST_KEY, v); else localStorage.removeItem(REST_KEY); } catch (e) { /* private mode: timer just won't survive a restart */ }
  }
  function restoreRest() {
    try {
      var r = JSON.parse(localStorage.getItem(REST_KEY) || 'null');
      if (r && S.active && r.w === S.active.id && r.e > Date.now()) V.rest = { endsAt: r.e, total: r.t };
    } catch (e) { /* ignore */ }
  }
  function render() {
    applyTheme();
    keepRest();
    var body;
    var g = gate();
    if (g) body = g === 'greet' ? viewGreet() : g === 'handedoff' ? viewHandedOff() : viewSignIn();
    else if (needsSetup() && CLOUD.restoring()) body = viewRestoring();
    else if (needsSetup()) body = viewSetup();
    else if (V.screen === 'workout' && S.active) body = viewWorkout();
    else if (V.screen === 'template' && V.tplDraft) body = viewTemplateEditor();
    else if (V.screen === 'editWorkout' && V.edit) body = viewEditWorkout();
    else if (V.screen === 'lift' && V.liftId) body = viewLift();
    else if (V.screen === 'historyDetail' && findWorkout(V.historyId)) body = viewHistoryDetail();
    else if (V.screen === 'settings') body = viewSettings();
    else if (V.screen === 'exercises') body = viewExercises();
    else {
      V.screen = null;
      body = ({ home: viewHome, workouts: viewWorkouts, progress: viewProgress, history: viewHistory })[V.tab]();
    }
    var key = viewKey();
    var keepScroll = key === lastViewKey ? window.scrollY : 0;
    lastViewKey = key;

    var noTabs = !!g || needsSetup() || V.screen === 'editWorkout' || (V.screen === 'historyDetail' && V.summary === V.historyId);
    app.innerHTML =
      '<main class="screen' + (noTabs ? ' no-tabs' : '') + '">' + updateBarHtml() + body + '</main>' +
      (S.active && !g && V.screen !== 'workout' && V.screen !== 'editWorkout' ? activeBar() : '') +
      (V.screen === 'workout' ? restBar() : '') +
      (noTabs ? '' : tabBar()) +
      (V.picker ? viewPicker() : '') +
      (V.prMoment ? viewPrMoment() : '');
    window.scrollTo(0, keepScroll);
    tick();
  }

  function tabBar() {
    var logging = V.screen === 'workout';
    var tabs = [['home', 'Today'], ['workouts', logging ? 'Workout' : 'Routines'], ['progress', 'Progress'], ['history', 'History']];
    var current = logging ? 'workouts' : V.tab;
    return '<nav class="tabbar" aria-label="Sections">' + tabs.map(function (t) {
      var on = current === t[0];
      return '<button class="tab' + (on ? ' on' : '') + '" ' + (logging && on ? 'data-act="resume-workout"' : 'data-act="tab" data-tab="' + t[0] + '"') +
        (on ? ' aria-current="page"' : '') + '>' + icon(t[0]) + '<span>' + t[1] + '</span></button>';
    }).join('') + '</nav>';
  }

  function activeBar() {
    return '<button class="active-bar" data-act="resume-workout">' +
      '<span class="pulse"></span><span class="ab-text"><strong>' + esc(S.active.name) + '</strong>' +
      '<span class="muted">In progress · <span data-elapsed></span></span></span>' +
      '<span class="ab-go">Resume</span></button>';
  }

  function restBar() {
    if (!V.rest) return '';
    return '<section class="rest-dock" role="timer" aria-label="Rest timer"><div class="rest-main"><div class="rest-read">' +
      '<span class="rest-label">Rest</span><span class="rest-time" data-rest></span></div>' +
      '<div class="rest-track"><div class="rest-fill" data-rest-fill></div></div></div>' +
      '<button class="rest-btn" data-act="rest-add" aria-label="Add 30 seconds">+30</button>' +
      '<button class="rest-btn" data-act="rest-skip">Skip</button></section>';
  }

  // ----- Home (Today) -----
  function viewHome() {
    var now = new Date();
    var sum = M.weeklySummary(S.workouts, now);
    var todayIdx = (now.getDay() + 6) % 7;
    var letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var strip = letters.map(function (l, i) {
      var when = i === todayIdx ? 'today' : i > todayIdx ? 'future' : 'past';
      var cls = 'day ' + when + (sum.days[i] ? ' done' : '');
      var said = dayNames[i] + (i === todayIdx ? ', today' : '') + ': ' + (sum.days[i] ? 'trained' : when === 'future' ? 'still to come' : 'no workout');
      return '<div class="' + cls + '"><span class="dl" aria-hidden="true">' + l + '</span><span class="dot" role="img" aria-label="' + said + '">' + (sum.days[i] ? icon('check', 'sm') : '') + '</span></div>';
    }).join('');

    var weekLine = sum.thisCount === 0 ? 'No sessions yet this week'
      : sum.thisCount + ' session' + (sum.thisCount === 1 ? '' : 's') + ' · ' + sum.thisSets + ' sets this week';

    var upNext;
    if (S.active) {
      upNext = '<section class="card hero"><div class="hero-top"><span class="eyebrow on">In progress</span>' +
        '<span class="muted small">Started ' + new Date(S.active.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
        '<h2 class="big">' + esc(S.active.name) + '</h2>' +
        '<button class="btn primary block" data-act="resume-workout">Resume workout</button></section>' + staleBanner();
    } else {
      var next = M.suggestNext(S.templates, S.workouts);
      if (next) {
        var t = next.template;
        var planRows = t.exercises.slice(0, 4).map(function (e) {
          var ex = exById(e.exerciseId);
          return '<li><span class="plan-name">' + esc(ex.name) + (sideLabel(ex) ? ' <span class="plan-side">' + sideLabel(ex).toLowerCase() + '</span>' : '') + '</span>' +
            '<span class="plan-val">' + planText(e.exerciseId, e.sets, unit()) + '</span></li>';
        }).join('');
        var more = t.exercises.length > 4 ? '<p class="plan-more">+' + (t.exercises.length - 4) + ' more</p>' : '';
        upNext = '<section class="card hero"><div class="hero-top"><span class="eyebrow on">Up next</span><span class="muted small">' + agoText(next.lastDate) + '</span></div>' +
          '<h2 class="big">' + esc(t.name) + '</h2>' +
          (planRows ? '<ol class="plan">' + planRows + '</ol>' + more : '') +
          '<button class="btn primary block" data-act="start-template" data-id="' + esc(t.id) + '">Start workout' + icon('arrow', 'sm') + '</button>' +
          '<div class="row-2"><button class="btn ghost" data-act="tab" data-tab="workouts">' + icon('list', 'sm') + 'Other routines</button>' +
          '<button class="btn ghost" data-act="start-empty">' + icon('plus', 'sm') + 'Empty workout</button></div></section>';
      } else {
        upNext = '<section class="card hero"><span class="eyebrow on">Get started</span><h2 class="big">Make your first routine</h2>' +
          '<p class="muted">A routine is the exercises you usually do. Build one, or paste one Claude wrote for you, then start it from here in one tap.</p>' +
          '<button class="btn primary block" data-act="routine-new">New routine</button>' +
          '<button class="btn ghost block" data-act="start-empty">Start an empty workout</button></section>';
      }
    }

    var vsText, vsCls = '';
    if (sum.status === 'none') { vsText = sum.lastCount ? 'Not yet' : '—'; vsCls = 'soft'; }
    else if (sum.status === 'new') { vsText = 'New week'; vsCls = 'soft'; }
    else { vsText = (sum.pct > 0 ? '+' : '') + sum.pct + '%'; vsCls = sum.pct > 0 ? 'up' : ''; }

    var prLabel = sum.prs.length === 1 ? 'PR · ' + esc(exById(sum.prs[0].exerciseId).name) : 'PRs this week';
    var highlights = '<section class="stats" aria-label="This week’s numbers">' +
      stat(unit() + ' volume', volNum(sum.thisVolumeLb, unit())) +
      stat('vs last week', vsText, vsCls) +
      stat(prLabel, String(sum.prs.length)) +
      '</section>';

    return '<header class="top row end"><div class="top"><p class="eyebrow">' + now.toLocaleDateString('en-US', { weekday: 'short' }) + ' · ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</p><h1>Today</h1></div>' +
      '<div class="top-tools"><img class="wordmark-img" src="icons/wordmark.png" width="136" height="16" alt="PR Forge">' + settingsButton() + '</div></header>' +
      '<section class="week-wrap" aria-label="This week"><div class="week">' + strip + '</div><p class="week-line">' + weekLine + '</p>' + splitStrip() + '</section>' +
      upNext + highlights + backupNudge();
  }
  // ----- Backup file reminder -----
  // The cloud copy lives on Supabase's free plan, which keeps no backups of its own, so a file now and then is the
  // safety net. Shown on Today only: never during a workout, only with 10+ workouts, at most every 30 days, snoozable.
  var BACKUP_AT = 'pr-forge:web:v1:backup-at', BACKUP_SNOOZE = 'pr-forge:web:v1:backup-snooze';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: the reminder just shows again */ } }
  function backupNudge() {
    if (S.active || S.workouts.length < 10) return '';
    var now = Date.now(), day = 864e5;
    var last = Number(lsGet(BACKUP_AT)) || 0, snooze = Number(lsGet(BACKUP_SNOOZE)) || 0;
    if (now - last < 30 * day || now < snooze) return '';
    return '<section class="card nudge" role="status"><p><b>Save a backup file?</b> ' +
      (last ? 'Your last one was ' + shortDate(new Date(last).toISOString()) + '.' : 'You haven’t saved one on this phone yet.') +
      ' Your workouts are backed up to your account, but a file of your own is a second copy you keep.</p>' +
      '<div class="row-btns"><button class="btn ghost sm" data-act="export">Save backup file</button><button class="btn ghost sm" data-act="backup-snooze">Not now</button></div></section>';
  }
  function stat(label, value, cls) {
    return '<div class="stat"><span class="stat-v' + (cls ? ' ' + cls : '') + '">' + value + '</span><span class="stat-l">' + label + '</span></div>';
  }

  // ----- Workouts (templates) -----
  function viewWorkouts() {
    var list = S.templates.map(function (t) {
      var names = t.exercises.map(function (e) { return esc(exById(e.exerciseId).name); }).join(' · ');
      var sets = t.exercises.reduce(function (a, e) { return a + e.sets; }, 0);
      var lastDone = null;
      S.workouts.forEach(function (wk) { if (wk.endedAt && wk.templateId === t.id && (!lastDone || wk.startedAt > lastDone)) lastDone = wk.startedAt; });
      return '<section class="card tpl"><p class="eyebrow">' + agoText(lastDone) + '</p><div class="tpl-head"><h3>' + esc(t.name) + '</h3>' +
        '<button class="icon-btn boxed" data-act="tpl-menu" data-id="' + esc(t.id) + '" aria-label="Edit, share or duplicate ' + esc(t.name) + '" aria-haspopup="dialog">' + icon('more') + '</button></div>' +
        '<p class="tpl-meta"><span>' + icon('list', 'sm') + t.exercises.length + ' exercise' + (t.exercises.length === 1 ? '' : 's') + '</span><span>' + icon('layers', 'sm') + sets + ' sets</span></p>' +
        (names ? '<p class="ex-names clamp2">' + names + '</p>' : '') +
        '<button class="btn primary block" data-act="start-template" data-id="' + esc(t.id) + '">Start</button></section>';
    }).join('');
    if (!list) {
      list = '<section class="card empty"><p>No routines yet.</p><p class="muted small">A routine is a list of exercises and how many sets you do of each. Starting one fills in last time’s numbers as hints. Tap New to build one, paste one, or start an empty workout.</p></section>';
    }
    return '<header class="top row"><h1>Routines</h1><div class="top-tools"><button class="btn primary sm" data-act="routine-new">' + icon('plus', 'sm') + 'New</button>' + settingsButton() + '</div></header>' +
      list;
  }

  function viewTemplateEditor() {
    var d = V.tplDraft;
    var rows = d.exercises.map(function (e, i) {
      var ex = exById(e.exerciseId);
      return '<li class="tpl-row"><div class="tpl-name"><strong>' + esc(ex.name) + '</strong><span class="muted small">' + esc(ex.muscle) + (sideLabel(ex) ? ' · ' + sideLabel(ex) : '') + '</span></div>' +
        '<div class="tpl-plan"><div class="stepper"><button data-act="tpl-sets" data-i="' + i + '" data-d="-1" aria-label="Fewer sets">−</button><span>' + e.sets + ' sets</span>' +
        '<button data-act="tpl-sets" data-i="' + i + '" data-d="1" aria-label="More sets">+</button></div>' +
        '<label class="tpl-reps"><span>×</span><input data-field="tpl-reps" data-i="' + i + '" inputmode="text" autocomplete="off" maxlength="9" placeholder="reps" aria-label="Target reps for ' + esc(ex.name) + ', like 8 or 8-12" value="' +
          esc(e.repsText != null ? e.repsText : IM.repTargetText(e.reps)) + '"><span class="muted small">reps</span></label></div>' +
        '<div class="tpl-tools"><button class="icon-btn" data-act="tpl-move" data-i="' + i + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button class="icon-btn" data-act="tpl-move" data-i="' + i + '" data-d="1" aria-label="Move down"' + (i === d.exercises.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button class="icon-btn" data-act="tpl-remove" data-i="' + i + '" aria-label="Remove">' + icon('close') + '</button></div>' +
        (i < d.exercises.length - 1 ? '<button class="tpl-link' + (e.superNext ? ' on' : '') + '" data-act="tpl-super" data-i="' + i + '" aria-pressed="' + !!e.superNext + '">' +
          (e.superNext ? 'Superset with the next exercise · tap to unlink' : '+ Superset with next') + '</button>' : '') + '</li>';
    }).join('');
    return '<header class="top row"><button class="btn ghost sm" data-act="template-cancel">' + icon('back', 'sm') + 'Back</button>' +
      '<h1 class="h-sm">' + (d.id ? 'Edit routine' : 'New routine') + '</h1><span></span></header>' +
      '<section class="card"><label class="field"><span>Name</span><input data-field="tpl-name" maxlength="60" placeholder="e.g. Push day" value="' + esc(d.name) + '"></label></section>' +
      '<section class="card"><h2 class="card-title">Exercises</h2>' +
      (rows ? '<ul class="tpl-list">' + rows + '</ul>' : '<p class="muted small">No exercises yet.</p>') +
      '<button class="btn ghost block" data-act="tpl-add-ex">' + icon('plus', 'sm') + 'Add exercises</button></section>' +
      '<button class="btn primary block" data-act="template-save">Save routine</button>' +
      (d.id ? '<button class="btn ghost block" data-act="template-dup">Duplicate routine</button>' +
        '<button class="btn danger-ghost block" data-act="template-delete">Delete routine</button>' : '');
  }

  // ----- Active workout -----
  function viewWorkout() {
    var a = S.active;
    var current = currentEntry();
    var notStarted = function (e) { return e !== current && e.sets.every(function (s) { return !s.done; }); };
    var nextEntry = a.exercises.slice(a.exercises.indexOf(current) + 1).filter(notStarted)[0] || a.exercises.filter(notStarted)[0];
    var total = 0, confirmed = 0;
    a.exercises.forEach(function (e) {
      e.sets.forEach(function (s) { total++; if (s.done) confirmed++; });
    });
    var supNames = supersetNames(a.exercises);
    var cards = a.exercises.map(function (entry) {
      var ex = exById(entry.exerciseId);
      var sup = supNames[entry.id] || '';
      var side = sideLabel(ex);
      var doneSets = entry.sets.filter(function (s) { return s.done; }).length;
      if (entry !== current) {
        var allDone = doneSets === entry.sets.length;
        var label = allDone ? icon('check') + 'Done' : doneSets ? doneSets + ' of ' + entry.sets.length + ' sets' : entry === nextEntry ? 'Next' : 'Later';
        return '<button class="ex-row' + (allDone ? ' done' : '') + '" data-act="ex-focus" data-e="' + entry.id + '">' +
          '<span class="ex-row-text"><span class="ex-row-label">' + label + (sup ? ' · ' + sup : '') + '</span><span class="ex-row-name">' + esc(ex.name) + '</span></span>' +
          '<span class="ex-row-plan">' + (allDone ? doneSets + ' set' + (doneSets === 1 ? '' : 's') : planText(entry.exerciseId, entry.sets.length, a.unit, a.id)) +
          (side ? '<small>' + side.toLowerCase() + '</small>' : '') + '</span></button>';
      }
      var last = M.lastSessionFor(S.workouts, entry.exerciseId, a.id);
      var activeSet = entry.sets.filter(function (s) { return !s.done; })[0];
      var kind = entryKind(entry);
      var lastText = lastTimeText(last, a.unit, kind);
      var best = bestText(entry.exerciseId, a.unit, a.id);
      var showPlates = kind === 'weight' && ex.equipment === 'Barbell' && !!activeSet;
      var rows = entry.sets.map(function (s, i) {
        var hint = setHint(entry, s, last, a.unit);
        var html = setRowHtml(entry, s, {
          scope: 'active', u: a.unit, hint: hint, kind: kind, side: side, n: i + 1, workIdx: kindIndex(entry, s) + 1,
          active: s === activeSet, isPr: s.done && V.prShown[s.id] === prKey(s)
        });
        if (s === activeSet && showPlates) {
          var plannedWeight = s.weight != null ? s.weight : hint ? hint.weight : null;
          html += '<div class="plates" data-plates aria-live="polite">' + platesInner(plannedWeight, a.unit) + '</div>';
        }
        return html;
      }).join('');
      return '<section class="card ex-card" aria-label="' + esc(ex.name) + '"><div class="ex-head"><div class="ex-head-text"><h2>' + esc(ex.name) + '</h2>' +
        '<p class="ex-meta">' + (sup ? '<b class="sup-tag">' + sup + '</b> · ' : '') + esc(ex.equipment) + (side ? ' · ' + side : '') + (lastText ? ' · ' + lastText : '') + '</p>' + goalHtml(entry, last, a.unit, kind) + '</div>' +
        '<div class="ex-tools">' + (best ? '<span class="ex-best" title="Your best so far">' + best + '</span>' : '') +
        '<button class="icon-btn" data-act="ex-remove" data-e="' + entry.id + '" aria-label="Remove exercise">' + icon('close', 'sm') + '</button></div></div>' +
        setHeadHtml(kind, a.unit, side) +
        rows +
        '<div class="ex-actions"><button class="btn ghost sm" data-act="set-add" data-e="' + entry.id + '">' + icon('plus', 'sm') + 'Add set</button>' +
        (kind === 'weight' || kind === 'weighted' ? '<button class="btn ghost sm" data-act="warmup-add" data-e="' + entry.id + '">' + icon('plus', 'sm') + 'Warm-up</button>' : '') +
        (entry.sets.length > 1 ? '<button class="btn ghost sm" data-act="set-remove" data-e="' + entry.id + '">Remove last set</button>' : '') +
        '<button class="btn ghost sm" data-act="ex-swap" data-e="' + entry.id + '">Swap</button>' +
        (a.exercises[a.exercises.length - 1] !== entry ? '<button class="btn ghost sm" data-act="ex-super" data-e="' + entry.id + '" aria-pressed="' + !!entry.superNext + '">' + (entry.superNext ? 'Unlink next' : 'Superset with next') + '</button>' : '') +
        '<button class="btn ghost sm" data-act="ex-type" data-e="' + entry.id + '" aria-label="Logging type: ' + trackingLabel(kind) + '. Tap to change">' + trackingLabel(kind) + '</button>' +
        '<button class="icon-btn boxed" data-act="ex-move" data-e="' + entry.id + '" data-d="-1" aria-label="Move ' + esc(ex.name) + ' up"' + (a.exercises[0] === entry ? ' disabled' : '') + '>' + icon('up', 'sm') + '</button>' +
        '<button class="icon-btn boxed" data-act="ex-move" data-e="' + entry.id + '" data-d="1" aria-label="Move ' + esc(ex.name) + ' down"' + (a.exercises[a.exercises.length - 1] === entry ? ' disabled' : '') + '>' + icon('down', 'sm') + '</button>' +
        '</div></section>';
    }).join('');

    if (!cards) cards = '<section class="card empty"><p>No exercises yet.</p><p class="muted small">Add exercises to start logging sets.</p></section>';

    var names = a.exercises.map(function (e) { return exById(e.exerciseId).name; }).join(' · ');
    return '<header class="sticky-top wk-head"><button class="icon-btn boxed" data-act="minimize-workout" aria-label="Hide workout">' + icon('down', 'sm') + '</button>' +
      '<div class="wk-title"><strong>' + esc(a.name) + '</strong><span data-elapsed></span></div>' +
      '<button class="btn finish" data-act="finish-workout">Finish</button></header>' +
      (total ? '<div class="wk-progress"><div class="wk-progress-text"><span>' + confirmed + ' of ' + total + ' sets</span><span>' + esc(names) + '</span></div>' +
        '<div class="wk-track"><div class="wk-fill" style="width:' + (100 * confirmed / total).toFixed(1) + '%"></div></div></div>' : '') +
      staleBanner() +
      (S.workouts.length ? '' : '<p class="muted small tip">Faded numbers are last session’s. Tap ✓ to confirm a set — empty boxes take the faded values. Tap a set number to mark a warm-up.</p>') +
      cards +
      '<button class="btn ghost block" data-act="add-exercise">' + icon('plus', 'sm') + 'Add exercise</button>' +
      '<button class="btn danger-ghost block" data-act="discard-workout">Discard workout</button>';
  }

  /** "Target 8–12 reps", plus the next step when every working set hit the top of the range last time. */
  function goalHtml(entry, last, u, kind) {
    if (!entry.target) return '';
    var t = 'Target ' + IM.repTargetText(entry.target) + ' reps';
    var p = M.progressionFor(last, entry.target, u, kind);
    if (p) {
      var verb = kind === 'assisted' ? 'take ' + U.fmtNum(Math.abs(p.from - p.weight)) + ' ' + u + ' less help' : 'try <b>' + WEIGHT_SIGN[kind] + U.fmtNum(p.weight) + ' ' + u + '</b>';
      t += ' · You hit ' + entry.target.max + ' on every set last time, so ' + verb + ' for ' + entry.target.min + '+';
    } else if (last && kind !== 'timed') {
      t += ' · Go up once every set reaches ' + entry.target.max;
    }
    return '<p class="ex-goal">' + t + '</p>';
  }

  // ----- PR moment -----
  function prKey(set) { return set.weight + 'x' + set.reps + 'x' + set.seconds; }

  /** Everything the PR panel shows, worked out when the set is confirmed. */
  function buildPrMoment(entry, set, pr) {
    var u = S.active.unit;
    var ex = exById(entry.exerciseId);
    var id = entry.exerciseId;
    var hist = M.sessionsFor(S.workouts, id, S.active.id);
    var m = { name: ex.name, side: sideLabel(ex), unit: u, type: pr.type, weight: set.weight, reps: set.reps, note: '' };
    if (pr.type !== 'e1rm') {
      var pick = function (s) { return pr.type === 'seconds' ? s.maxSeconds : s.maxBwReps; };
      hist = hist.filter(function (s) { return pick(s) > 0; }).slice(-7);
      m.previous = pr.previous;
      m.count = pr.type === 'seconds' ? pr.seconds : pr.reps;
      m.countUnit = pr.type === 'seconds' ? 'sec' : 'reps';
      m.values = hist.map(pick).concat(m.count);
      m.from = hist.length ? hist[0].date : null;
      return m;
    }
    hist = hist.filter(function (s) { return s.topE1rm > 0; });
    m.e1rmLb = pr.e1rmLb;
    m.previousLb = pr.previousLb;
    var recent = hist.slice(-7);
    m.values = recent.map(function (s) { return s.topE1rm; }).concat(pr.e1rmLb);
    m.from = recent.length ? recent[0].date : null;

    var histBest = 0, bestIdx = 0;
    hist.forEach(function (s, i) { if (s.topE1rm > histBest + 0.05) { histBest = s.topE1rm; bestIdx = i; } });
    if (pr.previousLb > histBest + 0.05) {
      m.note = 'Another new best today.';
    } else if (hist.length) {
      var since = hist.length - 1 - bestIdx;
      m.note = since ? 'Your first new best in ' + (since + 1) + ' sessions.' : 'You beat last session’s best.';
      var trend = M.liftTrends(S.workouts, new Date(), 36500).filter(function (t) { return t.exerciseId === id; })[0];
      if (trend && (trend.status === 'holding' || trend.status === 'stalled')) {
        m.note += ' ' + esc(ex.name) + ' moves from <strong>' + (trend.status === 'holding' ? 'Holding' : 'Stalled') + '</strong> to <strong class="to">Progressing</strong>.';
      }
    }
    return m;
  }

  function viewPrMoment() {
    var m = V.prMoment;
    var isE = m.type === 'e1rm';
    var main = isE ? U.fmtNum(m.weight) : String(m.count);
    var sub = isE ? '<span>' + m.unit + '</span><span>× ' + m.reps + '</span>' : '<span>' + m.countUnit + '</span>';
    var grid = isE
      ? '<div class="pr-grid"><div><strong>' + U.fmtWeightLb(m.e1rmLb, m.unit) + '</strong><span>Estimated 1-rep max</span></div>' +
        '<div><strong>+' + U.fmtWeightLb(m.e1rmLb - m.previousLb, m.unit) + '</strong><span>Over your best of ' + U.fmtNum(U.fromLb(m.previousLb, m.unit)) + '</span></div></div>'
      : '<div class="pr-grid one"><div><strong>+' + (m.count - m.previous) + ' ' + m.countUnit + '</strong><span>Over your best of ' + m.previous + '</span></div></div>';
    var display = m.values.map(function (v) { return isE ? U.fmtNum(U.fromLb(v, m.unit)) : String(v); });
    return '<div class="pr-moment" role="dialog" aria-modal="true" aria-label="New personal record">' +
      '<section class="pr-panel"><div class="pr-panel-top"><span class="pr-kicker">' + icon('trophy') + 'New personal record</span>' +
      '<button class="pr-close" data-act="pr-close" aria-label="Close">' + icon('close', 'sm') + '</button></div>' +
      '<h1 class="pr-name">' + esc(m.name) + '</h1>' + (m.side ? '<span class="pr-side">' + m.side + '</span>' : '') +
      '<p class="pr-num' + (main.length > 4 ? ' long' : '') + '"><span class="pr-num-main">' + main + '</span><span class="pr-num-sub">' + sub + '</span></p>' +
      grid + '</section>' +
      '<section class="pr-chart" aria-label="Recent sessions"><div class="pr-chart-head"><h2 class="card-title">Best set each session</h2><span>' + (isE ? 'est. 1RM, ' + m.unit : m.countUnit) + '</span></div>' +
      bars(m.values, 'last-accent', 'Last ' + m.values.length + ' sessions: ' + display.join(', ') + ', the last one today', true) +
      '<div class="pr-chart-foot"><span>' + (m.from ? new Date(m.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</span><strong>Today</strong></div>' +
      (m.note ? '<p class="pr-note">' + m.note + '</p>' : '') + '</section>' +
      '<div class="pr-foot"><button class="btn white block" data-act="pr-close">Keep going' + (V.rest ? '<span data-rest-note>· rest <span data-rest></span></span>' : '') + '</button></div></div>';
  }

  // ----- Progress -----
  /** ". All-time best 262 lb" when an older best is higher than the last 90 days' best. */
  function allTimeNote(t) {
    if (!t.allTimeBest || t.allTimeBest <= t.best + 0.05) return '';
    return ' · All-time best ' + metricValue(t.metric, t.allTimeBest) + (t.metric === 'e1rm' ? ' ' + unit() : ' ' + metricUnit(t.metric));
  }
  /** A lift's last sessions as a thin line, newest on the right, with a dot on the latest coloured by its status. */
  function sparkLine(values, status, label) {
    var W = 112, H = 64, P = 6;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min;
    var x = function (i) { return values.length === 1 ? W - P : P + (i * (W - 2 * P)) / (values.length - 1); };
    var y = function (v) { return span ? H - P - ((H - 2 * P) * (v - min)) / span : H / 2; };
    var pts = values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); });
    var last = values.length - 1;
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '">' +
      (values.length > 1 ? '<polyline points="' + pts.join(' ') + '"/>' : '') +
      '<circle class="spark-' + status + '" cx="' + x(last).toFixed(1) + '" cy="' + y(values[last]).toFixed(1) + '" r="4"/></svg>';
  }
  /** Strength total of the main lifts: a real weight you can check, not a score. Hidden until 2 lifts qualify. */
  function strengthCard(ids) {
    var st = M.strengthTotal(S.workouts, ids, new Date());
    if (!st) return '';
    var u = unit();
    var day = 864e5, nowT = Date.now();
    var span = function (a, b) { return shortDate(new Date(nowT - a * day).toISOString()) + ' – ' + shortDate(new Date(nowT - b * day).toISOString()); };
    var priorSum = st.lifts.reduce(function (a, l) { return a + (l.priorLb || 0); }, 0);
    var sign = st.changeLb > 0.5 ? '+' : st.changeLb < -0.5 ? '−' : '±';
    var pill = st.changeLb === null ? '' : '<span class="st-pill' + (st.changeLb > 0.5 ? ' up' : '') + '">' + sign + U.fmtNum(Math.round(Math.abs(U.fromLb(st.changeLb, u)))) + ' ' + u +
      (priorSum > 0 ? ' · ' + sign + (Math.round(Math.abs(st.changeLb) / priorSum * 1000) / 10) + '%' : '') + '</span>';
    var change = st.changeLb === null ? '<span class="muted small">A change shows once each lift has sessions in both 8-week spans.</span>'
      : '<span class="st-change">Change vs ' + span(112, 57) + '</span>';
    // The same total, worked out the same way at the end of each of the last 8 weeks, for the same lifts.
    // A week where any of these lifts had no session in its 8 weeks is skipped rather than drawn as a drop.
    var liftIds = st.lifts.map(function (l) { return l.exerciseId; });
    var pts = [];
    for (var k = 7; k >= 0; k--) {
      var at = new Date(nowT - k * 7 * day), past = M.strengthTotal(S.workouts, liftIds, at);
      if (past && past.lifts.length === liftIds.length) pts.push({ t: at.getTime(), v: past.totalLb });
    }
    var trendSvg = pts.length >= 3 ? strengthLine(pts, u) : '';
    var names = st.lifts.map(function (l) { return esc(exById(l.exerciseId).name.replace(/ \((Barbell)\)$/, '')); }).join(' + ');
    return '<section class="card st-card" aria-label="Strength total"><div class="pr-chart-head"><h2 class="card-title">Strength total</h2><span class="muted small">' + span(56, 0) + '</span></div>' +
      '<div class="st-head"><p class="st-total">' + U.fmtNum(Math.round(U.fromLb(st.totalLb, u))) + '<small> ' + u + '</small></p>' + pill + '</div>' + change +
      '<p class="st-def">Best estimated 1RM of each main lift in the last 8 weeks, added up: ' + names + '.</p>' + trendSvg +
      (st.pctOfBest !== null && st.pctOfBest < 100 ? '<span class="muted small">' + st.pctOfBest + '% of the same lifts’ all-time bests</span>' : st.pctOfBest === 100 ? '<span class="muted small">Every lift is at its all-time best</span>' : '') +
      '<details class="how"><summary>How it’s worked out</summary><p class="muted small">The best estimated one-rep max of each main lift in the last 8 weeks, added up: ' + names + '. ' +
      'Estimated 1RM = weight × (1 + reps ÷ 30), with reps above 12 counted as 12. A main lift with no session in 8 weeks is left out rather than counted as zero. Pin lifts on their pages to choose which count.</p></details></section>';
  }
  /** Strength total at the end of each recent week: a thin orange line over a faint fill, the latest point dotted. */
  function strengthLine(pts, u) {
    var W = 320, H = 84, P = 6;
    var vals = pts.map(function (p) { return p.v; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = max - min || 1;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    var xy = pts.map(function (p) { return [P + (W - 2 * P) * (p.t - t0) / (t1 - t0 || 1), P + 8 + (H - 2 * P - 8) * (1 - (p.v - min) / span)]; });
    var line = xy.map(function (c) { return c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ');
    var last = xy[xy.length - 1];
    var label = 'Strength total by week: ' + pts.map(function (p) { return shortDate(new Date(p.t).toISOString()) + ' ' + Math.round(U.fromLb(p.v, u)); }).join(', ') + ' ' + u;
    return '<svg class="st-line" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' +
      '<polygon class="st-area" points="' + xy[0][0].toFixed(1) + ',' + H + ' ' + line + ' ' + last[0].toFixed(1) + ',' + H + '"/>' +
      '<polyline points="' + line + '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4"/></svg>' +
      '<div class="pr-chart-foot"><span>' + shortDate(new Date(t0).toISOString()) + '</span><span>Now</span></div>';
  }
  /** The lifts shown big on Progress: the ones you pinned, or else your 5 most-trained of the last 8 weeks. */
  function mainLiftIds(trends) {
    var pinned = S.settings.pinned || [];
    if (pinned.length) return pinned.slice();
    return trends.slice().sort(function (a, b) { return b.sessions - a.sessions; }).slice(0, 5).map(function (t) { return t.exerciseId; });
  }

  function viewProgress() {
    var trends = M.liftTrends(S.workouts, new Date());
    var byId = {}; trends.forEach(function (t) { byId[t.exerciseId] = t; });
    var mainIds = mainLiftIds(trends);
    var pinnedMode = (S.settings.pinned || []).length > 0;
    var trendCard = function (id) {
      var ex = exById(id), t = byId[id];
      if (!t) {
        return '<button class="card trend" data-act="lift-open" data-id="' + esc(id) + '" data-from="progress"><span class="trend-main"><span class="trend-name"><span class="trend-lift">' + esc(ex.name) + '</span>' +
          '<span class="pill paused">No recent sessions</span></span><span class="muted small">Not trained in the last 8 weeks. Tap for its full history.</span></span></button>';
      }
      var values = t.spark.map(function (v) { return metricValue(t.metric, v); }).join(', ');
      return '<button class="card trend" data-act="lift-open" data-id="' + esc(id) + '" data-from="progress"><span class="trend-main"><span class="trend-name"><span class="trend-lift">' + esc(ex.name) + '</span>' +
        '<span class="pill ' + t.status + '">' + STATUS_LABEL[t.status] + '</span></span>' +
        '<span class="trend-num">' + metricValue(t.metric, t.best) + '<small> ' + metricUnit(t.metric) + '</small></span>' +
        '<span class="muted small">' + (sideLabel(ex) ? sideLabel(ex) + ' · ' : '') + t.text + allTimeNote(t) + '</span></span>' +
        sparkLine(t.spark, t.status, ex.name + ', ' + metricUnit(t.metric) + ', last ' + t.spark.length + ' sessions: ' + values) +
        (t.status === 'stalled' ? '<span class="idea">Try: ' + STALL_IDEAS[t.metric][0].toLowerCase() + ' Tap for more ideas.</span>' : '') +
        '</button>';
    };
    var attention = trends.filter(function (t) { return (t.status === 'stalled' || t.status === 'down') && mainIds.indexOf(t.exerciseId) === -1; });
    var attentionHtml = attention.length ? '<h2 class="month">Needs attention</h2><section class="card att-list">' + attention.slice(0, 5).map(function (t) {
      var ex = exById(t.exerciseId);
      return '<button class="att-row" data-act="lift-open" data-id="' + esc(t.exerciseId) + '" data-from="progress"><span class="paste-name"><strong>' + esc(ex.name) + '</strong><span class="muted small">' + esc(t.text) + '</span></span>' +
        '<span class="att-right"><span class="pill ' + t.status + '">' + STATUS_LABEL[t.status] + '</span><span class="att-num">' + metricValue(t.metric, t.best) + ' <small>' + metricUnit(t.metric) + '</small></span></span></button>';
    }).join('') + (attention.length > 5 ? '<button class="att-more" data-act="exercises-open">+' + (attention.length - 5) + ' more in All lifts</button>' : '') + '</section>' : '';
    var trendHtml = trends.length || mainIds.length
      ? '<div class="month-row"><h2 class="month">Main lifts</h2><span class="muted small">' + (pinnedMode ? 'Pinned by you' : 'Your most-trained. Pin lifts to choose') + '</span></div>' +
        mainIds.map(trendCard).join('') + attentionHtml
      : '<section class="card empty"><p class="muted small">Finish a few workouts and each lift’s trend shows up here.</p></section>';

    var counts = { progressing: 0, holding: 0, stalled: 0, building: 0, down: 0, paused: 0 };
    trends.forEach(function (t) { counts[t.status]++; });
    var lede = [];
    if (counts.progressing) lede.push('<strong class="win">' + counts.progressing + ' progressing</strong>');
    if (counts.holding) lede.push(counts.holding + ' holding');
    if (counts.stalled) lede.push('<strong class="warn">' + counts.stalled + ' stalled</strong>');
    if (counts.down) lede.push('<strong class="warn">' + counts.down + ' down</strong>');
    if (counts.building) lede.push(counts.building + ' building data');
    if (counts.paused) lede.push(counts.paused + ' paused');
    var how = '<details class="how"><summary>How trends are worked out</summary><p class="muted small">Each session’s best set is turned into an estimated one-rep max: weight × (1 + reps ÷ 30). Lifts without weight use your most reps or longest hold instead. ' +
      '<b>Progressing</b> = a new best within your last 3 sessions of that lift. <b>Holding</b> = 3–4 sessions since the best. <b>Stalled</b> = 5 or more. ' +
      '<b>Down</b> = your last 2 sessions were over 5% under your best of the 6 weeks before them. <b>Paused</b> = no session in 14 days or more. ' +
      'Warm-ups don’t count, and assisted lifts have no trend. Only lifts trained in the last 8 weeks are shown; every lift is under All exercises.</p></details>';
    var tileOrder = ['progressing', 'holding', 'stalled', 'down', 'building', 'paused'].filter(function (k) { return counts[k]; });
    var ledeHtml = trends.length ? '<section class="card status-card" aria-label="Lift status"><div class="pr-chart-head"><h2 class="card-title">Lift status</h2><span class="muted small">' +
        trends.length + ' lift' + (trends.length === 1 ? '' : 's') + ', last 8 weeks</span></div>' +
      '<ul class="status-tiles" style="grid-template-columns: repeat(' + tileOrder.length + ', minmax(0, 1fr))">' + tileOrder.map(function (k) {
        var ic = { progressing: 'progress', holding: 'hold', stalled: 'flat', down: 'fall', building: 'bars', paused: 'pause' }[k];
        return '<li class="status-tile ' + k + '">' + icon(ic, 'sm') + '<span class="st-n">' + counts[k] + '</span><span class="st-l">' + STATUS_LABEL[k] + '</span></li>';
      }).join('') + '</ul>' + how + '</section>' : '';

    var view = V.progressView === 'records' ? 'records' : 'trends';
    var seg = '<div class="seg seg-wide" role="tablist">' +
      '<button class="' + (view === 'trends' ? 'on' : '') + '" data-act="progress-view" data-v="trends" aria-pressed="' + (view === 'trends') + '">Trends</button>' +
      '<button class="' + (view === 'records' ? 'on' : '') + '" data-act="progress-view" data-v="records" aria-pressed="' + (view === 'records') + '">Records</button></div>';
    var allEx = '<button class="btn ghost block" data-act="exercises-open">All lifts (' + exerciseIndex().filter(function (o) { return o.sessions; }).length + ')</button>';
    var header = '<header class="top row"><h1>Progress</h1>' + settingsButton() + '</header>' + seg;
    if (view === 'records') {
      var allPrs = M.personalRecords(S.workouts);
      var mainPrs = allPrs.filter(function (r) { return mainIds.indexOf(r.exerciseId) !== -1; })
        .sort(function (a, b) { return mainIds.indexOf(a.exerciseId) - mainIds.indexOf(b.exerciseId); });
      var otherPrs = allPrs.filter(function (r) { return mainIds.indexOf(r.exerciseId) === -1; });
      var mainCard = '<section class="card"><h2 class="card-title">Main lifts</h2><ul class="prs">' + (mainPrs.length ? recordRows(mainPrs) : '<li class="muted small">No records for your main lifts yet.</li>') + '</ul></section>';
      var otherCard = !otherPrs.length ? '' : V.recordsAll
        ? '<section class="card"><h2 class="card-title">Other lifts</h2><ul class="prs">' + recordRows(otherPrs) + '</ul></section><button class="btn ghost block" data-act="records-all">Show fewer</button>'
        : '<button class="btn ghost block" data-act="records-all">Show all records (' + otherPrs.length + ' more)</button>';
      return header + (allPrs.length ? mainCard + otherCard : '<section class="card"><ul class="prs"><li class="muted small">No records yet.</li></ul></section>') + allEx;
    }
    return header + strengthCard(mainIds) + ledeHtml + weeklyChart() + trendHtml + muscleCard() + bodyWeightCard() + allEx;
  }
  /** Personal records, one row per lift; each opens that lift's page. */
  function recordsHtml(onlyId) {
    var prs = M.personalRecords(S.workouts).filter(function (r) { return !onlyId || r.exerciseId === onlyId; });
    if (!prs.length) return '<li class="muted small">' + (onlyId ? 'No record yet. Imported and edited sessions don’t count as records.' : 'No records yet.') + '</li>';
    return recordRows(prs, onlyId);
  }
  function recordRows(prs, onlyId) {
    return prs.map(function (r) {
      var ex = exById(r.exerciseId);
      var big = function (n, unitText, sub) { return '<span class="rec-num">' + n + '<small> ' + unitText + '</small></span>' + (sub ? '<span class="rec-sub">' + sub + '</span>' : ''); };
      var main = r.bestE1rm ? big(U.fmtNum(U.fromLb(r.bestE1rm.e1rmLb, unit())), unit() + ' est. 1RM', 'from ' + w(r.bestE1rm.weightLb) + ' × ' + r.bestE1rm.reps)
        : r.maxSeconds ? big(r.maxSeconds.seconds, 'sec', '')
        : r.leastAssist ? big(U.fmtNum(U.fromLb(r.leastAssist.weightLb, unit())), unit() + ' least help', '× ' + r.leastAssist.reps)
        : r.maxBwReps ? big(r.maxBwReps.reps, 'reps', '') : '—';
      var heavy = r.heaviest ? 'Heaviest ' + w(r.heaviest.weightLb) + ' × ' + r.heaviest.reps + ' · ' : '';
      var src = r.bestE1rm && r.bestE1rm.imported ? 'Best is from an import (' + shortDate(r.bestE1rm.date) + ' ' + new Date(r.bestE1rm.date).getFullYear() + ') · ' : '';
      var inner = '<span class="rec-text"><strong class="rec-name">' + esc(ex.name) + (sideLabel(ex) ? ' <span class="plan-side">' + sideLabel(ex).toLowerCase() + '</span>' : '') + '</strong><span class="pr-main">' + main + '</span>' +
        '<span class="muted small">' + src + heavy + r.sessions + ' session' + (r.sessions === 1 ? '' : 's') + '</span></span>';
      return onlyId ? '<li class="pr">' + inner + '</li>'
        : '<li><button class="pr pr-btn" data-act="lift-open" data-id="' + esc(r.exerciseId) + '" data-from="progress">' + inner + icon('arrow', 'sm') + '</button></li>';
    }).join('');
  }

  // ----- Exercises: every lift you've logged or made, each with its own page -----
  function exerciseIndex() {
    var info = {};
    var touch = function (id) { return info[id] || (info[id] = { id: id, sessions: 0, last: null, routines: 0 }); };
    M.finished(S.workouts).forEach(function (wk) {
      var seen = {};
      wk.exercises.forEach(function (e) {
        if (seen[e.exerciseId] || !e.sets.some(function (st) { return st.done; })) return;
        seen[e.exerciseId] = true;
        var o = touch(e.exerciseId); o.sessions++;
        if (!o.last || wk.startedAt > o.last) o.last = wk.startedAt;
      });
    });
    S.templates.forEach(function (t) { t.exercises.forEach(function (e) { touch(e.exerciseId).routines++; }); });
    S.customExercises.forEach(function (c) { touch(c.id); });
    return Object.keys(info).map(function (id) { var o = info[id]; o.ex = exById(id); return o; })
      .sort(function (a, b) { return (b.last || '').localeCompare(a.last || '') || a.ex.name.localeCompare(b.ex.name); });
  }
  function exerciseRowsHtml(q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    var rows = exerciseIndex().filter(function (o) {
      var hay = (o.ex.name + ' ' + o.ex.muscle + ' ' + o.ex.equipment).toLowerCase();
      return words.every(function (wd) { return hay.indexOf(wd) !== -1; });
    });
    if (!rows.length) return '<p class="muted small">' + (words.length ? 'No exercise matches “' + esc(q) + '”.' : 'Exercises you log, add to a routine or create show up here.') + '</p>';
    var trendById = {};
    M.liftTrends(S.workouts, new Date()).forEach(function (t) { trendById[t.exerciseId] = t; });
    var pinned = S.settings.pinned || [];
    return rows.map(function (o) {
      var meta = o.sessions ? o.sessions + ' session' + (o.sessions === 1 ? '' : 's') + ' · last ' + relDay(o.last).toLowerCase()
        : o.routines ? 'In ' + o.routines + ' routine' + (o.routines === 1 ? '' : 's') + ', not logged yet' : 'Not used yet';
      var tr = trendById[o.id];
      return '<button class="ex-index-row" data-act="lift-open" data-id="' + esc(o.id) + '" data-from="exercises"><span class="paste-name"><strong>' + esc(o.ex.name) + '</strong>' +
        '<span class="muted small">' + (pinned.indexOf(o.id) !== -1 ? 'Pinned · ' : '') + esc(o.ex.muscle) + (o.ex.custom ? ' · Custom' : '') + ' · ' + meta + '</span></span>' +
        (tr ? '<span class="pill ' + tr.status + '">' + STATUS_LABEL[tr.status] + '</span>' : '') + icon('arrow', 'sm') + '</button>';
    }).join('');
  }
  function viewExercises() {
    return '<header class="top row"><button class="btn ghost sm" data-act="exercises-back">' + icon('back', 'sm') + 'Back</button><span></span></header>' +
      '<header class="top"><h1>Exercises</h1></header>' +
      '<p class="lede">Every exercise you’ve logged, put in a routine or created. Tap one for its chart, records and settings.</p>' +
      '<input class="search" data-field="ex-q" type="search" placeholder="Search exercises" autocomplete="off" value="' + esc(V.exQ || '') + '">' +
      '<section class="card ex-index" id="ex-index">' + exerciseRowsHtml(V.exQ) + '</section>';
  }

  // ----- Settings (gear icon in the top-right of each tab) -----
  function settingsButton() {
    return '<button class="icon-btn boxed" data-act="settings-open" aria-label="Settings">' + icon('settings') + '</button>';
  }
  // Settings: a list of rows (icon, label, current value, chevron), each opening a small page; every action is kept.
  var SET_PAGES = { account: 'Account', cloud: 'Cloud backup', file: 'Backup file', appearance: 'Appearance', prefs: 'Preferences', import: 'Import', about: 'About' };
  function viewSettings() {
    var page = SET_PAGES[V.setPage] ? V.setPage : null;
    var o = CLOUD.owner();
    var expired = CLOUD.status().state === 'signin';
    var lastFile = Number(lsGet(BACKUP_AT)) || 0;
    var themeName = { dark: 'Dark', light: 'Light', system: 'Match phone' }[S.settings.theme || 'dark'];
    var restName = S.settings.restSeconds ? Math.floor(S.settings.restSeconds / 60) + ':' + String(S.settings.restSeconds % 60).padStart(2, '0') + ' rest' : 'No rest timer';
    var row = function (act, ic, label, sub, extra) {
      return '<button class="set-row-btn" data-act="' + act + '"' + (extra || '') + '><span class="set-ic">' + icon(ic) + '</span>' +
        '<span class="set-txt"><strong>' + label + '</strong>' + (sub ? '<span>' + sub + '</span>' : '') + '</span>' + icon('next', 'sm chev') + '</button>';
    };
    var go = function (pg) { return ' data-v="' + pg + '"'; };
    if (!page) {
      return '<header class="top row"><button class="btn ghost sm" data-act="settings-back">' + icon('back', 'sm') + 'Back</button><span></span></header>' +
        '<header class="top"><h1>Settings</h1></header>' +
        (expired ? '<section class="card nudge" role="status"><p><b>Backup paused.</b> Your Google sign-in expired; sign in again to keep backing up.</p><button class="btn primary block" data-act="sign-in">Sign in again</button></section>' : '') +
        '<section class="card set-list" data-settings>' +
          row('set-page', 'user', 'Account', o ? esc(o.email || 'Google account') : 'Not signed in', go('account')) +
          row('set-page', 'cloud', 'Cloud backup', '<span data-sync-status>' + esc(syncText()) + '</span>', go('cloud')) +
          row('set-page', 'download', 'Backup file', lastFile ? 'Last saved ' + shortDate(new Date(lastFile).toISOString()) : 'Save or restore a file', go('file')) +
          row('export-csv', 'file', 'Export data (CSV)', 'Every set, for Excel, Numbers or Sheets') +
        '</section>' +
        '<section class="card set-list">' +
          row('set-page', 'sun', 'Appearance', themeName, go('appearance')) +
          row('set-page', 'settings', 'Preferences', unit() + ' · ' + restName + ' · RPE ' + (S.settings.rpe ? 'on' : 'off'), go('prefs')) +
          row('exercises-open', 'workouts', 'Exercises', 'How each is logged, your own exercises') +
          row('set-page', 'upload', 'Import', 'Fitbod history, routines from a plan', go('import')) +
          row('set-page', 'info', 'About', 'Version ' + VERSION + ' · privacy', go('about')) +
        '</section>' +
        '<button class="btn danger-ghost block" data-act="erase-all">Erase all my data</button>' + fileInputs();
    }
    var head = '<header class="top row"><button class="btn ghost sm" data-act="set-page" data-v="">' + icon('back', 'sm') + 'Settings</button><span></span></header>' +
      '<header class="top"><h1>' + SET_PAGES[page] + '</h1></header>';
    var body = '';
    if (page === 'account') {
      body = o ? '<section class="card" data-settings><p class="small">Signed in with Google as <strong>' + esc(o.email || 'Google account') + '</strong>. Only you can see your workouts.</p>' +
          (expired ? '<button class="btn primary block" data-act="sign-in">Sign in again</button>' : '') +
          '<button class="btn ghost block" data-act="sign-out">Sign out</button>' + diagHtml() + '</section>'
        : '<section class="card"><p class="muted small">Not signed in.</p></section>';
    } else if (page === 'cloud') {
      body = '<section class="card" data-settings><p class="set-status">' + icon('cloud', 'sm') + '<span data-sync-status>' + esc(syncText()) + '</span></p>' +
        '<p class="muted small">Automatic: every change goes to your account when you’re online, and comes back if you change phones.</p>' +
        (expired ? '<button class="btn primary block" data-act="sign-in">Sign in again</button>' : '') +
        '<button class="btn ghost block" data-act="sync-now">Back up now</button></section>';
    } else if (page === 'file') {
      body = '<section class="card"><p class="muted small">A copy you keep yourself, in Files or Downloads. ' + (lastFile ? 'Last saved on this phone ' + shortDate(new Date(lastFile).toISOString()) + '.' : 'None saved on this phone yet.') + '</p>' +
        '<button class="btn ghost block" data-act="export">' + icon('download', 'sm') + 'Export backup</button>' +
        '<button class="btn ghost block" data-act="import">' + icon('upload', 'sm') + 'Restore backup</button>' +
        '<p class="warn-note small">Restoring replaces everything, here and in your account.</p></section>' +
        '<section class="card"><p class="muted small">Need a spreadsheet instead? CSV has every set as a row. It can’t be restored.</p><button class="btn ghost block" data-act="export-csv">Export CSV</button></section>';
    } else if (page === 'appearance') {
      body = '<section class="card"><div class="setting"><span>Theme</span><div class="seg">' + [['dark', 'Dark'], ['light', 'Light'], ['system', 'Phone']].map(function (t) {
          var on = (S.settings.theme || 'dark') === t[0];
          return '<button class="' + (on ? 'on' : '') + '" data-act="set-theme" data-v="' + t[0] + '" aria-pressed="' + on + '"' + (t[0] === 'system' ? ' aria-label="Match phone"' : '') + '>' + t[1] + '</button>';
        }).join('') + '</div></div><p class="muted small">Phone follows your phone’s light or dark setting.</p></section>';
    } else if (page === 'prefs') {
      var rest = S.settings.restSeconds;
      var restChips = [[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']].map(function (r) {
        return '<button class="chip' + (rest === r[0] ? ' on' : '') + '" data-act="set-rest" data-v="' + r[0] + '" aria-pressed="' + (rest === r[0]) + '">' + r[1] + '</button>';
      }).join('');
      body = '<section class="card set-group">' +
        '<div class="setting"><span>Units</span><div class="seg"><button class="' + (unit() === 'lb' ? 'on' : '') + '" data-act="set-unit" data-v="lb" aria-pressed="' + (unit() === 'lb') + '">lb</button>' +
        '<button class="' + (unit() === 'kg' ? 'on' : '') + '" data-act="set-unit" data-v="kg" aria-pressed="' + (unit() === 'kg') + '">kg</button></div></div>' +
        '<div class="setting col"><span>Rest timer after each set</span><div class="chips">' + restChips + '</div></div>' +
        '<div class="setting"><span class="set-label">RPE<small>How hard each set felt, 1–10</small></span>' +
          '<div class="seg"><button class="' + (S.settings.rpe ? '' : 'on') + '" data-act="set-rpe" data-v="0" aria-pressed="' + !S.settings.rpe + '">Off</button><button class="' + (S.settings.rpe ? 'on' : '') + '" data-act="set-rpe" data-v="1" aria-pressed="' + !!S.settings.rpe + '">On</button></div></div>' +
        '<label class="setting"><span>Bar weight (' + unit() + ')</span><input class="bar-input" data-field="bar" inputmode="decimal" autocomplete="off" value="' + U.fmtNum(barFor(unit())) + '"></label></section>';
    } else if (page === 'import') {
      body = '<section class="card"><h2 class="card-title">Past workouts from Fitbod</h2><p class="muted small">Choose the CSV file Fitbod exports. Imported workouts never count as PRs, but later sessions have to beat them.</p>' +
        '<button class="btn ghost block" data-act="fitbod-pick">Choose Fitbod file</button>' + importsHtml() + '</section>' +
        '<section class="card"><h2 class="card-title">Routines from a plan</h2><p class="muted small">Paste one, or choose a PDF, text or CSV file.</p>' +
        '<button class="btn ghost block" data-act="plan-paste">Paste or import a routine</button></section>';
    } else if (page === 'about') {
      body = '<section class="card"><p class="small"><strong>PR Forge web ' + VERSION + '</strong></p><p class="muted small">' + S.workouts.length + ' workouts saved. Free, no ads, made for lifting with friends.</p>' +
        '<a class="btn ghost block" href="privacy.html">Privacy</a></section>';
    }
    return head + body + fileInputs();
  }
  function fileInputs() {
    return '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
      '<input type="file" id="fitbod-file" accept=".csv,text/csv,text/comma-separated-values" hidden>';
  }
  function importsHtml() {
    return S.imports.map(function (b) {
      var when = b.at ? new Date(b.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return '<div class="import-row"><span class="small">' + esc(b.source) + ' · ' + b.workouts + ' workout' + (b.workouts === 1 ? '' : 's') + (when ? ' · ' + when : '') + '</span>' +
        '<button class="btn ghost sm" data-act="import-undo" data-id="' + esc(b.id) + '">Undo</button></div>';
    }).join('');
  }

  // ----- Progress charts and lift detail -----
  var STATUS_LABEL = { progressing: 'Progressing', holding: 'Holding', stalled: 'Stalled', building: 'Building data', down: 'Down', paused: 'Paused' };
  var LAST_BAR = { progressing: 'last-accent', holding: 'last-soft', stalled: 'last-warn', building: 'last-soft', down: 'last-warn', paused: 'last-soft' };
  var STALL_IDEAS = {
    e1rm: ['Keep the weight and add one rep per set before adding load.', 'Take a lighter week (about 10% less weight), then build back.', 'Switch rep ranges for 3–4 weeks, e.g. sets of 5 to sets of 8.'],
    reps: ['Add one set at the end of the session.', 'Spread the same total reps over more, shorter sets.', 'Try a harder variation for a few weeks.'],
    seconds: ['Add 5 seconds to one hold each session.', 'Do one more hold per session.', 'Try a harder variation for a few weeks.']
  };
  function metricValue(metric, v) { return metric === 'e1rm' ? U.fmtNum(U.fromLb(v, unit())) : String(v); }
  function metricUnit(metric) { return metric === 'e1rm' ? unit() + ' est. 1RM' : metric === 'seconds' ? 'sec' : 'reps'; }
  function shortDate(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  function weekReadout(o) {
    return 'Week of ' + shortDate(o.weekStart) + ': ' + vol(o.volumeLb) + ' · ' + o.count + ' workout' + (o.count === 1 ? '' : 's');
  }
  /** Volume per week. Bars start at zero, so their heights can be compared. Tap a bar for its numbers. */
  function weeklyChart() {
    var series = M.weeklySeries(S.workouts, new Date(), 8);
    if (!series.some(function (o) { return o.count > 0; })) return '';
    var max = Math.max.apply(null, series.map(function (o) { return o.volumeLb; })) || 1;
    var f = M.workoutFrequency(S.workouts, new Date());
    var columns = series.map(function (o, i) {
      var h = o.volumeLb > 0 ? Math.max(3, (100 * o.volumeLb) / max) : 0;
      return '<button class="vol-col' + (i === series.length - 1 ? ' now' : '') + '" data-act="vol-tap" data-i="' + i + '" data-read="' + esc(weekReadout(o)) + '" aria-label="' + esc(weekReadout(o)) + '">' +
        '<span class="vol-bar" style="height:' + h.toFixed(1) + '%"></span></button>';
    }).join('');
    var labels = series.map(function (o, i) {
      var d = new Date(o.weekStart);
      return '<span' + (i === series.length - 1 ? ' class="now"' : '') + '>' + (i === series.length - 1 ? 'Now' : (d.getMonth() + 1) + '/' + d.getDate()) + '</span>';
    }).join('');
    return '<section class="card" aria-label="Weekly volume"><div class="pr-chart-head"><h2 class="card-title">Weekly volume</h2><span class="muted small">' + unit() + ' lifted · tap a bar</span></div>' +
      '<div class="vol-grid"><div class="vol-axis" aria-hidden="true"><span>' + volNum(max, unit()) + '</span><span>' + volNum(max / 2, unit()) + '</span><span>0</span></div>' +
        '<div class="vol-plot"><div class="vol-chart">' + columns + '</div><div class="vol-labels" aria-hidden="true">' + labels + '</div></div></div>' +
      '<p class="muted small" data-vol-read>' + esc(weekReadout(series[series.length - 1])) + '</p>' +
      '<p class="muted small">' + f.thisWeek + ' workout' + (f.thisWeek === 1 ? '' : 's') + ' this week · ' + U.fmtNum(f.priorAverage) + ' per week over the previous 4.</p></section>';
  }

  /** Body weight, in today's unit. Change is against the closest entry from about 30 days before the latest. */
  function bodyWeightCard() {
    var list = S.bodyWeights || [], u = unit();
    if (!list.length) return '<button class="btn ghost block" data-act="bw-open">' + icon('plus', 'sm') + 'Log body weight</button>';
    var val = function (b) { return U.convert(b.weight, b.unit, u); };
    var last = list[list.length - 1], lastT = new Date(last.date).getTime();
    var then = null;
    list.forEach(function (b) { var dt = lastT - new Date(b.date).getTime(); if (dt >= 21 * 864e5 && dt <= 60 * 864e5) then = b; });
    var change = then ? Math.round((val(last) - val(then)) * 10) / 10 : null;
    var recent = list.slice(-12).map(val);
    return '<section class="card" aria-label="Body weight"><div class="pr-chart-head"><h2 class="card-title">Body weight</h2><span class="muted small">' + shortDate(last.date) + '</span></div>' +
      '<div class="bw-row"><div><p class="st-total">' + U.fmtNum(Math.round(val(last) * 10) / 10) + '<small> ' + u + '</small></p>' +
      (change !== null ? '<span class="muted small">' + (change > 0 ? '+' : change < 0 ? '−' : '±') + U.fmtNum(Math.abs(change)) + ' ' + u + ' since ' + shortDate(then.date) + '</span>' : '<span class="muted small">' + list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + '</span>') + '</div>' +
      (recent.length > 1 ? sparkLine(recent, 'holding', 'Body weight, last ' + recent.length + ' entries') : '') + '</div>' +
      '<button class="btn ghost block" data-act="bw-open">Log body weight</button></section>';
  }
  function bodyWeightModal() {
    var u = unit(), list = (S.bodyWeights || []).slice(-8).reverse();
    var last = S.bodyWeights && S.bodyWeights.length ? S.bodyWeights[S.bodyWeights.length - 1] : null;
    var rows = list.map(function (b) {
      return '<li class="bw-item"><span>' + shortDate(b.date) + ' ' + new Date(b.date).getFullYear() + '</span><strong>' + U.fmtNum(b.weight) + ' ' + b.unit + '</strong>' +
        '<button class="icon-btn" data-act="bw-del" data-id="' + esc(b.id) + '" aria-label="Delete ' + U.fmtNum(b.weight) + ' ' + b.unit + ' on ' + shortDate(b.date) + '">' + icon('close', 'sm') + '</button></li>';
    }).join('');
    openModal('<h2>Body weight</h2>' +
      '<div class="field-pair"><label class="field"><span>Weight (' + u + ')</span><input id="bw-val" inputmode="decimal" autocomplete="off" placeholder="' + (last ? U.fmtNum(Math.round(U.convert(last.weight, last.unit, u) * 10) / 10) : '') + '"></label>' +
      '<label class="field"><span>Date</span><input id="bw-date" type="date" value="' + localDate(new Date().toISOString()) + '" max="' + localDate(new Date().toISOString()) + '"></label></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="modal-cancel">Close</button><button class="btn primary" data-act="bw-save">Save</button></div>' +
      (rows ? '<h3 class="card-title">Recent</h3><ul class="bw-list">' + rows + '</ul>' : '') +
      '<p class="muted small">Kept with your workouts and backed up to your account. Not used in any other number.</p>');
  }

  /** Working sets per muscle group, this week so far vs last week. Plain counts; no "ideal" ranges. */
  /** "today", "yesterday", "3 days ago"; past a month, "over a month ago". */
  function agoWords(days) {
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days <= 30 ? days + ' days ago' : 'over a month ago';
  }
  function agoShort(days) { return days <= 0 ? 'today' : days > 30 ? '30d+' : days + 'd'; }
  function trainingSplit() { return M.trainingSplit(S.workouts, function (id) { return exById(id).muscle; }, new Date()); }
  /**
   * Push · Pull · Legs: working sets this week vs last week and when each muscle was last trained, grouped by split.
   * A record of what you did, not a recovery estimate (the app never guesses how recovered a muscle is).
   */
  function muscleCard() {
    var groups = trainingSplit();
    if (!groups.length) return '';
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.muscles); });
    var max = Math.max.apply(null, all.map(function (r) { return Math.max(r.thisWeek, r.lastWeek); })) || 1;
    var html = groups.map(function (g) {
      var rows = g.muscles.map(function (r) {
        return '<li class="mus-row ppl"><span class="mus-name">' + esc(r.muscle) + '</span>' +
          '<span class="mus-track" aria-hidden="true"><span class="mus-last" style="width:' + (100 * r.lastWeek / max).toFixed(1) + '%"></span>' +
          '<span class="mus-now" style="width:' + (100 * r.thisWeek / max).toFixed(1) + '%"></span></span>' +
          '<span class="mus-num" aria-label="' + r.thisWeek + ' sets this week, ' + r.lastWeek + ' last week">' + r.thisWeek + '<small> / ' + r.lastWeek + '</small></span>' +
          '<span class="mus-ago" aria-label="last trained ' + agoWords(r.days) + '">' + agoShort(r.days) + '</span></li>';
      }).join('');
      return '<div class="ppl-group"><div class="ppl-head"><strong>' + g.name + '</strong><span class="muted small">Last trained ' + agoWords(g.days) + '</span>' +
        '<span class="mus-num" aria-label="' + g.thisWeek + ' sets this week, ' + g.lastWeek + ' last week">' + g.thisWeek + '<small> / ' + g.lastWeek + '</small></span></div>' +
        '<ul class="mus-list">' + rows + '</ul></div>';
    }).join('');
    return '<section class="card" aria-label="Push, pull, legs"><div class="pr-chart-head"><h2 class="card-title">Push · Pull · Legs</h2><span class="muted small">sets: this week / last</span></div>' +
      html +
      '<p class="muted small">Working sets from Monday by each exercise’s main muscle (bench press counts for chest); the faint bar is last week. The right column is days since you last trained it: what you did, not a guess at recovery.</p></section>';
  }
  /** Today: one line showing when push, pull and legs were last trained, to help pick the next workout. */
  function splitStrip() {
    var groups = trainingSplit().filter(function (g) { return g.id !== 'core'; });
    if (!groups.length) return '';
    return '<div class="ppl-strip" aria-label="Last trained">' + groups.map(function (g) {
      return '<span class="ppl-chip"><b>' + g.name + '</b><span>' + agoWords(g.days) + '</span></span>';
    }).join('') + '</div>';
  }

  /** One lift over time. Tap-free on purpose: the session list below it holds the same numbers. */
  var LIFT_RANGES = {
    '6w': { days: 42, label: '6 wk', words: '6 weeks' },
    '3m': { days: 91, label: '3 mo', words: '3 months' },
    '1y': { days: 365, label: '1 yr', words: 'year' },
    all: { days: 0, label: 'All' }
  };
  function liftChart(points, metric, status) {
    if (points.length < 2) return '<p class="muted small">Log another session to see a chart.</p>';
    var W = 320, H = 150, L = 8, R = 8, T = 22, B = 10;
    var vals = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    // Spaced by date, so a break from training shows as a gap instead of being squeezed out.
    var t0 = new Date(points[0].date).getTime(), t1 = new Date(points[points.length - 1].date).getTime();
    var xy = points.map(function (p, i) {
      var f = t1 > t0 ? (new Date(p.date).getTime() - t0) / (t1 - t0) : i / (points.length - 1);
      return [L + f * (W - L - R), T + (H - T - B) * (max === min ? 0.5 : 1 - (p.value - min) / span)];
    });
    var last = xy[xy.length - 1];
    var many = points.length > 40; // on long ranges only the latest session gets a dot
    var dots = xy.map(function (c, i) {
      if (many && i !== xy.length - 1) return '';
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="4"' + (i === xy.length - 1 ? ' class="dot-' + status + '"' : '') + '><title>' +
        shortDate(points[i].date) + ': ' + metricValue(metric, points[i].value) + ' ' + metricUnit(metric) + '</title></circle>';
    }).join('');
    var label = points.map(function (p) { return shortDate(p.date) + ' ' + metricValue(metric, p.value); }).join(', ');
    // A break of 8+ weeks is drawn as a faint dashed link, so time off doesn't look like a sudden drop.
    var GAP_MS = 56 * 86400000, lines = '', run = [xy[0]];
    var pt = function (c) { return c[0].toFixed(1) + ',' + c[1].toFixed(1); };
    for (var i = 1; i < xy.length; i++) {
      if (new Date(points[i].date) - new Date(points[i - 1].date) >= GAP_MS) {
        lines += (run.length > 1 ? '<polyline points="' + run.map(pt).join(' ') + '"/>' : '') + '<line class="gap" x1="' + xy[i - 1][0].toFixed(1) + '" y1="' + xy[i - 1][1].toFixed(1) + '" x2="' + xy[i][0].toFixed(1) + '" y2="' + xy[i][1].toFixed(1) + '"/>';
        run = [];
      }
      run.push(xy[i]);
    }
    if (run.length > 1) lines += '<polyline points="' + run.map(pt).join(' ') + '"/>';
    return '<svg class="lift-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(metricUnit(metric) + ' by session: ' + label) + '">' +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - 1) + '" y2="' + (H - 1) + '"/>' +
      lines + dots +
      '<text x="' + Math.min(last[0], W - R) + '" y="' + Math.max(12, last[1] - 10).toFixed(1) + '" text-anchor="end">' + metricValue(metric, points[points.length - 1].value) + '</text></svg>';
  }

  /** How it's logged, plus rename/delete for your own exercises. Shown on every exercise page. */
  function pinButton(ex) {
    var on = (S.settings.pinned || []).indexOf(ex.id) !== -1;
    return '<button class="btn ' + (on ? 'ghost' : 'ghost') + ' block" data-act="lift-pin" data-id="' + esc(ex.id) + '" aria-pressed="' + on + '">' +
      (on ? 'Unpin from Progress' : 'Pin to Progress (main lifts)') + '</button>';
  }
  function liftManageHtml(ex) {
    var kind = exKind(ex.id);
    var label = (EX.TRACKING.filter(function (t) { return t.id === kind; })[0] || {}).label || kind;
    return pinButton(ex) + '<section class="card"><h2 class="card-title">Settings</h2>' +
      '<div class="setting"><span>Logged as<br><span class="muted small">' + esc(label) + '. Applies the next time you add it.</span></span>' +
      '<button class="btn ghost sm" data-act="ex-default-type" data-id="' + esc(ex.id) + '">Change</button></div>' +
      '<div class="setting"><span>Sides<br><span class="muted small">' + (sideLabel(ex) ? 'One ' + ex.side + ' at a time (' + sideLabel(ex).toLowerCase() + ')' : 'Both sides together') + '</span></span>' +
      '<button class="btn ghost sm" data-act="ex-sides" data-id="' + esc(ex.id) + '" aria-label="Change sides for ' + esc(ex.name) + '">Change</button></div>' +
      (ex.custom ? '<div class="row-2"><button class="btn ghost" data-act="custom-rename" data-id="' + esc(ex.id) + '">Rename</button>' +
        '<button class="btn danger-ghost" data-act="custom-delete" data-id="' + esc(ex.id) + '">Delete</button></div>' : '') + '</section>';
  }
  function exerciseInUse(id) {
    var inWk = function (wk) { return wk.exercises.some(function (e) { return e.exerciseId === id; }); };
    return S.workouts.filter(inWk).length + (S.active && inWk(S.active) ? 1 : 0) + S.templates.filter(inWk).length;
  }
  function viewLift() {
    var trend = M.liftTrends(S.workouts, new Date(), 36500).filter(function (t) { return t.exerciseId === V.liftId; })[0];
    var back = '<header class="top row"><button class="btn ghost sm" data-act="lift-back">' + icon('back', 'sm') + (V.liftFrom === 'exercises' ? 'Exercises' : 'Progress') + '</button><span></span></header>';
    var ex = exById(V.liftId);
    if (!trend) {
      return back + '<header class="top"><h1>' + esc(ex.name) + '</h1>' + (sideLabel(ex) ? '<span class="muted">' + sideLabel(ex) + '</span>' : '') + '</header>' +
        '<section class="card empty"><p class="muted small">No sessions logged yet' + (exKind(ex.id) === 'assisted' ? ', and assisted lifts have no trend' : '') + '. Its chart and records appear after you log it.</p></section>' +
        liftManageHtml(ex);
    }
    var range = LIFT_RANGES[V.liftRange] || LIFT_RANGES['3m'];
    var cutoff = range.days ? Date.now() - range.days * 86400000 : -Infinity;
    var shown = trend.points.filter(function (p) { return new Date(p.date).getTime() >= cutoff; });
    var rangeBtns = Object.keys(LIFT_RANGES).map(function (id) {
      var on = range === LIFT_RANGES[id];
      return '<button class="' + (on ? 'on' : '') + '" data-act="lift-range" data-v="' + id + '" aria-pressed="' + on + '">' + LIFT_RANGES[id].label + '</button>';
    }).join('');
    var chart = shown.length >= 2 ? liftChart(shown, trend.metric, trend.status)
      : '<p class="muted small">' + (shown.length ? 'Only one session' : 'No sessions') + (range.days ? ' in the last ' + range.words : ' so far') + '.' + (trend.points.length > shown.length ? ' Try a longer range.' : '') + '</p>';
    if (shown.length >= 2) {
      var top = shown.reduce(function (a, p) { return p.value > a.value ? p : a; });
      chart += '<div class="pr-chart-foot"><span>' + shortDate(shown[0].date) + ' ' + new Date(shown[0].date).getFullYear() + '</span><span>' + shortDate(shown[shown.length - 1].date) + '</span></div>' +
        '<p class="muted small">' + shown.length + ' sessions · best ' + metricValue(trend.metric, top.value) + ' ' + metricUnit(trend.metric) + ' on ' + shortDate(top.date) + ' ' + new Date(top.date).getFullYear() + '</p>';
    }
    var sessions = trend.points.slice().reverse().map(function (p) {
      var bestSet = p.set ? U.fmtNum(U.fromLb(p.set.weightLb, unit())) + ' ' + unit() + ' × ' + p.set.reps + ' · ' : '';
      return '<li><button class="session-row" data-act="history-open" data-id="' + esc(p.workoutId) + '"><span>' + shortDate(p.date) + ' ' + new Date(p.date).getFullYear() + '</span>' +
        '<span class="session-val">' + bestSet + metricValue(trend.metric, p.value) + ' ' + metricUnit(trend.metric).replace(unit() + ' ', '') + '</span></button></li>';
    }).join('');
    var ideas = trend.status === 'stalled' || trend.status === 'down'
      ? '<section class="card"><h2 class="card-title">Ideas to try</h2><ul class="ideas">' + STALL_IDEAS[trend.metric].map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></section>'
      : '';
    return back +
      '<header class="top"><h1>' + esc(ex.name) + '</h1>' + (sideLabel(ex) ? '<span class="muted">' + sideLabel(ex) + '</span>' : '') + '</header>' +
      '<div class="lift-head"><span class="trend-num">' + metricValue(trend.metric, trend.best) + '<small> ' + metricUnit(trend.metric) + ' best, 90 days</small></span>' +
      '<span class="pill ' + trend.status + '">' + STATUS_LABEL[trend.status] + '</span></div>' +
      '<p class="lede">' + trend.text + '. ' + trend.totalSessions + ' session' + (trend.totalSessions === 1 ? '' : 's') + ' logged' + allTimeNote(trend) + '.</p>' +
      '<section class="card"><h2 class="card-title">Each session’s best</h2><div class="seg seg-full" role="group" aria-label="Chart range">' + rangeBtns + '</div>' +
      chart + '</section>' +
      ideas +
      '<section class="card"><h2 class="card-title">Record</h2><ul class="prs">' + recordsHtml(ex.id) + '</ul></section>' +
      '<section class="card"><h2 class="card-title">Sessions</h2><ul class="session-list">' + sessions + '</ul></section>' +
      liftManageHtml(ex) +
      '<p class="muted small tip">Trends are an early signal, not a diagnosis. Fatigue, technique and rep range all affect them.</p>';
  }

  // ----- Sign in (required before the app can be used) -----
  function viewSignIn() {
    var err = CLOUD.signInError();
    var busy = CLOUD.returningFromSignIn() && !err;
    var hasData = S.workouts.length > 0 || S.templates.length > 0 || !!S.active;
    return '<section class="greet">' +
      '<h1>' + (busy ? 'Signing you in…' : 'Sign in') + '</h1>' +
      (busy ? '<p class="lede">Hang on a second.</p>' :
        '<p class="lede">Your workouts are kept on this phone and backed up to your own account, so they come back if you change phones. Only you can see them.</p>' +
        (hasData ? '<p class="small">The workouts already on this phone will be backed up when you sign in.</p>' : '') +
        (CLOUD.waitingForSignIn() && !err ? '<p class="small">Signed in with Google already? Tap Done in that window to come back; this screen updates by itself in a few seconds.</p>' : '') +
        (err ? '<p class="small warn-text">' + esc(err) + '</p>' : '') +
        (navigator.onLine ? '' : '<p class="small warn-text">You’re offline. Signing in needs a connection the first time; after that the app works without one.</p>') +
        '<div class="foot-actions"><button class="btn primary block" data-act="sign-in">Continue with Google</button>' +
        '<a class="muted small center privacy-link" href="privacy.html">Privacy: what’s stored and how to delete it</a></div>' +
        diagHtml()) +
      '</section>';
  }

  /** Sign-in diagnostics, folded away: open it only when sign-in misbehaves. */
  function diagHtml() {
    return '<details class="how diag"><summary>Sign-in details</summary><p class="muted small">' + esc(CLOUD.diagnostics()) + '</p></details>';
  }

  // Shown in the browser sheet iPhone opens for Google, after it has passed the sign-in to the app.
  function viewHandedOff() {
    return '<section class="greet"><h1>You’re signed in</h1>' +
      '<p class="lede">Tap <strong>Done</strong> (or close this window) to go back to PR Forge. It will finish signing you in there.</p>' +
      '<p class="muted small">If PR Forge still shows Sign in after a few seconds, tap Continue with Google there once more.</p></section>';
  }

  // Shown on a phone with no data yet, while the first download after signing in runs.
  function viewRestoring() {
    return '<section class="greet">' +
      '<h1>Loading your workouts…</h1><p class="lede">Getting everything from your account. This only happens the first time on this phone.</p></section>';
  }

  // ----- Account and backup status (Progress → Settings) -----
  function syncText() {
    var st = CLOUD.status(), n = CLOUD.pending(), last = CLOUD.lastSyncAt();
    var waiting = n ? n + (n === 1 ? ' change' : ' changes') + ' waiting to upload.' : '';
    if (st.state === 'syncing') return 'Backing up…';
    if (st.state === 'offline') return 'Offline. ' + (waiting ? waiting.replace('.', '') + ' when you’re back online.' : 'Everything was backed up.');
    if (st.state === 'signin') return 'Your Google sign-in expired. Sign in again to keep backing up.' + (waiting ? ' ' + waiting : '');
    if (st.state === 'error') return 'Backup problem: ' + (st.message || 'unknown error') + '. ' + waiting;
    if (n) return waiting;
    if (last) {
      var mins = Math.round((Date.now() - new Date(last)) / 60000);
      return 'Backed up ' + (mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : relDay(last).toLowerCase()) + '.';
    }
    return 'Not backed up yet.';
  }
  function showSyncStatus() {
    var el = document.querySelector('[data-sync-status]');
    if (el) el.textContent = syncText();
    var need = CLOUD.status().state === 'signin';
    // Pages that show "Sign in again" when the sign-in expired: redraw when that changes.
    var showsSignIn = V.screen === 'settings' && (!V.setPage || V.setPage === 'account' || V.setPage === 'cloud');
    var btn = document.querySelector('#app [data-act="sign-in"]');
    if (showsSignIn && need !== !!btn) render();
  }

  // ----- First open -----
  // A one-time joke question before setup. Both answers are yes.
  // Every answer is a yes. Two different ones are picked each time the question shows.
  var GREET_YES = ['Hell yes', 'Obviously', 'Absolutely', 'Duh', 'Hell yeah', 'Yup', 'No cap', 'Facts', 'Big facts', 'Fo sho',
    'You know it', 'Bet', 'Damn right', '100%', 'Say less', 'Periodt', 'Yessir', 'Without a doubt', 'Abso-freakin-lutely',
    'For real', 'Totally', 'Yasss', 'Indubitably', 'Naturally', 'Is water wet?', 'Was that a question?'];
  function viewGreet() {
    if (!V.greetPick) {
      var i = Math.floor(Math.random() * GREET_YES.length);
      var j = Math.floor(Math.random() * (GREET_YES.length - 1));
      if (j >= i) j++;
      V.greetPick = [GREET_YES[i], GREET_YES[j]];
    }
    return '<section class="greet"><h1 class="big">Are you a sexy ass bitch?</h1>' +
      '<div class="foot-actions"><button class="btn primary block" data-act="greet-yes">' + esc(V.greetPick[0]) + '</button>' +
      '<button class="btn primary block" data-act="greet-yes">' + esc(V.greetPick[1]) + '</button></div></section>';
  }
  function viewSetup() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var rest = S.settings.restSeconds;
    var restChips = [[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']].map(function (r) {
      return '<button class="chip' + (rest === r[0] ? ' on' : '') + '" data-act="set-rest" data-v="' + r[0] + '" aria-pressed="' + (rest === r[0]) + '">' + r[1] + '</button>';
    }).join('');
    return '<header class="setup-head"><img class="setup-logo" src="icons/logo.png" alt="PR Forge logo" onerror="this.remove()"><h1>Welcome</h1>' +
      '<p class="lede">A simple lifting log. Faded numbers show last session, and one tap confirms a set.</p></header>' +
      '<section class="card"><h2 class="card-title">Good to know</h2><ul class="ideas">' +
      '<li><strong>Backed up to your account.</strong> Only you can see your workouts, and signing in on a new phone brings them back.</li>' +
      '<li><strong>Works without signal.</strong> Log as normal; changes back up when you’re online again.</li></ul></section>' +
      (standalone ? '' : '<section class="card"><h2 class="card-title">Put it on your home screen</h2>' +
        '<p class="small">On iPhone, open this page in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Always open it from that icon: its workouts are kept separately from the Safari tab, and are less likely to be cleared.</p></section>') +
      '<section class="card"><h2 class="card-title">Your setup</h2>' +
      '<div class="setting"><span>Units</span><div class="seg"><button class="' + (unit() === 'lb' ? 'on' : '') + '" data-act="set-unit" data-v="lb" aria-pressed="' + (unit() === 'lb') + '">lb</button>' +
      '<button class="' + (unit() === 'kg' ? 'on' : '') + '" data-act="set-unit" data-v="kg" aria-pressed="' + (unit() === 'kg') + '">kg</button></div></div>' +
      '<div class="setting col"><span>Rest timer after each set</span><div class="chips">' + restChips + '</div></div></section>' +
      '<div class="foot-actions"><button class="btn primary block" data-act="setup-done">Get started</button>' +
      '<button class="btn ghost block" data-act="fitbod-pick">Import past workouts from Fitbod</button></div>' +
      fileInputs();
  }

  // ----- Editing a past workout -----
  function localDate(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function viewEditWorkout() {
    var d = V.edit.draft;
    var cards = d.exercises.map(function (entry) {
      var ex = exById(entry.exerciseId), side = sideLabel(ex), kind = entryKind(entry);
      var rows = entry.sets.map(function (s, i) {
        return setRowHtml(entry, s, { scope: 'edit', u: d.unit, hint: null, kind: kind, side: side, n: i + 1, workIdx: kindIndex(entry, s) + 1, active: false });
      }).join('');
      return '<section class="card ex-card" aria-label="' + esc(ex.name) + '"><div class="ex-head"><div class="ex-head-text"><h2>' + esc(ex.name) + '</h2>' +
        '<p class="ex-meta">' + esc(ex.equipment) + (side ? ' · ' + side : '') + ' · ' + trackingLabel(kind) + '</p></div>' +
        '<div class="ex-tools"><button class="icon-btn" data-act="edit-ex-remove" data-e="' + entry.id + '" aria-label="Remove ' + esc(ex.name) + '">' + icon('close', 'sm') + '</button></div></div>' +
        setHeadHtml(kind, d.unit, side) + rows +
        '<div class="ex-actions"><button class="btn ghost sm" data-act="edit-set-add" data-e="' + entry.id + '">' + icon('plus', 'sm') + 'Add set</button></div></section>';
    }).join('');
    return '<header class="top row"><button class="btn ghost sm" data-act="edit-cancel">' + icon('back', 'sm') + 'Cancel</button><h1 class="h-sm">Edit workout</h1><span></span></header>' +
      '<section class="card"><label class="field"><span>Name</span><input data-field="edit-name" maxlength="60" value="' + esc(d.name) + '"></label>' +
      '<label class="field"><span>Date</span><input type="date" data-field="edit-date" value="' + localDate(d.startedAt) + '" max="' + localDate(new Date().toISOString()) + '"></label>' +
      '<div class="field-pair"><label class="field"><span>Started</span><input type="time" data-field="edit-time" value="' + localTime(d.startedAt) + '"></label>' +
      '<label class="field"><span>Duration (min)</span><input data-field="edit-mins" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="—" value="' + editMinutes(d) + '"></label></div>' +
      '<p class="muted small">Left a workout running? Set how long it really took. Changing the time doesn’t affect PRs.</p></section>' +
      cards +
      '<button class="btn ghost block" data-act="edit-ex-add">' + icon('plus', 'sm') + 'Add exercise</button>' +
      '<p class="muted small tip">Saving changes means this workout no longer counts as a PR. Later sessions still have to beat its numbers. Sets with nothing entered are dropped.</p>' +
      '<button class="btn primary block" data-act="edit-save">Save changes</button>';
  }
  function localTime(iso) {
    var t = new Date(iso);
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  /** Whole minutes for the duration box; blank when there's no real duration (e.g. an import with one timestamp). */
  function editMinutes(d) {
    var m = Math.round((new Date(d.endedAt) - new Date(d.startedAt)) / 60000);
    return m >= 1 ? String(m) : '';
  }
  var MAX_EDIT_MINUTES = 720;
  function editEntry(eid) {
    if (!V.edit) return null;
    return V.edit.draft.exercises.filter(function (e) { return e.id === eid; })[0] || null;
  }
  function saveEdit() {
    if (V.edit.minsBad) { toast('Duration: enter minutes from 1 to ' + MAX_EDIT_MINUTES, 'warn', 3500); return; }
    var d = V.edit.draft;
    // Saving with no changes keeps any PR badge, and so does changing only the time or duration.
    var setsOnly = function (w) { return JSON.stringify(Object.assign({}, w, { startedAt: null, endedAt: null })); };
    var changed = setsOnly(d) !== setsOnly(JSON.parse(V.edit.original));
    d.exercises = d.exercises.map(function (e) {
      var sets = e.sets.filter(function (s) {
        return entryKind(e) === 'timed' ? Number(s.seconds) > 0 : Number(s.reps) > 0;
      }).map(function (s) {
        s.done = true;
        if (s.weight == null) s.weight = 0;
        return s;
      });
      return { id: e.id, exerciseId: e.exerciseId, tracking: e.tracking, superNext: !!e.superNext, sets: sets };
    }).filter(function (e) { return e.sets.length > 0; });
    if (!d.exercises.length) { toast('Keep at least one set, or delete this workout from History', 'warn', 3500); return; }
    d.name = (d.name || '').trim() || 'Workout';
    if (changed) d.edited = true;
    S.workouts = S.workouts.map(function (x) { return x.id === d.id ? d : x; });
    V.edit = null;
    V.screen = 'historyDetail';
    commit();
    toast('Saved');
  }

  // ----- History -----
  function findWorkout(id) {
    for (var i = 0; i < S.workouts.length; i++) if (S.workouts[i].id === id) return S.workouts[i];
    return null;
  }

  function viewHistory() {
    var list = M.finished(S.workouts).slice().reverse();
    if (!list.length) {
      return '<header class="top row"><h1>History</h1>' + settingsButton() + '</header><section class="card empty"><p>No finished workouts yet.</p><p class="muted small">Workouts show up here when you tap Finish.</p></section>';
    }
    var prCount = {};
    M.prEvents(S.workouts).forEach(function (e) { prCount[e.workoutId] = (prCount[e.workoutId] || 0) + 1; });
    var html = '', month = '';
    list.forEach(function (wk) {
      var d = new Date(wk.startedAt);
      var m = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (m !== month) { html += '<h2 class="month">' + m + '</h2>'; month = m; }
      var names = wk.exercises.map(function (e) { return exById(e.exerciseId).name; });
      html += '<button class="card hist" data-act="history-open" data-id="' + esc(wk.id) + '">' +
        '<div class="hist-top"><span class="hist-name">' + esc(wk.name) + '</span><span class="muted small hist-date">' + relDay(wk.startedAt) + '</span></div>' +
        '<span class="hist-meta">' + (wk.imported ? '<span class="tag">Imported</span>' : '') + (workoutDuration(wk) ? '<span>' + icon('history', 'sm') + workoutDuration(wk) + '</span>' : '') +
          '<span>' + icon('layers', 'sm') + M.workoutSetCount(wk) + ' sets</span><span>' + vol(M.workoutVolumeLb(wk)) + '</span></span>' +
        '<span class="ex-names">' + esc(names.slice(0, 4).join(' · ')) + (names.length > 4 ? ' +' + (names.length - 4) + ' more' : '') + '</span>' +
        (prCount[wk.id] ? '<span class="pr-badge">' + icon('trophy', 'sm') + prCount[wk.id] + ' PR' + (prCount[wk.id] === 1 ? '' : 's') + '</span>' : '') +
        '</button>';
    });
    return '<header class="top row"><h1>History</h1>' + settingsButton() + '</header>' + html;
  }

  function viewHistoryDetail() {
    var wk = findWorkout(V.historyId);
    var isSummary = V.summary === wk.id;
    var prByEx = {};
    M.prEvents(S.workouts).forEach(function (e) { if (e.workoutId === wk.id) prByEx[e.exerciseId] = e; });
    var ex = wk.exercises.map(function (entry) {
      var e = exById(entry.exerciseId);
      var evt = prByEx[entry.exerciseId];
      var marked = false, volLb = 0, working = 0;
      var sets = entry.sets.filter(function (s) { return s.done; }).map(function (s) {
        volLb += M.setVolumeLb(s, wk.unit);
        if (!s.warmup) working++;
        var isPr = false;
        if (evt && !marked && !s.warmup) {
          isPr = evt.type === 'seconds' ? Number(s.seconds) === evt.seconds
            : Number(s.reps) === evt.reps && (evt.type === 'e1rm' ? Math.abs(U.toLb(s.weight, wk.unit) - evt.weightLb) < 0.01 : !(Number(s.weight) > 0));
          marked = isPr;
        }
        return '<span class="set-chip' + (s.warmup ? ' warm' : '') + (isPr ? ' is-pr' : '') + '">' + (s.warmup ? 'W ' : '') + setText(s) + '</span>';
      }).join('');
      var side = sideLabel(e) ? sideLabel(e).toLowerCase() : '';
      var meta = (volLb > 0 ? U.fmtVolumeLb(volLb, wk.unit) : working + ' set' + (working === 1 ? '' : 's')) + (side ? ' · ' + side : '');
      return '<div class="log"><div class="log-head"><h2 class="h-lift">' + esc(e.name) + '</h2><span class="log-vol">' + meta + '</span></div><div class="set-chips">' + sets + '</div></div>';
    }).join('');
    var wins = Object.keys(prByEx).map(function (id) { return prWin(wk, prByEx[id]); }).join('');
    var d = new Date(wk.startedAt);
    var dur = workoutDuration(wk) ? workoutDuration(wk).replace(/ ?(h|min)/g, '<small> $1</small>') : '—';
    var stats = '<section class="stats" aria-label="Totals">' + stat('Duration', dur) + stat('Working sets', String(M.workoutSetCount(wk))) +
      stat(wk.unit + ' volume', volNum(M.workoutVolumeLb(wk), wk.unit)) + '</section>';
    var log = '<section class="log-list" aria-label="Sets">' + ex + '</section>';
    if (isSummary) {
      return '<header class="top"><span class="eyebrow on">' + icon('check', 'sm') + 'Workout saved</span><h1 class="big">' + esc(wk.name) + '</h1>' +
        '<span class="muted">' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + '</span></header>' +
        stats + wins + log +
        '<div class="foot-actions"><button class="btn primary block" data-act="summary-done">Done</button>' +
        '<div class="row-2"><button class="btn ghost" data-act="history-edit">Edit this workout</button><button class="btn ghost" data-act="history-to-template">Save as routine</button></div></div>';
    }
    var flag = wk.imported ? 'Imported' : wk.edited ? 'Edited' : '';
    return '<header class="top row"><button class="btn ghost sm" data-act="history-back">' + icon('back', 'sm') + 'History</button><span></span></header>' +
      '<header class="top"><p class="eyebrow">' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (flag ? ' · ' + flag : '') + '</p><h1>' + esc(wk.name) + '</h1></header>' +
      stats + wins + log +
      '<div class="foot-actions"><button class="btn ghost block" data-act="history-edit">Edit this workout</button>' +
      '<button class="btn ghost block" data-act="history-to-template">Save as routine</button>' +
      '<button class="btn danger-ghost block" data-act="history-delete">Delete this workout</button></div>';
  }
  function prWin(wk, evt) {
    var detail = evt.type === 'seconds' ? evt.seconds + ' sec' : evt.reps + ' reps';
    if (evt.type === 'e1rm') {
      var prior = 0;
      M.sessionsFor(S.workouts, evt.exerciseId).forEach(function (s) {
        if (new Date(s.date) < new Date(evt.date)) prior = Math.max(prior, s.topE1rm);
      });
      detail = U.fmtNum(U.fromLb(evt.weightLb, wk.unit)) + ' × ' + evt.reps + ' · est. 1RM ' + U.fmtWeightLb(evt.e1rmLb, wk.unit) +
        ' (+' + U.fmtNum(U.fromLb(evt.e1rmLb - prior, wk.unit)) + ')';
    }
    return '<section class="pr-win" aria-label="Personal record"><span class="pr-win-icon">' + icon('trophy') + '</span>' +
      '<div class="pr-win-text"><strong>PR · ' + esc(exById(evt.exerciseId).name) + '</strong><span>' + detail + '</span></div></section>';
  }

  // ----- Exercise picker -----
  function pickerResults() {
    var p = V.picker;
    var q = (p.q || '').toLowerCase().trim();
    var words = q ? q.split(/\s+/) : [];
    return allExercises().filter(function (e) {
      if (p.muscle && e.muscle !== p.muscle) return false;
      var hay = (e.name + ' ' + (e.alias || '') + ' ' + e.muscle + ' ' + e.equipment).toLowerCase();
      return words.every(function (wd) { return hay.indexOf(wd) !== -1; });
    }).sort(function (a, b) {
      return (a.library ? 1 : 0) - (b.library ? 1 : 0) || a.name.localeCompare(b.name);
    });
  }
  function pickerListHtml() {
    var p = V.picker;
    var results = pickerResults();
    var firstMore = results.filter(function (e) { return e.library; })[0];
    var hasCommon = results[0] && !results[0].library;
    var rows = results.map(function (e) {
      var on = !!p.selected[e.id];
      return (e === results[0] && hasCommon ? '<h3 class="pick-group">Common</h3>' : '') +
        (e === firstMore ? '<h3 class="pick-group">' + (hasCommon ? 'More exercises' : 'All matches') + '</h3>' : '') +
        '<button class="pick' + (on ? ' on' : '') + '" data-act="picker-toggle" data-id="' + esc(e.id) + '" aria-pressed="' + on + '">' +
        '<span class="pick-text"><strong>' + esc(e.name) + '</strong><span class="muted small">' + esc(e.muscle) + ' · ' + esc(e.equipment) +
        (sideLabel(exById(e.id)) ? ' · ' + sideLabel(exById(e.id)) : '') + (e.custom ? ' · Custom' : '') + '</span></span>' +
        '<span class="pick-box">' + (on ? icon('check') : '') + '</span></button>';
    }).join('');
    return rows || '<p class="muted small center pad">No matches. You can create it as a custom exercise.</p>';
  }
  function pickerFooter() {
    if (V.picker.target === 'swap') {
      return '<button class="btn ghost" data-act="picker-custom">Create custom</button><button class="btn ghost" data-act="picker-close">Cancel</button>';
    }
    var n = Object.keys(V.picker.selected).length;
    return '<button class="btn ghost" data-act="picker-custom">Create custom</button>' +
      '<button class="btn primary" data-act="picker-confirm"' + (n ? '' : ' disabled') + '>' + (n ? 'Add ' + n : 'Add') + '</button>';
  }
  function viewPicker() {
    var p = V.picker;
    var chips = ['All'].concat(EX.MUSCLES, ['Other']).map(function (m) {
      var on = (m === 'All' && !p.muscle) || m === p.muscle;
      return '<button class="chip' + (on ? ' on' : '') + '" data-act="picker-muscle" data-v="' + esc(m) + '">' + esc(m) + '</button>';
    }).join('');
    var title = p.target === 'swap' ? 'Swap exercise' : 'Add exercises';
    return '<div class="sheet-wrap"><div class="backdrop" data-act="picker-close"></div><div class="sheet" role="dialog" aria-label="' + title + '">' +
      '<div class="sheet-head"><h2>' + title + '</h2><button class="icon-btn" data-act="picker-close" aria-label="Close">' + icon('close') + '</button></div>' +
      '<input class="search" data-field="picker-q" type="search" placeholder="Search exercises" value="' + esc(p.q) + '" autocomplete="off">' +
      '<div class="chips scroll">' + chips + '</div>' +
      '<div class="pick-list" id="pick-list">' + pickerListHtml() + '</div>' +
      '<div class="sheet-foot" id="pick-foot">' + pickerFooter() + '</div></div></div>';
  }
  function refreshPicker() {
    var list = document.getElementById('pick-list');
    var foot = document.getElementById('pick-foot');
    if (list) list.innerHTML = pickerListHtml();
    if (foot) foot.innerHTML = pickerFooter();
  }

  function customExerciseForm() {
    var opts = function (list) { return list.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    V.modal = { resolve: null };
    openModal('<h2>Custom exercise</h2>' +
      '<label class="field"><span>Name</span><input id="cx-name" maxlength="80" placeholder="e.g. Belt Squat" value="' + esc(V.picker ? V.picker.q : '') + '"></label>' +
      '<label class="field"><span>Main muscle</span><select id="cx-muscle">' + opts(EX.MUSCLES.concat(['Other'])) + '</select></label>' +
      '<label class="field"><span>Equipment</span><select id="cx-equip">' + opts(EX.EQUIPMENT) + '</select></label>' +
      '<label class="field"><span>One side at a time?</span><select id="cx-side"><option value="">No — both sides together</option><option value="arm">Yes — per arm</option><option value="leg">Yes — per leg</option></select></label>' +
      '<label class="field"><span>How do you log it?</span><select id="cx-type">' + EX.TRACKING.map(function (t) { return '<option value="' + t.id + '">' + t.label + '</option>'; }).join('') + '</select></label>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="modal-cancel">Cancel</button><button class="btn primary" data-act="custom-save">Save</button></div>');
  }

  // ---------- actions ----------
  function findEntry(eid) {
    if (!S.active) return null;
    for (var i = 0; i < S.active.exercises.length; i++) if (S.active.exercises[i].id === eid) return S.active.exercises[i];
    return null;
  }
  function findSet(entry, sid) {
    for (var i = 0; i < entry.sets.length; i++) if (entry.sets[i].id === sid) return entry.sets[i];
    return null;
  }
  /** The superset an entry belongs to: the run of exercises linked by superNext (just [entry] when none). */
  function supersetOf(list, entry) {
    var i = list.indexOf(entry); if (i < 0) return [entry];
    var a = i, b = i;
    while (a > 0 && list[a - 1].superNext) a--;
    while (b < list.length - 1 && list[b].superNext) b++;
    return list.slice(a, b + 1);
  }
  /** "Superset A", "Superset B"… for linked exercises, by entry id. */
  function supersetNames(list) {
    var out = {}, letter = 0;
    for (var i = 0; i < list.length; i++) {
      var g = supersetOf(list, list[i]);
      if (g.length > 1 && g[0] === list[i]) { var name = 'Superset ' + String.fromCharCode(65 + letter++); g.forEach(function (e) { out[e.id] = name; }); }
    }
    return out;
  }
  /** Hint for a set: last session's matching set, following any weight change made earlier today. */
  function setHint(entry, set, last, u) {
    var plan = entry.target ? M.progressionFor(last, entry.target, u, entryKind(entry)) : null;
    var today = [];
    for (var i = 0; i < entry.sets.length && entry.sets[i] !== set; i++) {
      var p = entry.sets[i];
      if (p.done && !!p.warmup === !!set.warmup) today.push({ weight: p.weight, reps: p.reps, seconds: p.seconds });
    }
    return M.hintForSet(last, kindIndex(entry, set), u, set.warmup, today, plan);
  }
  /** Position of a set among sets of the same kind (working or warm-up) in its exercise. */
  function kindIndex(entry, set) {
    var n = 0;
    for (var i = 0; i < entry.sets.length && entry.sets[i] !== set; i++) if (!!entry.sets[i].warmup === !!set.warmup) n++;
    return n;
  }
  function newSet(kind) { return { id: uid(), weight: null, reps: null, seconds: null, done: false, warmup: false, tracking: kind || 'weight' }; }
  function newEntry(exerciseId, count) {
    var kind = exKind(exerciseId);
    var sets = [];
    for (var i = 0; i < count; i++) sets.push(newSet(kind));
    return { id: uid(), exerciseId: exerciseId, tracking: kind, sets: sets };
  }
  function setEntryType(entry, kind) {
    entry.tracking = kind;
    entry.sets = entry.sets.map(function () { return newSet(kind); });
    S.settings.exerciseTypes[entry.exerciseId] = kind;
    V.focusEntry = entry.id;
    commit();
  }
  function chooseType(entry) {
    V.typeEntry = entry.id;
    V.modal = { resolve: null };
    var current = entryKind(entry);
    openModal('<h2>How do you log it?</h2><div class="type-list">' + EX.TRACKING.map(function (t) {
      return '<button class="type-opt' + (t.id === current ? ' on' : '') + '" data-act="ex-type-set" data-v="' + t.id + '" aria-pressed="' + (t.id === current) + '"><strong>' + t.label + '</strong><span class="muted small">' + t.hint + '</span></button>';
    }).join('') + '</div><button class="btn ghost block" data-act="ex-sides" data-id="' + esc(entry.exerciseId) + '">' + (sideLabel(exById(entry.exerciseId)) || 'Both sides together') + ': change</button>' +
      '<button class="btn ghost block" data-act="modal-cancel">Cancel</button>');
  }
  /** Replaces the lift in place: same position and number of sets, values cleared so old numbers can't carry over. */
  function swapEntry(entryId, exerciseId) {
    var entry = findEntry(entryId);
    if (!entry) return;
    if (entry.exerciseId !== exerciseId) {
      if (S.active.exercises.some(function (e) { return e.exerciseId === exerciseId; })) {
        toast(esc(exById(exerciseId).name) + ' is already in this workout', 'warn');
        return;
      }
      entry.exerciseId = exerciseId;
      entry.tracking = exKind(exerciseId);
      entry.sets = entry.sets.map(function () { return newSet(entry.tracking); });
    }
    V.focusEntry = entry.id;
    V.picker = null;
    commit();
  }
  /** The open exercise card: the one tapped, otherwise the first with sets left (null when all are done). */
  function currentEntry() {
    var list = S.active.exercises;
    var tapped = list.filter(function (e) { return e.id === V.focusEntry; })[0];
    if (tapped) return tapped;
    return list.filter(function (e) { return e.sets.some(function (s) { return !s.done; }); })[0] || null;
  }

  function startWorkout(name, templateId, exercises) {
    if (S.active) {
      confirmBox('Workout already in progress', 'Finish or discard <b>' + esc(S.active.name) + '</b> before starting another.', 'Resume it').then(function (ok) {
        if (ok) { V.screen = 'workout'; render(); }
      });
      return;
    }
    S.active = {
      id: uid(), name: name, templateId: templateId || null,
      startedAt: new Date().toISOString(), endedAt: null, unit: unit(),
      exercises: (exercises || []).map(function (e) {
        var en = newEntry(e.exerciseId, e.sets);
        if (e.reps) en.target = { min: e.reps.min, max: e.reps.max };
        if (e.superNext) en.superNext = true;
        return en;
      })
    };
    V.screen = 'workout';
    V.rest = null;
    V.prShown = {};
    V.focusEntry = null;
    commit();
  }

  function toggleSet(eid, sid) {
    var entry = findEntry(eid); if (!entry) return;
    var set = findSet(entry, sid); if (!set) return;
    if (set.done) { set.done = false; commit(); return; }
    var hint = setHint(entry, set, M.lastSessionFor(S.workouts, entry.exerciseId, S.active.id), S.active.unit);
    var kind = entryKind(entry);
    set.tracking = kind;
    if (kind === 'timed') {
      if (set.seconds == null && hint && hint.seconds) set.seconds = hint.seconds;
      if (!(Number(set.seconds) > 0)) { toast('Enter seconds first', 'warn'); render(); return; }
      set.weight = 0;
    } else {
      if (kind !== 'bodyweight' && set.weight == null && hint) set.weight = hint.weight;
      if (set.reps == null && hint && hint.reps) set.reps = hint.reps;
      if (!(Number(set.reps) > 0)) { toast('Enter reps first', 'warn'); render(); return; }
      if (kind === 'bodyweight' || set.weight == null) set.weight = 0;
    }
    var odd = (kind === 'weight' || kind === 'weighted') && oddWeight(entry.exerciseId, Number(set.weight), S.active.unit);
    if (odd) {
      confirmBox('Is ' + U.fmtNum(set.weight) + ' ' + S.active.unit + ' right?', odd + ' Check for a typo; a wrong number would become a record that later sessions have to beat.', 'Yes, confirm').then(function (ok) {
        if (ok) markSetDone(entry, set); else { render(); var inp = document.querySelector('.set-row.active input[data-field="weight"]'); if (inp) inp.focus(); }
      });
      return;
    }
    markSetDone(entry, set);
  }
  /**
   * A weight worth double-checking before it's confirmed: over 1,000 lb / 450 kg, or more than 2.5 times (and
   * 50 lb / 20 kg more than) your heaviest working set of this lift. Returns the reason, or '' when it looks fine.
   */
  function oddWeight(exerciseId, w, u) {
    if (!(w > 0)) return '';
    if (w > (u === 'kg' ? 450 : 1000)) return 'That’s more than anyone has lifted for most exercises.';
    var best = 0;
    S.workouts.forEach(function (wk) {
      if (!wk.endedAt) return;
      wk.exercises.forEach(function (e) {
        if (e.exerciseId !== exerciseId) return;
        e.sets.forEach(function (st) { if (st.done && !st.warmup && Number(st.weight) > 0) best = Math.max(best, U.convert(Number(st.weight), wk.unit, u)); });
      });
    });
    if (best > 0 && w > best * 2.5 && w - best > (u === 'kg' ? 20 : 50)) return 'Your heaviest so far is ' + U.fmtNum(Math.round(best * 10) / 10) + ' ' + u + '.';
    return '';
  }
  function markSetDone(entry, set) {
    set.done = true;
    S.active.lastSetAt = new Date().toISOString();
    vibrate(12);
    if (V.focusEntry === entry.id && entry.sets.every(function (s) { return s.done; })) V.focusEntry = null;
    // Superset: go straight to the next linked exercise; rest only after the last one in the round.
    var skipRest = false, group = supersetOf(S.active.exercises, entry);
    if (group.length > 1 && !set.warmup) {
      var gi = group.indexOf(entry);
      for (var k = 1; k <= group.length; k++) {
        var cand = group[(gi + k) % group.length];
        if (cand.sets.some(function (x) { return !x.done && !x.warmup; })) {
          if (cand !== entry) { V.focusEntry = cand.id; skipRest = gi + k < group.length; }
          break;
        }
      }
    }
    if (S.settings.restSeconds > 0 && !set.warmup && !skipRest) V.rest = { endsAt: Date.now() + S.settings.restSeconds * 1000, total: S.settings.restSeconds * 1000 };
    var pr = !V.prShown[set.id] && M.checkPr(S.workouts, S.active, entry.id, set.id);
    if (pr) {
      V.prShown[set.id] = prKey(set);
      V.prMoment = buildPrMoment(entry, set, pr);
      vibrate([30, 60, 30]);
    }
    commit();
    if (pr) {
      var keep = document.querySelector('.pr-foot [data-act="pr-close"]');
      if (keep) keep.focus();
    }
  }

  /** A confirmed set still has reps (or seconds); they can be cleared after confirming. */
  function setComplete(entry, s) {
    var kind = s.tracking || entryKind(entry);
    if (kind === 'timed') return Number(s.seconds) > 0;
    return Number(s.reps) > 0;
  }
  var STALE_HOURS = 4;
  /** Hours since the last confirmed set (or the start) when that's over STALE_HOURS, else 0. */
  function staleSince(a) {
    if (!a) return 0;
    var h = (Date.now() - new Date(a.lastSetAt || a.startedAt).getTime()) / 3600000;
    return h > STALE_HOURS ? h : 0;
  }
  function staleBanner() {
    var a = S.active, h = staleSince(a);
    var ok; try { ok = localStorage.getItem('pr-forge:web:v1:stale-ok'); } catch (e) { ok = null; }
    if (!h || ok === a.id + '|' + (a.lastSetAt || '')) return '';
    var ago = h >= 48 ? Math.floor(h / 24) + ' days' : Math.floor(h) + ' h';
    return '<section class="card stale" role="status"><p><b>Still going?</b> ' + (a.lastSetAt ? 'Your last set was ' + ago + ' ago.' : 'You started this ' + ago + ' ago and haven’t logged a set.') +
      (a.lastSetAt ? ' Finishing now saves it with the end time of your last set.' : '') + '</p>' +
      '<div class="row-btns"><button class="btn primary sm" data-act="finish-workout">Finish</button><button class="btn ghost sm" data-act="stale-keep">Keep going</button></div></section>';
  }
  function finishWorkout() {
    var a = S.active;
    var blanked = 0;
    var kept = a.exercises.map(function (e) {
      return { id: e.id, exerciseId: e.exerciseId, tracking: e.tracking, superNext: !!e.superNext, sets: e.sets.filter(function (s) {
        if (s.done && !setComplete(e, s)) { blanked++; return false; }
        if (s.done && (s.weight == null || s.weight === '' || !isFinite(Number(s.weight)))) s.weight = 0; // same as confirming with no weight
        return s.done;
      }) };
    }).filter(function (e) { return e.sets.length > 0; });
    var unconfirmed = 0;
    a.exercises.forEach(function (e) { e.sets.forEach(function (s) { if (!s.done) unconfirmed++; }); });
    if (!kept.length) {
      confirmBox('Nothing logged yet', 'No sets are confirmed, so there’s nothing to save. Discard this workout?', 'Discard', true).then(function (ok) {
        if (ok) { S.active = null; V.screen = null; V.rest = null; commit(); }
      });
      return;
    }
    var count = kept.reduce(function (n, e) { return n + e.sets.length; }, 0);
    confirmBox('Finish workout?', count + ' confirmed set' + (count === 1 ? '' : 's') + ' will be saved.' +
      (unconfirmed ? ' ' + unconfirmed + ' unconfirmed set' + (unconfirmed === 1 ? '' : 's') + ' will be dropped.' : '') +
      (blanked ? ' ' + blanked + ' confirmed set' + (blanked === 1 ? ' has' : 's have') + ' blank reps and will be dropped too; tap Cancel to fill ' + (blanked === 1 ? 'it' : 'them') + ' in.' : ''), 'Finish').then(function (ok) {
      if (!ok) return;
      var done = JSON.parse(JSON.stringify(a));
      done.exercises = kept;
      done.endedAt = staleSince(a) ? new Date(new Date(a.lastSetAt || a.startedAt).getTime() + 5 * 60000).toISOString() : new Date().toISOString();
      delete done.lastSetAt;
      S.workouts.push(done);
      S.active = null;
      V.rest = null;
      V.focusEntry = null;
      V.screen = 'historyDetail';
      V.historyId = done.id;
      V.summary = done.id;
      V.tab = 'history';
      commit();
    });
  }

  function exportBackup() {
    saveFile(ST.exportBackup(S), 'pr-forge-backup-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json', 'PR Forge backup', 'Backup downloaded', function () {
      lsSet(BACKUP_AT, String(Date.now())); // only a finished save counts; a cancelled share sheet doesn't
      render();
    });
  }
  /** Share sheet with the file where the phone has one (iPhone: Save to Files), else a download. */
  function saveFile(text, name, type, title, doneMsg, onSaved) {
    var blob = new Blob([text], { type: type });
    try {
      var file = new File([blob], name, { type: type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: title }).then(function () { if (onSaved) onSaved(); }).catch(function () { /* cancelled */ });
        return;
      }
    } catch (e) { /* fall through to download */ }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(doneMsg);
    if (onSaved) onSaved();
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var next;
      try { next = ST.parseBackup(String(reader.result)); }
      catch (e) { toast(esc(e.message), 'warn', 3500); return; }
      var raw = {};
      try { raw = JSON.parse(String(reader.result)); } catch (e) { /* already validated */ }
      var when = raw.exportedAt ? ' from ' + new Date(raw.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      confirmBox('Restore this backup?', 'Backup' + esc(when) + ': ' + next.workouts.length + ' workouts, ' + next.templates.length + ' routines.<br>' +
        'This replaces everything on this device (' + S.workouts.length + ' workouts now).', 'Replace my data', true).then(function (ok) {
        if (!ok) return;
        try { localStorage.setItem(ST.KEY + ':before-restore', JSON.stringify(S)); } catch (e) { /* ignore */ }
        S = next;
        S.settings.setupDone = true;
        V.screen = null; V.rest = null; V.picker = null; V.edit = null;
        commit();
        toast('Backup restored');
      });
    };
    reader.onerror = function () { toast('Couldn’t read that file', 'warn'); };
    reader.readAsText(file);
  }

  function importFitbod(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var batchId = 'fb-' + uid();
      var existing = {};
      S.workouts.forEach(function (x) { if (x.sourceKey) existing[x.sourceKey] = true; });
      var opts = { exercises: allExercises(), targetUnit: unit(), uid: uid, batchId: batchId };
      var fresh, all;
      try {
        fresh = IM.parseFitbod(String(reader.result), Object.assign({ existingKeys: existing }, opts)); // days not imported yet
        all = IM.parseFitbod(String(reader.result), opts);                                             // every day in the file
      } catch (e) { toast(esc(e.message), 'warn', 4000); return; }
      var dup = fresh.stats.duplicateDays;
      if (!all.stats.workouts) { toast('No workouts found in that file', 'warn', 3500); return; }
      if (!dup) {
        confirmBox('Import from Fitbod?', importSummary(fresh) + '<br>Weights are shown in ' + unit() + '. You can undo this in Settings.', 'Import')
          .then(function (ok) { if (ok) applyImport(fresh, batchId, false); });
        return;
      }
      // Some days are already here: let the person add only the new ones, or replace those days with this file's version.
      var n = fresh.stats.workouts;
      var text = 'This file has <b>' + all.stats.workouts + ' workout' + (all.stats.workouts === 1 ? '' : 's') + '</b>. ' +
        dup + ' of those day' + (dup === 1 ? ' is' : 's are') + ' already imported' + (n ? ', and ' + n + ' ' + (n === 1 ? 'is' : 'are') + ' new.' : ', and none are new.') +
        '<br><b>Replace</b> swaps the imported copies of those days for this file’s version (any edits you made to them are lost). ' +
        'Workouts you logged in PR Forge are never touched.<br>Weights are shown in ' + unit() + '. You can undo this in Settings.';
      var choices = [];
      if (n) choices.push({ label: 'Add the ' + n + ' new day' + (n === 1 ? '' : 's'), value: 'new', cls: 'primary' });
      choices.push({ label: n ? 'Replace ' + dup + ' and add ' + n : 'Replace the ' + dup + ' imported day' + (dup === 1 ? '' : 's'), value: 'replace', cls: n ? 'ghost' : 'primary' });
      choiceBox('Import from Fitbod?', text, choices).then(function (v) {
        if (v === 'new') applyImport(fresh, batchId, false);
        else if (v === 'replace') applyImport(all, batchId, true);
      });
    };
    reader.onerror = function () { toast('Couldn’t read that file', 'warn'); };
    reader.readAsText(file);
  }
  // ----- Paste a workout (e.g. one Claude wrote) -----
  function pastePlanForm(text) {
    openModal('<h2>Paste or import a routine</h2>' +
      '<p class="muted small">Paste a plan, for example one Claude wrote for you, or choose a file. One exercise per line works best, like “Bench press 4x8”. A short line above the exercises becomes the routine’s name; paste several days at once and each becomes its own routine.</p>' +
      '<label class="field"><span>Plan</span><textarea id="plan-text" rows="9" placeholder="Upper body&#10;Bench press 4x8&#10;Bent-over row 4x8&#10;Overhead press 3x10&#10;Pull-ups 3xAMRAP"></textarea></label>' +
      '<div class="row-2"><button class="btn ghost sm" data-act="plan-file-pick">Choose a file</button><button class="btn ghost sm" data-act="plan-copy-tip">Tip for Claude</button></div>' +
      '<p class="muted small">Files: PDF, text (.txt, .md) or CSV. A CSV needs an Exercise column; Sets, Reps and a Workout or Day column are optional. For a photo or a Word file, copy the text and paste it here.</p>' +
      '<input type="file" id="plan-file" accept=".pdf,.txt,.text,.md,.markdown,.csv,application/pdf,text/plain,text/markdown,text/csv" hidden>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="modal-cancel">Cancel</button><button class="btn primary" data-act="plan-preview">Preview</button></div>');
    var ta = document.getElementById('plan-text');
    if (ta) { ta.value = text; setTimeout(function () { ta.focus(); }, 30); }
  }
  /** Reads a PDF, text or CSV file into the paste box, then shows the preview. */
  function loadPlanFile(file) {
    var name = String(file.name || '').toLowerCase();
    V.planFileName = String(file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
    var type = String(file.type || '');
    var box = document.getElementById('plan-text');
    var fill = function (text) {
      text = String(text || '').trim();
      if (!text) { toast('No text found in that file. If it’s a scan or photo, type or paste the workout instead.', 'warn', 4500); return; }
      if (box) box.value = text;
      var go = document.querySelector('[data-act="plan-preview"]');
      if (go) go.click();
    };
    if (/\.pdf$/.test(name) || type === 'application/pdf') {
      toast('Reading the PDF…', '', 2000);
      readPdfText(file).then(fill, function (e) {
        try { console.warn('PDF read failed', e); } catch (e2) { /* ignore */ }
        toast(navigator.onLine ? 'Couldn’t read that PDF. Copy its text and paste it instead.' : 'Reading a PDF needs a connection the first time. Try again when you’re online.', 'warn', 4500);
      });
      return;
    }
    if (/\.(docx?|pages|rtf)$/.test(name)) { toast('Word and Pages files can’t be read here. Copy the text and paste it instead.', 'warn', 4500); return; }
    if (/^image\//.test(type) || /\.(jpe?g|png|heic|webp|gif)$/.test(name)) { toast('Photos can’t be read here. Type or paste the workout instead.', 'warn', 4500); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      if (/\.csv$/.test(name) || type === 'text/csv') {
        try { text = IM.csvToPlanText(text); } catch (e) { toast(esc(e.message), 'warn', 4500); return; }
      }
      fill(text);
    };
    reader.onerror = function () { toast('Couldn’t read that file', 'warn'); };
    reader.readAsText(file);
  }
  /** Text of a PDF's first 20 pages via PDF.js, which is only downloaded the first time a PDF is opened. */
  var pdfLib = null;
  function readPdfText(file) {
    var base = new URL('js/vendor/pdfjs/', document.baseURI).href;
    pdfLib = pdfLib || import(base + 'pdf.min.js').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
      return lib;
    });
    return Promise.all([pdfLib, file.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false }).promise;
    }).then(function (doc) {
      var pages = [];
      for (var i = 1; i <= Math.min(doc.numPages, 20); i++) pages.push(i);
      return pages.reduce(function (p, n) {
        return p.then(function (acc) {
          return doc.getPage(n).then(function (page) { return page.getTextContent(); }).then(function (tc) { return acc.concat([IM.pdfItemsToText(tc.items)]); });
        });
      }, Promise.resolve([])).then(function (texts) { try { (doc.destroy || doc.cleanup || function () {}).call(doc); } catch (e) { /* ignore */ } return texts.join('\n'); });
    }).catch(function (e) { pdfLib = null; throw e; }); // let the next try download PDF.js again
  }
  function planPreview(res) {
    var html = res.workouts.map(function (w, wi) {
      return '<section class="paste-wk"><h3>' + esc(w.name || 'Routine ' + (S.templates.length + wi + 1)) + '</h3><ul class="paste-list">' + w.exercises.map(function (e) {
        var known = e.exerciseId ? exById(e.exerciseId) : null;
        return '<li><span class="paste-name"><strong>' + esc(known ? known.name : e.name) + '</strong>' +
          (known ? '' : '<span class="muted small">New exercise, added to your list</span>') + '</span>' +
          '<span class="paste-sets">' + e.sets + (e.reps ? ' × ' + esc(e.reps) : e.sets === 1 ? ' set' : ' sets') + '</span></li>';
      }).join('') + '</ul></section>';
    }).join('');
    var n = res.workouts.length;
    openModal('<h2>' + (n === 1 ? 'Save this routine?' : 'Save ' + n + ' routines?') + '</h2>' + html +
      (res.skipped.length ? '<p class="muted small">Left out ' + (res.skipped.length === 1 ? '1 line that isn’t an exercise' : res.skipped.length + ' lines that aren’t exercises, such as') + ': “' + esc(res.skipped[0].slice(0, 60)) + '”.</p>' : '') +
      '<p class="muted small">Sets are saved; rep targets aren’t kept yet, and last time’s numbers fill in as hints when you start. You can edit everything afterwards.</p>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="plan-back">Back</button><button class="btn primary" data-act="plan-save">Save</button></div>');
  }

  /** Opens the saved-workout editor pre-filled from a finished workout. */
  function draftFromWorkout(wk) {
    V.tplDraft = { id: null, name: wk.imported && wk.name === 'Fitbod workout' ? '' : wk.name, exercises: wk.exercises.map(function (e) {
      return { exerciseId: e.exerciseId, superNext: !!e.superNext, sets: Math.min(20, Math.max(1, e.sets.filter(function (s) { return !s.warmup; }).length)) };
    }) };
    V.screen = 'template'; render();
  }
  function importSummary(result) {
    var st = result.stats;
    var range = shortDate(result.workouts[0].startedAt) + ' ' + new Date(result.workouts[0].startedAt).getFullYear() + ' to ' +
      shortDate(result.workouts[st.workouts - 1].startedAt) + ' ' + new Date(result.workouts[st.workouts - 1].startedAt).getFullYear();
    var created = st.created.slice(0, 5).map(esc).join(', ') + (st.created.length > 5 ? ' and ' + (st.created.length - 5) + ' more' : '');
    return '<b>' + st.workouts + ' workout' + (st.workouts === 1 ? '' : 's') + '</b>, ' + st.sets + ' sets, ' + range + '.<br>' +
      st.matched + ' exercise' + (st.matched === 1 ? '' : 's') + ' matched to your list.' +
      (st.created.length ? '<br>' + st.created.length + ' added as custom: ' + created + '.' : '') +
      (st.skipped ? '<br>' + st.skipped + ' row' + (st.skipped === 1 ? '' : 's') + ' skipped (no reps or time, such as distance-only cardio).' : '');
  }
  /** Adds an import. With replace, imported workouts for the same days are removed first (logged workouts never are). */
  function applyImport(result, batchId, replace) {
    var st = result.stats;
    var before = { workouts: S.workouts, customs: S.customExercises, imports: S.imports, setup: S.settings.setupDone };
    var replaced = 0;
    var keep = S.workouts;
    if (replace) {
      var keys = {};
      result.workouts.forEach(function (x) { keys[x.sourceKey] = true; });
      keep = S.workouts.filter(function (x) { return !(x.sourceKey && keys[x.sourceKey]); });
      replaced = S.workouts.length - keep.length;
    }
    S.workouts = keep.concat(result.workouts);
    S.customExercises = S.customExercises.concat(result.customs);
    S.imports = S.imports.concat([{ id: batchId, source: 'Fitbod', at: new Date().toISOString(), workouts: st.workouts }]);
    if (replace) tidyImports();
    S.settings.setupDone = true;
    if (!ST.save(S)) {
      S.workouts = before.workouts; S.customExercises = before.customs; S.imports = before.imports; S.settings.setupDone = before.setup;
      toast('Not enough storage on this device, so nothing was imported.', 'warn', 4000);
      return;
    }
    CLOUD.changed();
    render();
    toast(replaced ? 'Replaced ' + replaced + ' and added ' + (st.workouts - replaced) + ' workout' + (st.workouts - replaced === 1 ? '' : 's')
      : 'Imported ' + st.workouts + ' workout' + (st.workouts === 1 ? '' : 's'));
  }
  /** After a replace: recount each import, drop ones with nothing left, and their custom exercises nothing uses. */
  function tidyImports() {
    var count = {};
    S.workouts.forEach(function (x) { if (x.importBatch) count[x.importBatch] = (count[x.importBatch] || 0) + 1; });
    var gone = {};
    S.imports = S.imports.filter(function (b) {
      if (!count[b.id]) { gone[b.id] = true; return false; }
      b.workouts = count[b.id];
      return true;
    });
    var used = {};
    S.workouts.concat(S.active ? [S.active] : []).forEach(function (x) { x.exercises.forEach(function (e) { used[e.exerciseId] = true; }); });
    S.templates.forEach(function (t) { t.exercises.forEach(function (e) { used[e.exerciseId] = true; }); });
    S.customExercises = S.customExercises.filter(function (e) { return !(e.importBatch && gone[e.importBatch]) || used[e.id]; });
  }

  function undoImport(id) {
    var batch = S.imports.filter(function (b) { return b.id === id; })[0];
    if (!batch) return;
    var count = S.workouts.filter(function (x) { return x.importBatch === id; }).length;
    confirmBox('Undo this import?', 'Removes ' + count + ' imported workout' + (count === 1 ? '' : 's') + ', including any you edited since. Workouts you logged here are kept.', 'Undo import', true).then(function (ok) {
      if (!ok) return;
      S.workouts = S.workouts.filter(function (x) { return x.importBatch !== id; });
      var used = {};
      S.workouts.concat(S.active ? [S.active] : []).forEach(function (x) { x.exercises.forEach(function (e) { used[e.exerciseId] = true; }); });
      S.templates.forEach(function (t) { t.exercises.forEach(function (e) { used[e.exerciseId] = true; }); });
      S.customExercises = S.customExercises.filter(function (e) { return e.importBatch !== id || used[e.id]; });
      S.imports = S.imports.filter(function (b) { return b.id !== id; });
      commit();
      toast('Import undone');
    });
  }

  var actions = {
    'tab': function (el) { V.tab = el.dataset.tab; V.screen = null; V.tplDraft = null; V.liftId = null; render(); },
    'resume-workout': function () { V.screen = 'workout'; render(); },
    'stale-keep': function () {
      try { localStorage.setItem('pr-forge:web:v1:stale-ok', S.active.id + '|' + (S.active.lastSetAt || '')); } catch (e) { /* banner shows again next time */ }
      render();
    },
    'minimize-workout': function () { V.screen = null; render(); },
    'start-empty': function () { startWorkout('Workout', null, []); },
    'start-template': function (el) {
      var t = S.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (t) startWorkout(t.name, t.id, t.exercises);
    },
    'set-toggle': function (el) { toggleSet(el.dataset.e, el.dataset.s); },
    'set-warmup': function (el) {
      var entry = findEntry(el.dataset.e); var set = entry && findSet(entry, el.dataset.s);
      if (set) { set.warmup = !set.warmup; commit(); }
    },
    'warmup-add': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry) return;
      var set = newSet(entryKind(entry));
      set.warmup = true;
      var at = 0;
      while (at < entry.sets.length && entry.sets[at].warmup) at++; // after any warm-ups, before the first working set
      entry.sets.splice(at, 0, set);
      V.focusEntry = entry.id;
      commit();
    },
    'set-add': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry) return;
      entry.sets.push(newSet(entryKind(entry))); commit();
    },
    'ex-type': function (el) { var entry = findEntry(el.dataset.e); if (entry) chooseType(entry); },
    'ex-type-set': function (el) {
      var entry = findEntry(V.typeEntry), kind = el.dataset.v;
      closeModal();
      if (!entry || entryKind(entry) === kind) return;
      if (entry.sets.some(function (s) { return s.done; })) {
        confirmBox('Change how it’s logged?', 'This exercise’s sets will be cleared from this workout, including confirmed ones.', 'Change', true).then(function (ok) { if (ok) setEntryType(entry, kind); });
      } else setEntryType(entry, kind);
    },
    'set-remove': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry || entry.sets.length < 2) return;
      var last = entry.sets[entry.sets.length - 1];
      var go = function () { entry.sets.pop(); commit(); };
      if (last.done) confirmBox('Remove last set?', 'It’s already confirmed.', 'Remove', true).then(function (ok) { if (ok) go(); });
      else go();
    },
    'ex-remove': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry) return;
      var name = esc(exById(entry.exerciseId).name);
      var go = function () { S.active.exercises = S.active.exercises.filter(function (x) { return x !== entry; }); commit(); };
      if (entry.sets.some(function (s) { return s.done; })) confirmBox('Remove ' + name + '?', 'Its confirmed sets will be removed from this workout.', 'Remove', true).then(function (ok) { if (ok) go(); });
      else go();
    },
    'ex-super': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry) return;
      entry.superNext = !entry.superNext;
      V.focusEntry = entry.id;
      commit();
      toast(entry.superNext ? 'Linked: after a set here, the next exercise opens. Rest comes after the round.' : 'Unlinked', '', 3200);
    },
    'ex-move': function (el) {
      var list = S.active.exercises;
      var i = list.indexOf(findEntry(el.dataset.e)), j = i + (+el.dataset.d);
      if (i < 0 || j < 0 || j >= list.length) return;
      var t = list[i]; list[i] = list[j]; list[j] = t;
      V.focusEntry = el.dataset.e; // keep this card open at its new position
      commit();
    },
    'ex-swap': function (el) {
      var entry = findEntry(el.dataset.e); if (!entry) return;
      var open = function () { V.picker = { target: 'swap', entryId: entry.id, q: '', muscle: '', selected: {} }; render(); };
      if (entry.sets.some(function (s) { return s.done; })) {
        confirmBox('Swap ' + esc(exById(entry.exerciseId).name) + '?', 'Its confirmed sets will be cleared from this workout.', 'Choose exercise', true).then(function (ok) { if (ok) open(); });
      } else open();
    },
    'add-exercise': function () { V.picker = { target: 'workout', q: '', muscle: '', selected: {} }; render(); },
    'finish-workout': finishWorkout,
    'discard-workout': function () {
      confirmBox('Discard workout?', 'Nothing from this session will be saved.', 'Discard', true).then(function (ok) {
        if (ok) { S.active = null; V.screen = null; V.rest = null; commit(); }
      });
    },
    'rest-skip': function () { V.rest = null; render(); },
    'rest-add': function () { if (V.rest) { V.rest.endsAt += 30000; V.rest.total += 30000; keepRest(); tick(); } },
    'ex-focus': function (el) { V.focusEntry = el.dataset.e; render(); },
    'pr-close': function () { V.prMoment = null; render(); },
    'summary-done': function () { V.summary = null; V.screen = null; V.tab = 'home'; render(); },

    'template-new': function () { V.tplDraft = { id: null, name: '', exercises: [] }; V.screen = 'template'; render(); },
    'template-share': function (el) {
      var t = S.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!t) return;
      var text = IM.routineToText(t, function (id) { return exById(id).name; });
      var copied = function () { toast('Copied. Paste it into a message to your friend.', '', 3500); };
      var copy = function () {
        try { navigator.clipboard.writeText(text).then(copied, function () { toast('Couldn’t copy. Try again.', 'warn'); }); }
        catch (e) { toast('Couldn’t copy. Try again.', 'warn'); }
      };
      if (navigator.share) {
        navigator.share({ title: t.name, text: text }).catch(function (e) { if (!e || e.name !== 'AbortError') copy(); });
      } else copy();
    },
    'tpl-menu': function (el) {
      var id = el.dataset.id, t = S.templates.filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      choiceBox(t.name, '', [{ label: 'Edit', value: 'edit' }, { label: 'Share with a friend', value: 'share' }, { label: 'Duplicate', value: 'dup' }]).then(function (v) {
        var target = { dataset: { id: id } };
        if (v === 'edit') actions['template-edit'](target);
        else if (v === 'share') actions['template-share'](target);
        else if (v === 'dup') { actions['template-edit'](target); actions['template-dup'](); }
      });
    },
    'template-edit': function (el) {
      var t = S.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!t) return;
      V.tplDraft = JSON.parse(JSON.stringify(t)); V.screen = 'template'; render();
    },
    'template-cancel': function () { V.tplDraft = null; V.screen = null; V.tab = 'workouts'; render(); },
    'template-save': function () {
      var d = V.tplDraft;
      d.name = (d.name || '').trim();
      if (!d.name) { toast('Give the routine a name', 'warn'); return; }
      if (!d.exercises.length) { toast('Add at least one exercise', 'warn'); return; }
      var bad = d.exercises.filter(function (e) { return e.repsText != null && e.repsText.trim() && !IM.parseRepTarget(e.repsText); })[0];
      if (bad) { toast('Target reps for ' + esc(exById(bad.exerciseId).name) + ': use a number like 8 or a range like 8-12', 'warn', 4000); return; }
      d.exercises.forEach(function (e) {
        if (e.repsText != null) { var tg = IM.parseRepTarget(e.repsText); if (tg) e.reps = tg; else delete e.reps; delete e.repsText; }
      });
      if (d.id) S.templates = S.templates.map(function (t) { return t.id === d.id ? d : t; });
      else { d.id = uid(); S.templates.push(d); }
      V.tplDraft = null; V.screen = null; V.tab = 'workouts';
      commit(); toast('Saved');
    },
    'template-dup': function () {
      var d = V.tplDraft; if (!d) return;
      var copy = JSON.parse(JSON.stringify(d));
      copy.id = null;
      copy.name = ((d.name || '').trim() + ' copy').trim().slice(0, 60);
      V.tplDraft = copy;
      render();
      toast('Copy ready. Rename it and tap Save; the original isn’t changed', '', 3500);
    },
    'template-delete': function () {
      var d = V.tplDraft;
      confirmBox('Delete “' + esc(d.name) + '”?', 'Past workouts in History are kept.', 'Delete', true).then(function (ok) {
        if (!ok) return;
        S.templates = S.templates.filter(function (t) { return t.id !== d.id; });
        V.tplDraft = null; V.screen = null; V.tab = 'workouts'; commit();
      });
    },
    'tpl-sets': function (el) {
      var e = V.tplDraft.exercises[+el.dataset.i];
      e.sets = Math.min(20, Math.max(1, e.sets + (+el.dataset.d))); render();
    },
    'tpl-move': function (el) {
      var list = V.tplDraft.exercises, i = +el.dataset.i, j = i + (+el.dataset.d);
      if (j < 0 || j >= list.length) return;
      var t = list[i]; list[i] = list[j]; list[j] = t; render();
    },
    'tpl-super': function (el) { var e = V.tplDraft.exercises[+el.dataset.i]; if (e) { e.superNext = !e.superNext; render(); } },
    'tpl-remove': function (el) { V.tplDraft.exercises.splice(+el.dataset.i, 1); render(); },
    'tpl-add-ex': function () { V.picker = { target: 'template', q: '', muscle: '', selected: {} }; render(); },

    'picker-close': function () { V.picker = null; render(); },
    'picker-muscle': function (el) {
      V.picker.muscle = el.dataset.v === 'All' ? '' : el.dataset.v;
      document.querySelectorAll('[data-act="picker-muscle"]').forEach(function (c) {
        c.classList.toggle('on', c.dataset.v === (V.picker.muscle || 'All'));
      });
      refreshPicker();
    },
    'picker-toggle': function (el) {
      var id = el.dataset.id;
      if (V.picker.target === 'swap') { swapEntry(V.picker.entryId, id); return; }
      if (V.picker.selected[id]) delete V.picker.selected[id]; else V.picker.selected[id] = Date.now() + Object.keys(V.picker.selected).length;
      refreshPicker();
    },
    'picker-confirm': function () {
      var p = V.picker;
      var ids = Object.keys(p.selected).sort(function (a, b) { return p.selected[a] - p.selected[b]; });
      if (!ids.length) return;
      if (p.target === 'template' && V.tplDraft) {
        ids.forEach(function (id) { V.tplDraft.exercises.push({ exerciseId: id, sets: 3 }); });
        V.picker = null; render();
      } else if (p.target === 'edit' && V.edit) {
        ids.forEach(function (id) { V.edit.draft.exercises.push(newEntry(id, 1)); });
        V.picker = null; render();
      } else if (S.active) {
        ids.forEach(function (id) { S.active.exercises.push(newEntry(id, 3)); });
        V.picker = null; commit();
      }
    },
    'picker-custom': customExerciseForm,
    'custom-save': function () {
      var name = (document.getElementById('cx-name').value || '').trim();
      if (!name) { toast('Enter a name', 'warn'); return; }
      var ex = { id: 'c-' + uid(), name: name.slice(0, 80), muscle: document.getElementById('cx-muscle').value,
        equipment: document.getElementById('cx-equip').value, side: document.getElementById('cx-side').value, tracking: document.getElementById('cx-type').value, custom: true };
      S.customExercises.push(ex);
      save();
      closeModal();
      if (V.picker && V.picker.target === 'swap') swapEntry(V.picker.entryId, ex.id);
      else if (V.picker) { V.picker.selected[ex.id] = Date.now(); V.picker.q = ''; render(); }
      toast('Added “' + esc(ex.name) + '”');
    },
    'modal-ok': function () { closeModal(true); },
    'modal-choice': function (el) { var c = V.modal && V.modal.choices && V.modal.choices[+el.dataset.i]; closeModal(c ? c.value : false); },
    'modal-cancel': function () { closeModal(false); },

    'history-open': function (el) { V.historyId = el.dataset.id; V.screen = 'historyDetail'; V.tab = 'history'; render(); },
    'history-edit': function () {
      var wk = findWorkout(V.historyId); if (!wk) return;
      var text = JSON.stringify(wk);
      V.edit = { draft: JSON.parse(text), original: text };
      V.screen = 'editWorkout';
      render();
    },
    'edit-cancel': function () {
      var leave = function () { V.edit = null; V.picker = null; V.screen = 'historyDetail'; render(); };
      if (JSON.stringify(V.edit.draft) === V.edit.original) { leave(); return; }
      confirmBox('Discard changes?', 'Your edits to this workout won’t be saved.', 'Discard', true).then(function (ok) { if (ok) leave(); });
    },
    'edit-save': saveEdit,
    'edit-set-add': function (el) {
      var entry = editEntry(el.dataset.e); if (!entry) return;
      var set = newSet(entryKind(entry));
      set.done = true;
      entry.sets.push(set); render();
    },
    'edit-set-remove': function (el) {
      var entry = editEntry(el.dataset.e); if (!entry) return;
      entry.sets = entry.sets.filter(function (s) { return s.id !== el.dataset.s; });
      if (!entry.sets.length) V.edit.draft.exercises = V.edit.draft.exercises.filter(function (e) { return e !== entry; });
      render();
    },
    'edit-set-warm': function (el) {
      var entry = editEntry(el.dataset.e); var set = entry && findSet(entry, el.dataset.s);
      if (set) { set.warmup = !set.warmup; render(); }
    },
    'edit-ex-remove': function (el) {
      V.edit.draft.exercises = V.edit.draft.exercises.filter(function (e) { return e.id !== el.dataset.e; });
      render();
    },
    'edit-ex-add': function () { V.picker = { target: 'edit', q: '', muscle: '', selected: {} }; render(); },

    'lift-open': function (el) { V.liftId = el.dataset.id; V.liftFrom = el.dataset.from || 'progress'; V.screen = 'lift'; render(); },
    'lift-pin': function (el) {
      var id = el.dataset.id, list = (S.settings.pinned || []).slice(), at = list.indexOf(id);
      if (at !== -1) { list.splice(at, 1); S.settings.pinned = list; commit(); toast('Unpinned'); return; }
      if (!list.length) {
        // First pin: start from what Progress already shows, so pinning one lift doesn't make the others vanish.
        list = mainLiftIds(M.liftTrends(S.workouts, new Date())).filter(function (x) { return x !== id; }).slice(0, 4);
      }
      if (list.length >= 8) { toast('You can pin up to 8 lifts. Unpin one first.', 'warn'); return; }
      list.push(id); S.settings.pinned = list; commit(); toast('Pinned to Progress');
    },
    'records-all': function () { V.recordsAll = !V.recordsAll; render(); },
    'progress-view': function (el) { V.progressView = el.dataset.v === 'records' ? 'records' : 'trends'; render(); },
    'exercises-open': function () { V.exFrom = V.screen; V.screen = 'exercises'; render(); },
    'exercises-back': function () { V.screen = V.exFrom === 'settings' ? 'settings' : null; V.exFrom = null; if (!V.screen) V.tab = 'progress'; render(); },
    'ex-default-type': function (el) {
      var id = el.dataset.id, current = exKind(id);
      V.modal = { resolve: null, exId: id };
      openModal('<h2>How do you log it?</h2><p class="muted small">Used the next time you add ' + esc(exById(id).name) + ' to a workout. Past workouts keep how they were logged.</p><div class="type-list">' + EX.TRACKING.map(function (t) {
        return '<button class="type-opt' + (t.id === current ? ' on' : '') + '" data-act="ex-default-type-set" data-id="' + esc(id) + '" data-v="' + t.id + '" aria-pressed="' + (t.id === current) + '"><strong>' + t.label + '</strong><span class="muted small">' + t.hint + '</span></button>';
      }).join('') + '</div><button class="btn ghost block" data-act="modal-cancel">Cancel</button>');
    },
    'ex-sides': function (el) { closeModal(); sidesModal(el.dataset.id); },
    'ex-side-set': function (el) {
      var id = el.dataset.id, v = el.dataset.v, base = baseExercise(id).side || '';
      S.settings.exerciseSides = S.settings.exerciseSides || {};
      if ((v === 'both' ? '' : v) === base) delete S.settings.exerciseSides[id]; else S.settings.exerciseSides[id] = v;
      closeModal(); commit(); toast(v === 'both' ? 'Both sides together' : v === 'arm' ? 'Per arm' : 'Per leg');
    },
    'ex-default-type-set': function (el) {
      S.settings.exerciseTypes[el.dataset.id] = el.dataset.v;
      closeModal(); commit(); toast('Saved');
    },
    'custom-rename': function (el) {
      var c = S.customExercises.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!c) return;
      V.modal = { resolve: null };
      openModal('<h2>Rename exercise</h2><label class="field"><span>Name</span><input id="cx-rename" maxlength="80" value="' + esc(c.name) + '"></label>' +
        '<p class="muted small">The new name shows everywhere, including past workouts.</p>' +
        '<div class="modal-actions"><button class="btn ghost" data-act="modal-cancel">Cancel</button><button class="btn primary" data-act="custom-rename-save" data-id="' + esc(c.id) + '">Save</button></div>');
    },
    'custom-rename-save': function (el) {
      var c = S.customExercises.filter(function (x) { return x.id === el.dataset.id; })[0];
      var name = (document.getElementById('cx-rename').value || '').trim();
      if (!c) return;
      if (!name) { toast('Enter a name', 'warn'); return; }
      c.name = name.slice(0, 80); closeModal(); commit(); toast('Renamed');
    },
    'custom-delete': function (el) {
      var id = el.dataset.id, c = S.customExercises.filter(function (x) { return x.id === id; })[0]; if (!c) return;
      var uses = exerciseInUse(id);
      if (uses) { toast('Used in ' + uses + ' workout' + (uses === 1 ? '' : 's') + ' or routine' + (uses === 1 ? '' : 's') + ', so it can’t be deleted. Rename it instead, or remove it from those first.', 'warn', 5000); return; }
      confirmBox('Delete “' + esc(c.name) + '”?', 'It isn’t used in any workout or routine.', 'Delete', true).then(function (ok) {
        if (!ok) return;
        S.customExercises = S.customExercises.filter(function (x) { return x.id !== id; });
        delete S.settings.exerciseTypes[id];
        V.screen = 'exercises'; V.liftId = null; commit(); toast('Deleted');
      });
    },
    'lift-back': function () {
      V.liftId = null;
      if (V.liftFrom === 'exercises') V.screen = 'exercises'; else { V.screen = null; V.tab = 'progress'; }
      render();
    },
    'lift-range': function (el) { V.liftRange = LIFT_RANGES[el.dataset.v] ? el.dataset.v : '3m'; render(); },
    'vol-tap': function (el) {
      var read = document.querySelector('[data-vol-read]');
      if (read) read.textContent = el.dataset.read;
      document.querySelectorAll('.vol-col').forEach(function (c) { c.classList.toggle('picked', c === el); });
    },
    'app-reload': function () { save(); location.reload(); },
    'greet-yes': function () {
      V.greeted = true;
      try { localStorage.setItem(GREET_KEY, todayKey()); } catch (e) { /* ignore */ }
      render();
    },
    'sign-in': function () {
      if (!navigator.onLine) { toast('You’re offline. Connect to sign in.', 'warn'); return; }
      CLOUD.signIn().then(function () { render(); }, function (e) { toast(esc(e.message || 'Sign-in didn’t start. Try again.'), 'warn', 3500); });
    },
    'sync-now': function () {
      if (!navigator.onLine) { toast('You’re offline. Changes back up when you reconnect.'); return; }
      CLOUD.syncNow().then(function () {
        var st = CLOUD.status().state;
        toast(st === 'synced' ? 'Backed up' : esc(syncText()), st === 'synced' ? '' : 'warn', 3000);
      });
    },
    'sign-out': function () {
      var n = CLOUD.pending();
      var text = n
        ? n + (n === 1 ? ' change hasn’t' : ' changes haven’t') + ' been backed up yet and will be lost. Connect to the internet and tap Back up now first.'
        : 'Your workouts are backed up and come back when you sign in again. This phone’s copy will be removed.';
      confirmBox('Sign out?', text, 'Sign out', n > 0).then(function (ok) {
        if (!ok) return;
        V.screen = null; V.tab = 'home'; V.rest = null; V.edit = null; V.picker = null; V.greeted = true;
        CLOUD.signOut().then(render);
      });
    },
    'setup-done': function () { S.settings.setupDone = true; V.tab = 'home'; commit(); },
    'fitbod-pick': function () { var f = document.getElementById('fitbod-file'); if (f) { f.value = ''; f.click(); } },
    'import-undo': function (el) { undoImport(el.dataset.id); },
    'history-back': function () { V.screen = null; V.tab = 'history'; render(); },
    'history-delete': function () {
      confirmBox('Delete this workout?', 'It will be removed from History, records and trends. This can’t be undone.', 'Delete', true).then(function (ok) {
        if (!ok) return;
        S.workouts = S.workouts.filter(function (x) { return x.id !== V.historyId; });
        V.screen = null; V.tab = 'history'; commit();
      });
    },
    'history-to-template': function () {
      var wk = findWorkout(V.historyId); if (!wk) return;
      V.summary = null;
      draftFromWorkout(wk);
    },
    'routine-new': function () {
      choiceBox('New routine', '', [
        { label: 'Build from scratch', value: 'scratch', cls: 'primary' },
        { label: 'Paste or import a plan (text, PDF, CSV)', value: 'paste' },
        { label: 'Start an empty workout instead', value: 'empty' }
      ]).then(function (v) {
        if (v === 'scratch') { V.tplDraft = { id: null, name: '', exercises: [] }; V.screen = 'template'; render(); }
        else if (v === 'paste') { V.planFileName = ''; pastePlanForm(V.planText || ''); }
        else if (v === 'empty') startWorkout('Workout', null, []);
      });
    },
    'plan-paste': function () { V.planFileName = ''; pastePlanForm(V.planText || ''); },
    'plan-copy-tip': function () {
      var tip = 'Write it as a plain list, one exercise per line, like "Bench press 4x8". Put the workout name on its own line above.';
      var done = function () { toast('Copied. Paste it after your request to Claude'); };
      try { navigator.clipboard.writeText(tip).then(done, function () { toast(tip, '', 6000); }); } catch (e) { toast(tip, '', 6000); }
    },
    'plan-file-pick': function () { var f = document.getElementById('plan-file'); if (f) { f.value = ''; f.click(); } },
    'plan-preview': function () {
      var el = document.getElementById('plan-text');
      V.planText = el ? el.value : '';
      var res;
      try { res = IM.parseWorkoutText(V.planText, { exercises: allExercises() }); }
      catch (e) { toast(esc(e.message), 'warn', 4500); return; }
      if (!res.workouts.length) { toast('No exercises found. Put one per line, like “Bench press 4x8”.', 'warn', 4000); return; }
      if (V.planFileName && !res.workouts[0].name) res.workouts[0].name = V.planFileName; // a file with no title line: use its name
      V.planParsed = res;
      closeModal();
      planPreview(res);
    },
    'plan-back': function () { closeModal(); pastePlanForm(V.planText || ''); },
    'plan-save': function () {
      var res = V.planParsed; if (!res) return;
      var made = {}, saved = [];
      res.workouts.forEach(function (w, wi) {
        var t = { id: 't-' + uid(), name: (w.name || 'Routine ' + (S.templates.length + 1)).slice(0, 60), exercises: [] };
        w.exercises.forEach(function (e) {
          var id = e.exerciseId;
          if (!id) {
            var key = e.name.toLowerCase();
            if (!made[key]) {
              made[key] = { id: 'c-' + uid(), name: e.name, muscle: 'Other', equipment: 'Other',
                side: /\b(one|single)[- ]arm/i.test(e.name) ? 'arm' : /\b(one|single)[- ]leg|lunge|split squat|step[- ]?up/i.test(e.name) ? 'leg' : '', custom: true };
              S.customExercises.push(made[key]);
            }
            id = made[key].id;
          }
          var tx = { exerciseId: id, sets: e.sets }, tg = IM.parseRepTarget(e.reps);
          if (tg) tx.reps = tg;
          t.exercises.push(tx);
        });
        S.templates.push(t); saved.push(t);
      });
      V.planText = ''; V.planParsed = null;
      closeModal();
      V.tab = 'workouts'; V.screen = null;
      commit();
      toast(saved.length === 1 ? 'Saved “' + esc(saved[0].name) + '”' : 'Saved ' + saved.length + ' routines');
    },
    'settings-open': function () { V.screen = 'settings'; V.setPage = null; V.picker = null; render(); },
    'set-page': function (el) { V.setPage = el.dataset.v || null; window.scrollTo(0, 0); render(); },
    'settings-back': function () { V.screen = null; render(); },

    'set-unit': function (el) {
      S.settings.unit = el.dataset.v === 'kg' ? 'kg' : 'lb'; commit();
      if (S.active && S.active.unit !== S.settings.unit) toast('The workout in progress stays in ' + S.active.unit + '; new workouts use ' + S.settings.unit + '.', '', 3500);
    },
    'set-rest': function (el) { S.settings.restSeconds = +el.dataset.v; commit(); },
    'backup-snooze': function () { lsSet(BACKUP_SNOOZE, String(Date.now() + 14 * 864e5)); render(); toast('Reminder in 2 weeks. Settings → Export backup any time.', '', 3200); },
    'bw-open': function () { bodyWeightModal(); },
    'bw-save': function () {
      var v = parseNum(document.getElementById('bw-val').value), dv = document.getElementById('bw-date').value, u = unit();
      var lo = u === 'kg' ? 20 : 45, hi = u === 'kg' ? 400 : 900;
      if (!(v >= lo && v <= hi)) { toast('Enter a weight between ' + lo + ' and ' + hi + ' ' + u, 'warn'); return; }
      var when = /^\d{4}-\d{2}-\d{2}$/.test(dv) ? new Date(+dv.slice(0, 4), +dv.slice(5, 7) - 1, +dv.slice(8, 10), 12) : new Date();
      S.bodyWeights = (S.bodyWeights || []).filter(function (b) { return localDate(b.date) !== localDate(when.toISOString()); }) // one entry per day
        .concat([{ id: uid(), date: when.toISOString(), weight: Math.round(v * 10) / 10, unit: u }])
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      closeModal(); commit(); toast('Saved');
    },
    'bw-del': function (el) {
      S.bodyWeights = (S.bodyWeights || []).filter(function (b) { return b.id !== el.dataset.id; });
      commit(); bodyWeightModal();
    },
    'set-rpe': function (el) { S.settings.rpe = el.dataset.v === '1'; commit(); },
    'set-theme': function (el) { S.settings.theme = el.dataset.v; commit(); },
    'export-csv': function () {
      var text = IM.workoutsToCsv(S.workouts, function (id) { return exById(id).name; });
      saveFile(text, 'pr-forge-workouts-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv', 'PR Forge workouts', 'CSV downloaded');
    },
    'export': exportBackup,
    'import': function () { var f = document.getElementById('import-file'); if (f) { f.value = ''; f.click(); } },
    'erase-all': function () {
      confirmBox('Erase everything?', 'All workouts, routines and settings will be deleted from this phone and from your account backup. Export a backup file first if you might want them.', 'Erase all', true).then(function (ok) {
        if (!ok) return;
        S = ST.defaults(); V.screen = null; V.tab = 'home'; V.rest = null; V.edit = null; commit();
      });
    }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el); }
  });

  var saveTimer = null;
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    var f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'weight' || f === 'reps' || f === 'seconds' || f === 'rpe') {
      var inEdit = el.dataset.scope === 'edit';
      var entry = inEdit ? editEntry(el.dataset.e) : findEntry(el.dataset.e); var set = entry && findSet(entry, el.dataset.s);
      if (!set) return;
      var n = parseNum(el.value);
      if (f === 'rpe') n = n != null && n >= 1 && n <= 10 ? Math.round(n * 2) / 2 : null;
      else if (f !== 'weight' && n != null) n = Math.round(n);
      set[f] = n;
      if (inEdit) return;
      clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
      if (f === 'weight' && el.closest('.set-row.active')) {
        var plates = document.querySelector('[data-plates]');
        if (plates) plates.innerHTML = platesInner(n != null ? n : parseNum(el.placeholder), S.active.unit);
      }
    } else if (f === 'ex-q') {
      V.exQ = el.value;
      var box = document.getElementById('ex-index');
      if (box) box.innerHTML = exerciseRowsHtml(V.exQ);
    } else if (f === 'edit-name' && V.edit) {
      V.edit.draft.name = el.value;
    } else if (f === 'edit-date' && V.edit) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
      var d = V.edit.draft, start = new Date(d.startedAt), length = new Date(d.endedAt) - start, parts = el.value.split('-');
      start.setFullYear(+parts[0], +parts[1] - 1, +parts[2]);
      d.startedAt = start.toISOString();
      d.endedAt = new Date(start.getTime() + length).toISOString();
    } else if (f === 'edit-time' && V.edit) {
      var tm = /^(\d{1,2}):(\d{2})/.exec(el.value); if (!tm) return;
      var d2 = V.edit.draft, st = new Date(d2.startedAt), len = new Date(d2.endedAt) - st;
      st.setHours(+tm[1], +tm[2], 0, 0);
      d2.startedAt = st.toISOString();
      d2.endedAt = new Date(st.getTime() + len).toISOString();
    } else if (f === 'edit-mins' && V.edit) {
      var mins = /^\s*\d+\s*$/.test(el.value) ? parseInt(el.value, 10) : NaN;
      V.edit.minsBad = !!el.value.trim() && !(mins >= 1 && mins <= MAX_EDIT_MINUTES);
      if (!(mins >= 1 && mins <= MAX_EDIT_MINUTES)) return;
      V.edit.draft.endedAt = new Date(new Date(V.edit.draft.startedAt).getTime() + mins * 60000).toISOString();
    } else if (f === 'bar') {
      var bar = parseNum(el.value);
      if (bar > 0) {
        if (unit() === 'kg') S.settings.barKg = bar; else S.settings.barLb = bar;
        clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
      }
    } else if (f === 'tpl-name' && V.tplDraft) {
      V.tplDraft.name = el.value;
    } else if (f === 'tpl-reps' && V.tplDraft) {
      var te = V.tplDraft.exercises[+el.dataset.i];
      if (te) te.repsText = el.value;
    } else if (f === 'picker-q' && V.picker) {
      V.picker.q = el.value; refreshPicker();
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.id === 'import-file' && el.files && el.files[0]) importBackup(el.files[0]);
    if (el.id === 'fitbod-file' && el.files && el.files[0]) importFitbod(el.files[0]);
    if (el.id === 'plan-file' && el.files && el.files[0]) loadPlanFile(el.files[0]);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!document.getElementById('modal-root').hidden) closeModal(false);
      else if (V.prMoment) { V.prMoment = null; render(); }
      else if (V.picker) { V.picker = null; render(); }
    }
    if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('num')) ev.target.blur();
  });
  // Save when the app goes to the background (phone lock, switching apps).
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  // ---------- timers ----------
  function tick() {
    if (S.active) {
      var t = clock(Date.now() - new Date(S.active.startedAt).getTime());
      document.querySelectorAll('[data-elapsed]').forEach(function (el) { el.textContent = t; });
    }
    if (V.rest) {
      var left = V.rest.endsAt - Date.now();
      if (left <= 0) {
        V.rest = null;
        keepRest();
        vibrate([80, 80, 80]);
        toast('Rest over — next set');
        document.querySelectorAll('.rest-dock, [data-rest-note]').forEach(function (el) { el.remove(); });
      } else {
        document.querySelectorAll('[data-rest]').forEach(function (el) { el.textContent = clock(left + 999); });
        document.querySelectorAll('[data-rest-fill]').forEach(function (el) { el.style.width = (100 * left / V.rest.total).toFixed(1) + '%'; });
      }
    }
  }
  setInterval(tick, 1000);

  // ---------- start-up ----------
  function boot() {
    restoreRest();
    CLOUD.init({
      getState: function () { return S; },
      setState: function (next) { S = next; ST.save(S); },
      onData: function () {
        ST.save(S);
        // Don't redraw under someone mid-entry; the new data shows on the next redraw.
        if (V.screen !== 'workout' && V.screen !== 'editWorkout' && V.screen !== 'template' && !V.picker && !V.modal) render();
      },
      onStatus: showSyncStatus
    });
    render();
    var splash = document.getElementById('splash');
    var t0 = window.__prfStart || Date.now();
    // Branding shows for at least 3 s, except when Google has just sent someone back: they saw it moments ago.
    var wait = /[?&](code|error)=/.test(location.search) || /(access_token|error)=/.test(location.hash) ? 0 : Math.max(0, 3000 - (Date.now() - t0));
    setTimeout(function () {
      app.hidden = false;
      splash.classList.add('out');
      setTimeout(function () { splash.remove(); }, 450);
    }, wait);
    if (S.active) { V.screen = 'workout'; render(); }

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost') {
      var hadController = !!navigator.serviceWorker.controller; // false on the very first install: that isn't an update
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        var check = function () { try { reg.update(); } catch (e) { /* offline */ } };
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
        setInterval(function () { if (document.visibilityState === 'visible') check(); }, 30 * 60000);
      }).catch(function () { /* offline cache unavailable */ });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController) { hadController = true; return; }
        V.updateReady = true;
        // Show it now unless someone is typing; otherwise it appears with the next screen change.
        var typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (!typing && !V.modal) render();
      });
    }
  }

  // Exposed for automated layout checks only.
  window.__prf = { state: function () { return S; }, view: V, render: render };

  boot();
})();
