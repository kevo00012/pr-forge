/* PR Forge — web app UI.
 * Plain JavaScript, no build step. State lives in `S` (saved to localStorage);
 * view state lives in `V` (not saved). Clicks are handled by one delegated
 * listener using data-act attributes. */
(function () {
  'use strict';

  var U = PRF.units, M = PRF.metrics, ST = PRF.store, EX = PRF.exercises, P = PRF.plates, IM = PRF.importers, CLOUD = PRF.cloud;
  var VERSION = '1.6.8';

  var S = ST.load();
  var V = {
    tab: 'home',          // home | workouts | progress | history
    screen: null,         // null | 'workout' | 'template' | 'historyDetail' | 'editWorkout' | 'lift'
    historyId: null,
    tplDraft: null,       // { id|null, name, exercises: [{exerciseId, sets}] }
    picker: null,         // { target: 'workout'|'template'|'swap'|'edit', q, muscle, selected: {} }
    edit: null,           // { draft, original } while changing a past workout
    liftId: null,         // exercise shown on the lift detail screen
    liftRange: 'recent',  // 'recent' (6 weeks) | 'all'
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
    if (builtInMap[id]) return builtInMap[id];
    for (var i = 0; i < S.customExercises.length; i++) if (S.customExercises[i].id === id) return S.customExercises[i];
    return { id: id, name: 'Unknown exercise', muscle: 'Other', equipment: 'Other', side: '' };
  }
  function sideLabel(ex) { return ex.side === 'arm' ? 'Per arm' : ex.side === 'leg' ? 'Per leg' : ''; }

  function parseNum(v) {
    if (v === null || v === undefined) return null;
    var t = String(v).replace(',', '.').trim();
    if (t === '') return null;
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
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
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
    if (Number(s.weight) > 0) return (WEIGHT_SIGN[s.tracking] || '') + U.fmtNum(s.weight) + ' × ' + U.fmtNum(s.reps);
    return U.fmtNum(s.reps) + ' reps';
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
    var warmAct = opts.scope === 'edit' ? 'edit-set-warm' : 'set-warmup';
    var endButton = opts.scope === 'edit'
      ? '<button class="check" data-act="edit-set-remove" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="Delete set ' + opts.n + '">' + icon('close') + '</button>'
      : '<button class="check' + (s.done ? ' on' : '') + '" data-act="set-toggle" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="' + (s.done ? 'Unconfirm set ' : 'Confirm set ') + opts.n + '" aria-pressed="' + (s.done ? 'true' : 'false') + '">' + icon('check') + '</button>';
    return '<div class="set-row' + (single ? ' one' : '') + (s.done && opts.scope !== 'edit' ? ' done' : '') + (s.warmup ? ' warm' : '') + (opts.active ? ' active' : '') + '">' +
      '<button class="set-n" data-act="' + warmAct + '" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="Set ' + opts.n + (s.warmup ? ', warm-up' : '') + '. Tap to toggle warm-up">' + (s.warmup ? 'W' : opts.workIdx) + '</button>' +
      inputs + endButton + '</div>';
  }
  function setHeadHtml(kind, u, side) {
    var sideTag = side ? ' <span class="head-side">' + side.toLowerCase() + '</span>' : '';
    if (kind === 'timed') return '<div class="set-row head one"><span>Set</span><span>Seconds' + sideTag + '</span><span></span></div>';
    if (kind === 'bodyweight') return '<div class="set-row head one"><span>Set</span><span>Reps' + sideTag + '</span><span></span></div>';
    return '<div class="set-row head"><span>Set</span><span>' + WEIGHT_SIGN[kind] + u + '</span><span></span><span>Reps' + sideTag + '</span><span></span></div>';
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

  function render() {
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
    var strip = letters.map(function (l, i) {
      var cls = 'day' + (sum.days[i] ? ' done' : '') + (i === todayIdx ? ' today' : '');
      return '<div class="' + cls + '"><span class="dl">' + l + '</span><span class="dot" role="img" aria-label="' + (sum.days[i] ? 'Trained' : 'No workout') + '"></span></div>';
    }).join('');

    var weekLine = sum.thisCount === 0 ? 'No sessions yet this week'
      : sum.thisCount + ' session' + (sum.thisCount === 1 ? '' : 's') + ' · ' + sum.thisSets + ' sets this week';

    var upNext;
    if (S.active) {
      upNext = '<section class="card hero"><div class="hero-top"><span class="eyebrow on">In progress</span>' +
        '<span class="muted small">Started ' + new Date(S.active.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
        '<h2 class="big">' + esc(S.active.name) + '</h2>' +
        '<button class="btn primary block" data-act="resume-workout">Resume workout</button></section>';
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
          '<div class="row-2"><button class="btn ghost" data-act="tab" data-tab="workouts">Other routines</button>' +
          '<button class="btn ghost" data-act="start-empty">Empty workout</button></div></section>';
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

    return '<header class="top row end"><div class="top"><p class="eyebrow">' + now.toLocaleDateString('en-US', { weekday: 'long' }) + ' · ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</p><h1>Today</h1></div>' +
      '<div class="top-tools"><img class="wordmark-img" src="icons/wordmark.png" width="136" height="16" alt="PR Forge">' + settingsButton() + '</div></header>' +
      '<section class="week-wrap" aria-label="This week"><div class="week">' + strip + '</div><p class="week-line">' + weekLine + '</p></section>' +
      upNext + highlights;
  }
  function stat(label, value, cls) {
    return '<div class="stat"><span class="stat-v' + (cls ? ' ' + cls : '') + '">' + value + '</span><span class="stat-l">' + label + '</span></div>';
  }

  // ----- Workouts (templates) -----
  function viewWorkouts() {
    var list = S.templates.map(function (t) {
      var names = t.exercises.map(function (e) { return esc(exById(e.exerciseId).name); }).join(' · ');
      var sets = t.exercises.reduce(function (a, e) { return a + e.sets; }, 0);
      return '<section class="card tpl"><div class="tpl-head"><h3>' + esc(t.name) + '</h3>' +
        '<div class="tpl-btns"><button class="btn ghost sm" data-act="template-share" data-id="' + esc(t.id) + '">Share</button>' +
        '<button class="btn ghost sm" data-act="template-edit" data-id="' + esc(t.id) + '">Edit</button></div></div>' +
        '<p class="muted small">' + t.exercises.length + ' exercises · ' + sets + ' sets</p>' +
        (names ? '<p class="ex-names">' + names + '</p>' : '') +
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
        '<div class="stepper"><button data-act="tpl-sets" data-i="' + i + '" data-d="-1" aria-label="Fewer sets">−</button><span>' + e.sets + ' sets</span>' +
        '<button data-act="tpl-sets" data-i="' + i + '" data-d="1" aria-label="More sets">+</button></div>' +
        '<div class="tpl-tools"><button class="icon-btn" data-act="tpl-move" data-i="' + i + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button class="icon-btn" data-act="tpl-move" data-i="' + i + '" data-d="1" aria-label="Move down"' + (i === d.exercises.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button class="icon-btn" data-act="tpl-remove" data-i="' + i + '" aria-label="Remove">' + icon('close') + '</button></div></li>';
    }).join('');
    return '<header class="top row"><button class="btn ghost sm" data-act="template-cancel">' + icon('back', 'sm') + 'Back</button>' +
      '<h1 class="h-sm">' + (d.id ? 'Edit routine' : 'New routine') + '</h1><span></span></header>' +
      '<section class="card"><label class="field"><span>Name</span><input data-field="tpl-name" maxlength="60" placeholder="e.g. Push day" value="' + esc(d.name) + '"></label></section>' +
      '<section class="card"><h2 class="card-title">Exercises</h2>' +
      (rows ? '<ul class="tpl-list">' + rows + '</ul>' : '<p class="muted small">No exercises yet.</p>') +
      '<button class="btn ghost block" data-act="tpl-add-ex">' + icon('plus', 'sm') + 'Add exercises</button></section>' +
      '<button class="btn primary block" data-act="template-save">Save routine</button>' +
      (d.id ? '<button class="btn danger-ghost block" data-act="template-delete">Delete routine</button>' : '');
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
    var cards = a.exercises.map(function (entry) {
      var ex = exById(entry.exerciseId);
      var side = sideLabel(ex);
      var doneSets = entry.sets.filter(function (s) { return s.done; }).length;
      if (entry !== current) {
        var allDone = doneSets === entry.sets.length;
        var label = allDone ? icon('check') + 'Done' : doneSets ? doneSets + ' of ' + entry.sets.length + ' sets' : entry === nextEntry ? 'Next' : 'Later';
        return '<button class="ex-row' + (allDone ? ' done' : '') + '" data-act="ex-focus" data-e="' + entry.id + '">' +
          '<span class="ex-row-text"><span class="ex-row-label">' + label + '</span><span class="ex-row-name">' + esc(ex.name) + '</span></span>' +
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
        var hint = M.hintFor(last, kindIndex(entry, s), a.unit, s.warmup);
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
        '<p class="ex-meta">' + esc(ex.equipment) + (side ? ' · ' + side : '') + (lastText ? ' · ' + lastText : '') + '</p></div>' +
        '<div class="ex-tools">' + (best ? '<span class="ex-best" title="Your best so far">' + best + '</span>' : '') +
        '<button class="icon-btn" data-act="ex-remove" data-e="' + entry.id + '" aria-label="Remove exercise">' + icon('close', 'sm') + '</button></div></div>' +
        setHeadHtml(kind, a.unit, side) +
        rows +
        '<div class="ex-actions"><button class="btn ghost sm" data-act="set-add" data-e="' + entry.id + '">' + icon('plus', 'sm') + 'Add set</button>' +
        (entry.sets.length > 1 ? '<button class="btn ghost sm" data-act="set-remove" data-e="' + entry.id + '">Remove last set</button>' : '') +
        '<button class="btn ghost sm" data-act="ex-swap" data-e="' + entry.id + '">Swap</button>' +
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
      (S.workouts.length ? '' : '<p class="muted small tip">Faded numbers are last session’s. Tap ✓ to confirm a set — empty boxes take the faded values. Tap a set number to mark a warm-up.</p>') +
      cards +
      '<button class="btn ghost block" data-act="add-exercise">' + icon('plus', 'sm') + 'Add exercise</button>' +
      '<button class="btn danger-ghost block" data-act="discard-workout">Discard workout</button>';
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
  function viewProgress() {
    var trends = M.liftTrends(S.workouts, new Date());
    var trendCard = function (t) {
      var ex = exById(t.exerciseId);
      var values = t.spark.map(function (v) { return metricValue(t.metric, v); }).join(', ');
      return '<button class="card trend" data-act="lift-open" data-id="' + esc(t.exerciseId) + '"><span class="trend-main"><span class="trend-name"><span class="trend-lift">' + esc(ex.name) + '</span>' +
        '<span class="pill ' + t.status + '">' + STATUS_LABEL[t.status] + '</span></span>' +
        '<span class="trend-num">' + metricValue(t.metric, t.best) + '<small> ' + metricUnit(t.metric) + '</small></span>' +
        '<span class="muted small">' + (sideLabel(ex) ? sideLabel(ex) + ' · ' : '') + t.text + '</span></span>' +
        bars(t.spark, LAST_BAR[t.status], ex.name + ', ' + metricUnit(t.metric) + ' by session: ' + values) +
        (t.status === 'stalled' ? '<span class="idea">Try: ' + STALL_IDEAS[t.metric][0].toLowerCase() + ' Tap for more ideas.</span>' : '') +
        '</button>';
    };
    var group = function (title, statuses) {
      var items = trends.filter(function (t) { return statuses.indexOf(t.status) !== -1; });
      return items.length ? '<h2 class="month">' + title + '</h2>' + items.map(trendCard).join('') : '';
    };
    var trendHtml = trends.length
      ? group('Needs attention', ['stalled', 'down']) + group('Moving', ['progressing', 'holding']) + group('Building or paused', ['building', 'paused'])
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
    var ledeHtml = trends.length ? '<p class="lede">' + trends.length + ' lift' + (trends.length === 1 ? '' : 's') + ' in the last 8 weeks: ' + lede.join(', ') + '.</p>' : '';

    var view = V.progressView === 'records' ? 'records' : 'trends';
    var seg = '<div class="seg seg-wide" role="tablist">' +
      '<button class="' + (view === 'trends' ? 'on' : '') + '" data-act="progress-view" data-v="trends" aria-pressed="' + (view === 'trends') + '">Trends</button>' +
      '<button class="' + (view === 'records' ? 'on' : '') + '" data-act="progress-view" data-v="records" aria-pressed="' + (view === 'records') + '">Records</button></div>';
    var allEx = '<button class="btn ghost block" data-act="exercises-open">All exercises</button>';
    var how = '<details class="how"><summary>How trends are worked out</summary><p class="muted small">Each session’s best set is turned into an estimated one-rep max: weight × (1 + reps ÷ 30). Lifts without weight use your most reps or longest hold instead. ' +
      '<b>Progressing</b> = a new best within your last 3 sessions of that lift. <b>Holding</b> = 3–4 sessions since the best. <b>Stalled</b> = 5 or more. ' +
      '<b>Down</b> = your last 2 sessions were over 5% under your best of the 6 weeks before them. <b>Paused</b> = no session in 14 days or more. ' +
      'Warm-ups don’t count, and assisted lifts have no trend. Only lifts trained in the last 8 weeks are shown; every lift is under All exercises.</p></details>';
    var header = '<header class="top row"><h1>Progress</h1>' + settingsButton() + '</header>' + seg;
    if (view === 'records') {
      return header + '<section class="card"><h2 class="card-title">Personal records</h2><ul class="prs">' + recordsHtml() + '</ul></section>' + allEx;
    }
    return header + ledeHtml + (trends.length ? how : '') + weeklyChart() + trendHtml + allEx;
  }
  /** Personal records, one row per lift; each opens that lift's page. */
  function recordsHtml(onlyId) {
    var prs = M.personalRecords(S.workouts).filter(function (r) { return !onlyId || r.exerciseId === onlyId; });
    if (!prs.length) return '<li class="muted small">' + (onlyId ? 'No record yet. Imported and edited sessions don’t count as records.' : 'No records yet.') + '</li>';
    return prs.map(function (r) {
      var ex = exById(r.exerciseId);
      var main = r.bestE1rm ? 'Est. 1RM ' + w(r.bestE1rm.e1rmLb) + ' <span class="muted">(' + w(r.bestE1rm.weightLb) + ' × ' + r.bestE1rm.reps + ')</span>'
        : r.maxSeconds ? r.maxSeconds.seconds + ' sec'
        : r.leastAssist ? 'Least help ' + w(r.leastAssist.weightLb) + ' <span class="muted">× ' + r.leastAssist.reps + '</span>'
        : r.maxBwReps ? r.maxBwReps.reps + ' reps' : '—';
      var heavy = r.heaviest ? 'Heaviest ' + w(r.heaviest.weightLb) + ' × ' + r.heaviest.reps + ' · ' : '';
      var inner = '<strong>' + esc(ex.name) + (sideLabel(ex) ? ' <span class="plan-side">' + sideLabel(ex).toLowerCase() + '</span>' : '') + '</strong><span class="pr-main">' + main + '</span>' +
        '<span class="muted small">' + heavy + r.sessions + ' session' + (r.sessions === 1 ? '' : 's') + '</span>';
      return onlyId ? '<li class="pr">' + inner + '</li>'
        : '<li><button class="pr pr-btn" data-act="lift-open" data-id="' + esc(r.exerciseId) + '" data-from="progress">' + inner + '</button></li>';
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
    return rows.map(function (o) {
      var meta = o.sessions ? o.sessions + ' session' + (o.sessions === 1 ? '' : 's') + ' · last ' + relDay(o.last).toLowerCase()
        : o.routines ? 'In ' + o.routines + ' routine' + (o.routines === 1 ? '' : 's') + ', not logged yet' : 'Not used yet';
      return '<button class="ex-index-row" data-act="lift-open" data-id="' + esc(o.id) + '" data-from="exercises"><span class="paste-name"><strong>' + esc(o.ex.name) + '</strong>' +
        '<span class="muted small">' + esc(o.ex.muscle) + (o.ex.custom ? ' · Custom' : '') + ' · ' + meta + '</span></span>' + icon('arrow', 'sm') + '</button>';
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
  function viewSettings() {
    var rest = S.settings.restSeconds;
    var restChips = [[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']].map(function (r) {
      return '<button class="chip' + (rest === r[0] ? ' on' : '') + '" data-act="set-rest" data-v="' + r[0] + '" aria-pressed="' + (rest === r[0]) + '">' + r[1] + '</button>';
    }).join('');
    var acct = accountHtml();
    return '<header class="top row"><button class="btn ghost sm" data-act="settings-back">' + icon('back', 'sm') + 'Back</button><span></span></header>' +
      '<header class="top"><h1>Settings</h1></header>' +
      '<section class="card"><h2 class="card-title">Account &amp; backup</h2>' + acct +
      '<div class="setting col"><span>Backup file</span><p class="muted small">Your workouts back up to your account automatically. You can also save a copy as a file, or restore one (this replaces everything, here and in your account).</p>' +
      '<div class="row-2"><button class="btn ghost" data-act="export">Export backup</button><button class="btn ghost" data-act="import">Restore backup</button></div></div></section>' +
      '<section class="card"><h2 class="card-title">Logging</h2>' +
      '<div class="setting"><span>Units</span><div class="seg"><button class="' + (unit() === 'lb' ? 'on' : '') + '" data-act="set-unit" data-v="lb" aria-pressed="' + (unit() === 'lb') + '">lb</button>' +
      '<button class="' + (unit() === 'kg' ? 'on' : '') + '" data-act="set-unit" data-v="kg" aria-pressed="' + (unit() === 'kg') + '">kg</button></div></div>' +
      '<div class="setting col"><span>Rest timer after each set</span><div class="chips">' + restChips + '</div></div>' +
      '<label class="setting"><span>Bar weight (' + unit() + ')</span><input class="bar-input" data-field="bar" inputmode="decimal" autocomplete="off" value="' + U.fmtNum(barFor(unit())) + '"></label>' +
      '<button class="btn ghost block" data-act="exercises-open">Exercises: how each is logged, your own exercises</button></section>' +
      '<section class="card"><h2 class="card-title">Import</h2>' +
      '<div class="setting col"><span>Past workouts from Fitbod</span><p class="muted small">Export your workouts from Fitbod’s settings as a CSV file, then choose it here. Imported workouts never count as PRs, but later sessions have to beat them. To turn one into a routine, open it in History and tap Save as routine.</p>' +
      '<button class="btn ghost block" data-act="fitbod-pick">Choose Fitbod file</button>' + importsHtml() + '</div>' +
      '<div class="setting col"><span>Routines from a plan</span><p class="muted small">Paste a plan or choose a PDF, text or CSV file, for example one Claude wrote for you.</p>' +
      '<button class="btn ghost block" data-act="plan-paste">Paste or import a routine</button></div></section>' +
      '<button class="btn danger-ghost block" data-act="erase-all">Erase all my data</button>' +
      '<p class="muted small center">PR Forge web ' + VERSION + ' · ' + S.workouts.length + ' workouts saved · <a href="privacy.html">Privacy</a></p>' +
      fileInputs();
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
    return '<section class="card" aria-label="Weekly volume"><div class="pr-chart-head"><h2 class="card-title">Weekly volume</h2><span class="muted small">last 8 weeks</span></div>' +
      '<div class="vol-chart">' + columns + '</div>' +
      '<div class="pr-chart-foot"><span>' + shortDate(series[0].weekStart) + '</span><strong>This week</strong></div>' +
      '<p class="muted small" data-vol-read>' + esc(weekReadout(series[series.length - 1])) + '</p>' +
      '<p class="muted small">' + f.thisWeek + ' workout' + (f.thisWeek === 1 ? '' : 's') + ' this week · ' + U.fmtNum(f.priorAverage) + ' per week over the previous 4.</p></section>';
  }

  /** One lift over time. Tap-free on purpose: the session list below it holds the same numbers. */
  function liftChart(points, metric, status) {
    if (points.length < 2) return '<p class="muted small">Log another session to see a chart.</p>';
    var W = 320, H = 150, L = 8, R = 8, T = 22, B = 10;
    var vals = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var xy = points.map(function (p, i) {
      return [L + (i * (W - L - R)) / (points.length - 1), T + (H - T - B) * (max === min ? 0.5 : 1 - (p.value - min) / span)];
    });
    var last = xy[xy.length - 1];
    var dots = xy.map(function (c, i) {
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="4"' + (i === xy.length - 1 ? ' class="dot-' + status + '"' : '') + '><title>' +
        shortDate(points[i].date) + ': ' + metricValue(metric, points[i].value) + ' ' + metricUnit(metric) + '</title></circle>';
    }).join('');
    var label = points.map(function (p) { return shortDate(p.date) + ' ' + metricValue(metric, p.value); }).join(', ');
    return '<svg class="lift-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(metricUnit(metric) + ' by session: ' + label) + '">' +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - 1) + '" y2="' + (H - 1) + '"/>' +
      '<polyline points="' + xy.map(function (c) { return c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ') + '"/>' + dots +
      '<text x="' + Math.min(last[0], W - R) + '" y="' + Math.max(12, last[1] - 10).toFixed(1) + '" text-anchor="end">' + metricValue(metric, points[points.length - 1].value) + '</text></svg>';
  }

  /** How it's logged, plus rename/delete for your own exercises. Shown on every exercise page. */
  function liftManageHtml(ex) {
    var kind = exKind(ex.id);
    var label = (EX.TRACKING.filter(function (t) { return t.id === kind; })[0] || {}).label || kind;
    return '<section class="card"><h2 class="card-title">Settings</h2>' +
      '<div class="setting"><span>Logged as<br><span class="muted small">' + esc(label) + '. Applies the next time you add it.</span></span>' +
      '<button class="btn ghost sm" data-act="ex-default-type" data-id="' + esc(ex.id) + '">Change</button></div>' +
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
    var cutoff = Date.now() - 42 * 86400000;
    var shown = V.liftRange === 'all' ? trend.points : trend.points.filter(function (p) { return new Date(p.date).getTime() >= cutoff; });
    var rangeBtn = function (id, text) {
      return '<button class="' + (V.liftRange === id ? 'on' : '') + '" data-act="lift-range" data-v="' + id + '" aria-pressed="' + (V.liftRange === id) + '">' + text + '</button>';
    };
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
      '<div class="lift-head"><span class="trend-num">' + metricValue(trend.metric, trend.best) + '<small> ' + metricUnit(trend.metric) + ' best</small></span>' +
      '<span class="pill ' + trend.status + '">' + STATUS_LABEL[trend.status] + '</span></div>' +
      '<p class="lede">' + trend.text + '. ' + trend.sessions + ' session' + (trend.sessions === 1 ? '' : 's') + ' logged.</p>' +
      '<section class="card"><div class="pr-chart-head"><h2 class="card-title">Each session’s best</h2><div class="seg">' + rangeBtn('recent', '6 wk') + rangeBtn('all', 'All') + '</div></div>' +
      (shown.length ? liftChart(shown, trend.metric, trend.status) : '<p class="muted small">No sessions in the last 6 weeks.</p>') + '</section>' +
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
  function accountHtml() {
    var o = CLOUD.owner();
    if (!o) return '';
    var expired = CLOUD.status().state === 'signin';
    return '<div class="setting col"><span>Account</span><p class="muted small">Signed in as <strong>' + esc(o.email || 'Google account') + '</strong>. ' +
      '<span data-sync-status>' + esc(syncText()) + '</span></p>' +
      (expired ? '<button class="btn primary block" data-act="sign-in">Sign in again</button>' : '') +
      '<div class="row-2"><button class="btn ghost" data-act="sync-now">Back up now</button><button class="btn ghost" data-act="sign-out">Sign out</button></div>' +
      diagHtml() + '</div>';
  }
  function showSyncStatus() {
    var el = document.querySelector('[data-sync-status]');
    if (el) el.textContent = syncText();
    var need = CLOUD.status().state === 'signin';
    var btn = document.querySelector('.setting [data-act="sign-in"]');
    if (need !== !!btn && V.screen === 'settings') render();
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
      '<label class="field"><span>Date</span><input type="date" data-field="edit-date" value="' + localDate(d.startedAt) + '" max="' + localDate(new Date().toISOString()) + '"></label></section>' +
      cards +
      '<button class="btn ghost block" data-act="edit-ex-add">' + icon('plus', 'sm') + 'Add exercise</button>' +
      '<p class="muted small tip">Saving changes means this workout no longer counts as a PR. Later sessions still have to beat its numbers. Sets with nothing entered are dropped.</p>' +
      '<button class="btn primary block" data-act="edit-save">Save changes</button>';
  }
  function editEntry(eid) {
    if (!V.edit) return null;
    return V.edit.draft.exercises.filter(function (e) { return e.id === eid; })[0] || null;
  }
  function saveEdit() {
    var d = V.edit.draft;
    var changed = JSON.stringify(d) !== V.edit.original; // saving with no changes keeps any PR badge
    d.exercises = d.exercises.map(function (e) {
      var sets = e.sets.filter(function (s) {
        return entryKind(e) === 'timed' ? Number(s.seconds) > 0 : Number(s.reps) > 0;
      }).map(function (s) {
        s.done = true;
        if (s.weight == null) s.weight = 0;
        return s;
      });
      return { id: e.id, exerciseId: e.exerciseId, tracking: e.tracking, sets: sets };
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
        '<span class="muted small">' + durationText(wk.startedAt, wk.endedAt) + ' · ' + M.workoutSetCount(wk) + ' sets · ' + vol(M.workoutVolumeLb(wk)) + '</span>' +
        '<span class="ex-names">' + esc(names.slice(0, 4).join(' · ')) + (names.length > 4 ? ' +' + (names.length - 4) : '') + '</span>' +
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
    var dur = durationText(wk.startedAt, wk.endedAt).replace(/ ?(h|min)/g, '<small> $1</small>');
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
        (sideLabel(e) ? ' · ' + sideLabel(e) : '') + (e.custom ? ' · Custom' : '') + '</span></span>' +
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
    }).join('') + '</div><button class="btn ghost block" data-act="modal-cancel">Cancel</button>');
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
      exercises: (exercises || []).map(function (e) { return newEntry(e.exerciseId, e.sets); })
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
    var hint = M.hintFor(M.lastSessionFor(S.workouts, entry.exerciseId, S.active.id), kindIndex(entry, set), S.active.unit, set.warmup);
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
    set.done = true;
    vibrate(12);
    if (V.focusEntry === entry.id && entry.sets.every(function (s) { return s.done; })) V.focusEntry = null;
    if (S.settings.restSeconds > 0 && !set.warmup) V.rest = { endsAt: Date.now() + S.settings.restSeconds * 1000, total: S.settings.restSeconds * 1000 };
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

  function finishWorkout() {
    var a = S.active;
    var kept = a.exercises.map(function (e) {
      return { id: e.id, exerciseId: e.exerciseId, tracking: e.tracking, sets: e.sets.filter(function (s) { return s.done; }) };
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
      (unconfirmed ? ' ' + unconfirmed + ' unconfirmed set' + (unconfirmed === 1 ? '' : 's') + ' will be dropped.' : ''), 'Finish').then(function (ok) {
      if (!ok) return;
      var done = JSON.parse(JSON.stringify(a));
      done.exercises = kept;
      done.endedAt = new Date().toISOString();
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
    var text = ST.exportBackup(S);
    var name = 'pr-forge-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    var blob = new Blob([text], { type: 'application/json' });
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'PR Forge backup' }).catch(function () { /* cancelled */ });
        return;
      }
    } catch (e) { /* fall through to download */ }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup downloaded');
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
      return { exerciseId: e.exerciseId, sets: Math.min(20, Math.max(1, e.sets.filter(function (s) { return !s.warmup; }).length)) };
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
    'rest-add': function () { if (V.rest) { V.rest.endsAt += 30000; V.rest.total += 30000; tick(); } },
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
      if (d.id) S.templates = S.templates.map(function (t) { return t.id === d.id ? d : t; });
      else { d.id = uid(); S.templates.push(d); }
      V.tplDraft = null; V.screen = null; V.tab = 'workouts';
      commit(); toast('Saved');
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

    'lift-open': function (el) { V.liftId = el.dataset.id; V.liftFrom = el.dataset.from || 'progress'; V.liftRange = 'recent'; V.screen = 'lift'; render(); },
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
    'lift-range': function (el) { V.liftRange = el.dataset.v === 'all' ? 'all' : 'recent'; render(); },
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
          t.exercises.push({ exerciseId: id, sets: e.sets });
        });
        S.templates.push(t); saved.push(t);
      });
      V.planText = ''; V.planParsed = null;
      closeModal();
      V.tab = 'workouts'; V.screen = null;
      commit();
      toast(saved.length === 1 ? 'Saved “' + esc(saved[0].name) + '”' : 'Saved ' + saved.length + ' routines');
    },
    'settings-open': function () { V.screen = 'settings'; V.picker = null; render(); },
    'settings-back': function () { V.screen = null; render(); },

    'set-unit': function (el) {
      S.settings.unit = el.dataset.v === 'kg' ? 'kg' : 'lb'; commit();
      if (S.active && S.active.unit !== S.settings.unit) toast('The workout in progress stays in ' + S.active.unit + '; new workouts use ' + S.settings.unit + '.', '', 3500);
    },
    'set-rest': function (el) { S.settings.restSeconds = +el.dataset.v; commit(); },
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
    if (f === 'weight' || f === 'reps' || f === 'seconds') {
      var inEdit = el.dataset.scope === 'edit';
      var entry = inEdit ? editEntry(el.dataset.e) : findEntry(el.dataset.e); var set = entry && findSet(entry, el.dataset.s);
      if (!set) return;
      var n = parseNum(el.value);
      if (f !== 'weight' && n != null) n = Math.round(n);
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
    } else if (f === 'bar') {
      var bar = parseNum(el.value);
      if (bar > 0) {
        if (unit() === 'kg') S.settings.barKg = bar; else S.settings.barLb = bar;
        clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
      }
    } else if (f === 'tpl-name' && V.tplDraft) {
      V.tplDraft.name = el.value;
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
