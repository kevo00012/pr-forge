/* PR Forge — web app UI.
 * Plain JavaScript, no build step. State lives in `S` (saved to localStorage);
 * view state lives in `V` (not saved). Clicks are handled by one delegated
 * listener using data-act attributes. */
(function () {
  'use strict';

  var U = PRF.units, M = PRF.metrics, ST = PRF.store, EX = PRF.exercises;
  var VERSION = '1.2.0';

  var S = ST.load();
  var V = {
    tab: 'home',          // home | workouts | progress | history
    screen: null,         // null | 'workout' | 'template' | 'historyDetail'
    historyId: null,
    tplDraft: null,       // { id|null, name, exercises: [{exerciseId, sets}] }
    picker: null,         // { target: 'workout'|'template', q, muscle, selected: {} }
    rest: null,           // { endsAt, total }
    prShown: {},          // set id -> "weight x reps" that showed a PR banner
    prMoment: null,       // the full-screen PR panel being shown (see buildPrMoment)
    focusEntry: null,     // exercise opened by tap; otherwise the first with sets left
    summary: null,        // id of the workout just finished (shows "Workout saved")
    modal: null           // { resolve }
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
    if (hint && hint.weight > 0) return sets + ' × ' + U.fmtNum(hint.weight) + ' ' + u;
    return sets + ' set' + (sets === 1 ? '' : 's');
  }
  /** "Last time 3 × 5 @ 195 lb" when every working set matched, otherwise the top set. */
  function lastTimeText(last, u) {
    if (!last) return '';
    var count = last.sets.filter(function (s) { return !s.warmup; }).length;
    if (!count) return '';
    var hints = [];
    for (var i = 0; i < count; i++) hints.push(M.hintFor(last, i, u, false));
    var first = hints[0];
    var same = hints.every(function (h) { return h.weight === first.weight && h.reps === first.reps; });
    if (same) return 'Last time ' + count + ' × ' + first.reps + (first.weight > 0 ? ' @ ' + U.fmtNum(first.weight) + ' ' + u : '');
    var top = hints.reduce(function (a, h) { return h.weight > a.weight || (h.weight === a.weight && h.reps > a.reps) ? h : a; });
    return 'Last time top set ' + (top.weight > 0 ? U.fmtNum(top.weight) + ' ' + u + ' × ' + top.reps : top.reps + ' reps');
  }
  function bestText(exerciseId, u, excludeWorkoutId) {
    var e = 0, reps = 0;
    M.sessionsFor(S.workouts, exerciseId, excludeWorkoutId).forEach(function (s) {
      e = Math.max(e, s.topE1rm);
      reps = Math.max(reps, s.maxBwReps);
    });
    if (e > 0) return 'Best ' + Math.round(U.fromLb(e, u));
    return reps > 0 ? 'Best ' + reps + ' reps' : '';
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

  // ---------- render ----------
  function viewKey() {
    return V.screen ? V.screen + ':' + (V.historyId || '') : 'tab:' + V.tab;
  }

  function render() {
    var body;
    if (V.screen === 'workout' && S.active) body = viewWorkout();
    else if (V.screen === 'template' && V.tplDraft) body = viewTemplateEditor();
    else if (V.screen === 'historyDetail' && findWorkout(V.historyId)) body = viewHistoryDetail();
    else {
      V.screen = null;
      body = ({ home: viewHome, workouts: viewWorkouts, progress: viewProgress, history: viewHistory })[V.tab]();
    }
    var key = viewKey();
    var keepScroll = key === lastViewKey ? window.scrollY : 0;
    lastViewKey = key;

    var showSummary = V.screen === 'historyDetail' && V.summary === V.historyId;
    app.innerHTML =
      '<main class="screen' + (showSummary ? ' no-tabs' : '') + '">' + body + '</main>' +
      (S.active && V.screen !== 'workout' ? activeBar() : '') +
      (V.screen === 'workout' ? restBar() : '') +
      (showSummary ? '' : tabBar()) +
      (V.picker ? viewPicker() : '') +
      (V.prMoment ? viewPrMoment() : '');
    window.scrollTo(0, keepScroll);
    tick();
  }

  function tabBar() {
    var logging = V.screen === 'workout';
    var tabs = [['home', 'Today'], ['workouts', logging ? 'Workout' : 'Workouts'], ['progress', 'Progress'], ['history', 'History']];
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
          '<div class="row-2"><button class="btn ghost" data-act="tab" data-tab="workouts">Pick another</button>' +
          '<button class="btn ghost" data-act="start-empty">Empty workout</button></div></section>';
      } else {
        upNext = '<section class="card hero"><span class="eyebrow on">Get started</span><h2 class="big">Build your first workout</h2>' +
          '<p class="muted">Save the exercises you usually do, then start it from here in one tap.</p>' +
          '<button class="btn primary block" data-act="template-new">Create a workout</button>' +
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
      '<span class="wordmark sm">PR <span>FORGE</span></span></header>' +
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
        '<button class="btn ghost sm" data-act="template-edit" data-id="' + esc(t.id) + '">Edit</button></div>' +
        '<p class="muted small">' + t.exercises.length + ' exercises · ' + sets + ' sets</p>' +
        (names ? '<p class="ex-names">' + names + '</p>' : '') +
        '<button class="btn primary block" data-act="start-template" data-id="' + esc(t.id) + '">Start</button></section>';
    }).join('');
    if (!list) {
      list = '<section class="card empty"><p>No saved workouts yet.</p><p class="muted small">A saved workout is a list of exercises and how many sets you do of each. Starting one fills in last time’s numbers as hints.</p></section>';
    }
    return '<header class="top row"><h1>Workouts</h1><button class="btn primary sm" data-act="template-new">' + icon('plus', 'sm') + 'New</button></header>' +
      list + '<button class="btn ghost block" data-act="start-empty">Start an empty workout</button>';
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
      '<h1 class="h-sm">' + (d.id ? 'Edit workout' : 'New workout') + '</h1><span></span></header>' +
      '<section class="card"><label class="field"><span>Name</span><input data-field="tpl-name" maxlength="60" placeholder="e.g. Push day" value="' + esc(d.name) + '"></label></section>' +
      '<section class="card"><h2 class="card-title">Exercises</h2>' +
      (rows ? '<ul class="tpl-list">' + rows + '</ul>' : '<p class="muted small">No exercises yet.</p>') +
      '<button class="btn ghost block" data-act="tpl-add-ex">' + icon('plus', 'sm') + 'Add exercises</button></section>' +
      '<button class="btn primary block" data-act="template-save">Save workout</button>' +
      (d.id ? '<button class="btn danger-ghost block" data-act="template-delete">Delete workout</button>' : '');
  }

  // ----- Active workout -----
  function viewWorkout() {
    var a = S.active;
    var current = currentEntry();
    var nextShown = false, passed = false;
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
        var label = allDone ? icon('check') + 'Done' : doneSets ? doneSets + ' of ' + entry.sets.length + ' sets' : 'Later';
        if (!allDone && !doneSets && !nextShown && (passed || !current)) { label = 'Next'; nextShown = true; }
        return '<button class="ex-row' + (allDone ? ' done' : '') + '" data-act="ex-focus" data-e="' + entry.id + '">' +
          '<span class="ex-row-text"><span class="ex-row-label">' + label + '</span><span class="ex-row-name">' + esc(ex.name) + '</span></span>' +
          '<span class="ex-row-plan">' + (allDone ? doneSets + ' set' + (doneSets === 1 ? '' : 's') : planText(entry.exerciseId, entry.sets.length, a.unit, a.id)) +
          (side ? '<small>' + side.toLowerCase() + '</small>' : '') + '</span></button>';
      }
      passed = true;
      var last = M.lastSessionFor(S.workouts, entry.exerciseId, a.id);
      var activeSet = entry.sets.filter(function (s) { return !s.done; })[0];
      var lastText = lastTimeText(last, a.unit);
      var best = bestText(entry.exerciseId, a.unit, a.id);
      var rows = entry.sets.map(function (s, i) {
        var hint = M.hintFor(last, kindIndex(entry, s), a.unit, s.warmup);
        var workIdx = kindIndex(entry, s) + 1;
        var isPr = s.done && V.prShown[s.id] === prKey(s);
        return '<div class="set-row' + (s.done ? ' done' : '') + (s.warmup ? ' warm' : '') + (s === activeSet ? ' active' : '') + '">' +
          '<button class="set-n" data-act="set-warmup" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="Set ' + (i + 1) + (s.warmup ? ', warm-up' : '') + '. Tap to toggle warm-up">' + (s.warmup ? 'W' : workIdx) + '</button>' +
          '<span class="cell"><input class="num" data-field="weight" data-e="' + entry.id + '" data-s="' + s.id + '" inputmode="decimal" autocomplete="off" aria-label="Weight, set ' + (i + 1) + ' (' + a.unit + ')"' +
          ' placeholder="' + (hint && hint.weight > 0 ? U.fmtNum(hint.weight) : '') + '" value="' + (s.weight != null ? U.fmtNum(s.weight) : '') + '">' +
          (isPr ? '<span class="pr-tag">PR</span>' : '') + '</span>' +
          '<span class="x" aria-hidden="true">×</span>' +
          '<span class="cell"><input class="num" data-field="reps" data-e="' + entry.id + '" data-s="' + s.id + '" inputmode="numeric" autocomplete="off" aria-label="Reps' + (side ? ' ' + side.toLowerCase() : '') + ', set ' + (i + 1) + '"' +
          ' placeholder="' + (hint ? hint.reps : '') + '" value="' + (s.reps != null ? U.fmtNum(s.reps) : '') + '"></span>' +
          '<button class="check' + (s.done ? ' on' : '') + '" data-act="set-toggle" data-e="' + entry.id + '" data-s="' + s.id + '" aria-label="' + (s.done ? 'Unconfirm set ' : 'Confirm set ') + (i + 1) + '" aria-pressed="' + (s.done ? 'true' : 'false') + '">' + icon('check') + '</button>' +
          '</div>';
      }).join('');
      return '<section class="card ex-card" aria-label="' + esc(ex.name) + '"><div class="ex-head"><div class="ex-head-text"><h2>' + esc(ex.name) + '</h2>' +
        '<p class="ex-meta">' + esc(ex.equipment) + (side ? ' · ' + side : '') + (lastText ? ' · ' + lastText : '') + '</p></div>' +
        '<div class="ex-tools">' + (best ? '<span class="ex-best" title="Best estimated 1-rep max">' + best + '</span>' : '') +
        '<button class="icon-btn" data-act="ex-remove" data-e="' + entry.id + '" aria-label="Remove exercise">' + icon('close', 'sm') + '</button></div></div>' +
        '<div class="set-row head"><span>Set</span><span>' + a.unit + '</span><span></span><span>Reps' + (side ? ' <span class="head-side">' + side.toLowerCase() + '</span>' : '') + '</span><span></span></div>' +
        rows +
        '<div class="ex-actions"><button class="btn ghost sm" data-act="set-add" data-e="' + entry.id + '">' + icon('plus', 'sm') + 'Add set</button>' +
        (entry.sets.length > 1 ? '<button class="btn ghost sm" data-act="set-remove" data-e="' + entry.id + '">Remove last set</button>' : '') + '</div></section>';
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
  function prKey(set) { return set.weight + 'x' + set.reps; }

  /** Everything the PR panel shows, worked out when the set is confirmed. */
  function buildPrMoment(entry, set, pr) {
    var u = S.active.unit;
    var ex = exById(entry.exerciseId);
    var id = entry.exerciseId;
    var hist = M.sessionsFor(S.workouts, id, S.active.id);
    var m = { name: ex.name, side: sideLabel(ex), unit: u, type: pr.type, weight: set.weight, reps: set.reps, note: '' };
    if (pr.type !== 'e1rm') {
      hist = hist.filter(function (s) { return s.maxBwReps > 0; }).slice(-7);
      m.previous = pr.previous;
      m.values = hist.map(function (s) { return s.maxBwReps; }).concat(pr.reps);
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
    var main = isE ? U.fmtNum(m.weight) : String(m.reps);
    var sub = isE ? '<span>' + m.unit + '</span><span>× ' + m.reps + '</span>' : '<span>reps</span>';
    var grid = isE
      ? '<div class="pr-grid"><div><strong>' + U.fmtWeightLb(m.e1rmLb, m.unit) + '</strong><span>Estimated 1-rep max</span></div>' +
        '<div><strong>+' + U.fmtWeightLb(m.e1rmLb - m.previousLb, m.unit) + '</strong><span>Over your best of ' + U.fmtNum(U.fromLb(m.previousLb, m.unit)) + '</span></div></div>'
      : '<div class="pr-grid one"><div><strong>+' + (m.reps - m.previous) + ' reps</strong><span>Over your best of ' + m.previous + '</span></div></div>';
    var display = m.values.map(function (v) { return isE ? U.fmtNum(U.fromLb(v, m.unit)) : String(v); });
    return '<div class="pr-moment" role="dialog" aria-modal="true" aria-label="New personal record">' +
      '<section class="pr-panel"><div class="pr-panel-top"><span class="pr-kicker">' + icon('trophy') + 'New personal record</span>' +
      '<button class="pr-close" data-act="pr-close" aria-label="Close">' + icon('close', 'sm') + '</button></div>' +
      '<h1 class="pr-name">' + esc(m.name) + '</h1>' + (m.side ? '<span class="pr-side">' + m.side + '</span>' : '') +
      '<p class="pr-num' + (main.length > 4 ? ' long' : '') + '"><span class="pr-num-main">' + main + '</span><span class="pr-num-sub">' + sub + '</span></p>' +
      grid + '</section>' +
      '<section class="pr-chart" aria-label="Recent sessions"><div class="pr-chart-head"><h2 class="card-title">Best set each session</h2><span>' + (isE ? 'est. 1RM, ' + m.unit : 'reps') + '</span></div>' +
      bars(m.values, 'last-accent', 'Last ' + m.values.length + ' sessions: ' + display.join(', ') + ', the last one today', true) +
      '<div class="pr-chart-foot"><span>' + (m.from ? new Date(m.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</span><strong>Today</strong></div>' +
      (m.note ? '<p class="pr-note">' + m.note + '</p>' : '') + '</section>' +
      '<div class="pr-foot"><button class="btn white block" data-act="pr-close">Keep going' + (V.rest ? '<span data-rest-note>· rest <span data-rest></span></span>' : '') + '</button></div></div>';
  }

  // ----- Progress -----
  function viewProgress() {
    var trends = M.liftTrends(S.workouts, new Date());
    var STATUS = { progressing: 'Progressing', holding: 'Holding', stalled: 'Stalled', building: 'Building data' };
    var LAST_BAR = { progressing: 'last-accent', holding: 'last-soft', stalled: 'last-warn', building: 'last-soft' };
    var trendHtml = trends.length ? trends.map(function (t) {
      var ex = exById(t.exerciseId);
      var values = t.spark.map(function (v) { return U.fmtNum(U.fromLb(v, unit())); }).join(', ');
      return '<article class="card trend"><div class="trend-main"><div class="trend-name"><h2 class="h-lift">' + esc(ex.name) + '</h2>' +
        '<span class="pill ' + t.status + '">' + STATUS[t.status] + '</span></div>' +
        '<span class="trend-num">' + U.fmtNum(U.fromLb(t.bestE1rmLb, unit())) + '<small> ' + unit() + ' est. 1RM</small></span>' +
        '<span class="muted small">' + (sideLabel(ex) ? sideLabel(ex) + ' · ' : '') + t.text + '</span></div>' +
        bars(t.spark, LAST_BAR[t.status], ex.name + ', estimated 1-rep max by session: ' + values) +
        (t.status === 'stalled' ? '<p class="idea">Try: drop about 10% and build back up, switch rep range (e.g. 5s → 8s), or add one set.</p>' : '') +
        '</article>';
    }).join('') : '<section class="card empty"><p class="muted small">Finish a few workouts with weighted sets and each lift’s trend shows up here.</p></section>';

    var counts = { progressing: 0, holding: 0, stalled: 0, building: 0 };
    trends.forEach(function (t) { counts[t.status]++; });
    var lede = [];
    if (counts.progressing) lede.push('<strong class="win">' + counts.progressing + ' progressing</strong>');
    if (counts.holding) lede.push(counts.holding + ' holding');
    if (counts.stalled) lede.push('<strong class="warn">' + counts.stalled + ' stalled</strong>');
    if (counts.building) lede.push(counts.building + ' building data');
    var ledeHtml = trends.length ? '<p class="lede">' + trends.length + ' lift' + (trends.length === 1 ? '' : 's') + ' in the last 8 weeks: ' + lede.join(', ') + '.</p>' : '';

    var prs = M.personalRecords(S.workouts);
    var prHtml = prs.length ? prs.map(function (r) {
      var ex = exById(r.exerciseId);
      var main = r.bestE1rm ? 'Est. 1RM ' + w(r.bestE1rm.e1rmLb) + ' <span class="muted">(' + w(r.bestE1rm.weightLb) + ' × ' + r.bestE1rm.reps + ')</span>'
        : r.maxBwReps ? r.maxBwReps.reps + ' reps' : '—';
      var heavy = r.heaviest ? 'Heaviest ' + w(r.heaviest.weightLb) + ' × ' + r.heaviest.reps + ' · ' : '';
      return '<li class="pr"><strong>' + esc(ex.name) + (sideLabel(ex) ? ' <span class="plan-side">' + sideLabel(ex).toLowerCase() + '</span>' : '') + '</strong><span class="pr-main">' + main + '</span>' +
        '<span class="muted small">' + heavy + r.sessions + ' session' + (r.sessions === 1 ? '' : 's') + '</span></li>';
    }).join('') : '<li class="muted small">No records yet.</li>';

    var rest = S.settings.restSeconds;
    var restChips = [[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']].map(function (r) {
      return '<button class="chip' + (rest === r[0] ? ' on' : '') + '" data-act="set-rest" data-v="' + r[0] + '">' + r[1] + '</button>';
    }).join('');

    return '<header class="top"><h1>Progress</h1></header>' +
      ledeHtml + trendHtml +
      '<details class="how"><summary>How trends are worked out</summary><p class="muted small">Each session’s best set is turned into an estimated one-rep max: weight × (1 + reps ÷ 30). ' +
      '<b>Progressing</b> = a new best within your last 3 sessions of that lift. <b>Holding</b> = 3–4 sessions since the best. <b>Stalled</b> = 5 or more. ' +
      'Warm-ups don’t count. Only lifts trained in the last 8 weeks are shown.</p></details>' +
      '<section class="card"><h2 class="card-title">Personal records</h2><ul class="prs">' + prHtml + '</ul></section>' +
      '<section class="card"><h2 class="card-title">Settings &amp; data</h2>' +
      '<div class="setting"><span>Units</span><div class="seg"><button class="' + (unit() === 'lb' ? 'on' : '') + '" data-act="set-unit" data-v="lb">lb</button>' +
      '<button class="' + (unit() === 'kg' ? 'on' : '') + '" data-act="set-unit" data-v="kg">kg</button></div></div>' +
      '<div class="setting col"><span>Rest timer after each set</span><div class="chips">' + restChips + '</div></div>' +
      '<div class="setting col"><span>Backup</span><p class="muted small">Your workouts are saved only in this browser on this device. Export a backup now and then, and before switching phones.</p>' +
      '<div class="row-2"><button class="btn ghost" data-act="export">Export backup</button><button class="btn ghost" data-act="import">Restore backup</button></div></div>' +
      '<button class="btn danger-ghost block" data-act="erase-all">Erase all data on this device</button>' +
      '<p class="muted small center">PR Forge web ' + VERSION + ' · ' + S.workouts.length + ' workouts saved</p></section>' +
      '<input type="file" id="import-file" accept=".json,application/json" hidden>';
  }

  // ----- History -----
  function findWorkout(id) {
    for (var i = 0; i < S.workouts.length; i++) if (S.workouts[i].id === id) return S.workouts[i];
    return null;
  }

  function viewHistory() {
    var list = M.finished(S.workouts).slice().reverse();
    if (!list.length) {
      return '<header class="top"><h1>History</h1></header><section class="card empty"><p>No finished workouts yet.</p><p class="muted small">Workouts show up here when you tap Finish.</p></section>';
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
    return '<header class="top"><h1>History</h1></header>' + html;
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
        if (evt && !marked && !s.warmup && Number(s.reps) === evt.reps) {
          isPr = evt.type === 'e1rm' ? Math.abs(U.toLb(s.weight, wk.unit) - evt.weightLb) < 0.01 : !(Number(s.weight) > 0);
          marked = isPr;
        }
        var text = Number(s.weight) > 0 ? U.fmtNum(s.weight) + ' × ' + U.fmtNum(s.reps) : U.fmtNum(s.reps) + ' reps';
        return '<span class="set-chip' + (s.warmup ? ' warm' : '') + (isPr ? ' is-pr' : '') + '">' + (s.warmup ? 'W ' : '') + text + '</span>';
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
        '<button class="btn ghost block" data-act="history-to-template">Save as a workout</button></div>';
    }
    return '<header class="top row"><button class="btn ghost sm" data-act="history-back">' + icon('back', 'sm') + 'History</button><span></span></header>' +
      '<header class="top"><p class="eyebrow">' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + '</p><h1>' + esc(wk.name) + '</h1></header>' +
      stats + wins + log +
      '<div class="foot-actions"><button class="btn ghost block" data-act="history-to-template">Save as a workout</button>' +
      '<button class="btn danger-ghost block" data-act="history-delete">Delete this workout</button></div>';
  }
  function prWin(wk, evt) {
    var detail = evt.reps + ' reps';
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
    return '<div class="sheet-wrap"><div class="backdrop" data-act="picker-close"></div><div class="sheet" role="dialog" aria-label="Add exercises">' +
      '<div class="sheet-head"><h2>Add exercises</h2><button class="icon-btn" data-act="picker-close" aria-label="Close">' + icon('close') + '</button></div>' +
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
  function newSet() { return { id: uid(), weight: null, reps: null, done: false, warmup: false }; }
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
        var sets = [];
        for (var i = 0; i < e.sets; i++) sets.push(newSet());
        return { id: uid(), exerciseId: e.exerciseId, sets: sets };
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
    var hint = M.hintFor(M.lastSessionFor(S.workouts, entry.exerciseId, S.active.id), kindIndex(entry, set), S.active.unit, set.warmup);
    if (set.weight == null && hint) set.weight = hint.weight;
    if (set.reps == null && hint) set.reps = hint.reps;
    if (!(Number(set.reps) > 0)) {
      toast('Enter reps first', 'warn');
      render();
      return;
    }
    if (set.weight == null) set.weight = 0;
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
      return { id: e.id, exerciseId: e.exerciseId, sets: e.sets.filter(function (s) { return s.done; }) };
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
      confirmBox('Restore this backup?', 'Backup' + esc(when) + ': ' + next.workouts.length + ' workouts, ' + next.templates.length + ' saved workouts.<br>' +
        'This replaces everything on this device (' + S.workouts.length + ' workouts now).', 'Replace my data', true).then(function (ok) {
        if (!ok) return;
        try { localStorage.setItem(ST.KEY + ':before-restore', JSON.stringify(S)); } catch (e) { /* ignore */ }
        S = next;
        V.screen = null; V.rest = null; V.picker = null;
        commit();
        toast('Backup restored');
      });
    };
    reader.onerror = function () { toast('Couldn’t read that file', 'warn'); };
    reader.readAsText(file);
  }

  var actions = {
    'tab': function (el) { V.tab = el.dataset.tab; V.screen = null; V.tplDraft = null; render(); },
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
      entry.sets.push(newSet()); commit();
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
    'template-edit': function (el) {
      var t = S.templates.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!t) return;
      V.tplDraft = JSON.parse(JSON.stringify(t)); V.screen = 'template'; render();
    },
    'template-cancel': function () { V.tplDraft = null; V.screen = null; V.tab = 'workouts'; render(); },
    'template-save': function () {
      var d = V.tplDraft;
      d.name = (d.name || '').trim();
      if (!d.name) { toast('Give the workout a name', 'warn'); return; }
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
      } else if (S.active) {
        ids.forEach(function (id) { S.active.exercises.push({ id: uid(), exerciseId: id, sets: [newSet(), newSet(), newSet()] }); });
        V.picker = null; commit();
      }
    },
    'picker-custom': customExerciseForm,
    'custom-save': function () {
      var name = (document.getElementById('cx-name').value || '').trim();
      if (!name) { toast('Enter a name', 'warn'); return; }
      var ex = { id: 'c-' + uid(), name: name.slice(0, 80), muscle: document.getElementById('cx-muscle').value,
        equipment: document.getElementById('cx-equip').value, side: document.getElementById('cx-side').value, custom: true };
      S.customExercises.push(ex);
      save();
      closeModal();
      if (V.picker) { V.picker.selected[ex.id] = Date.now(); V.picker.q = ''; render(); }
      toast('Added “' + esc(ex.name) + '”');
    },
    'modal-ok': function () { closeModal(true); },
    'modal-cancel': function () { closeModal(false); },

    'history-open': function (el) { V.historyId = el.dataset.id; V.screen = 'historyDetail'; render(); },
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
      V.tplDraft = { id: null, name: wk.name, exercises: wk.exercises.map(function (e) {
        return { exerciseId: e.exerciseId, sets: Math.max(1, e.sets.filter(function (s) { return !s.warmup; }).length) };
      }) };
      V.screen = 'template'; render();
    },

    'set-unit': function (el) {
      S.settings.unit = el.dataset.v === 'kg' ? 'kg' : 'lb'; commit();
      if (S.active && S.active.unit !== S.settings.unit) toast('The workout in progress stays in ' + S.active.unit + '; new workouts use ' + S.settings.unit + '.', '', 3500);
    },
    'set-rest': function (el) { S.settings.restSeconds = +el.dataset.v; commit(); },
    'export': exportBackup,
    'import': function () { var f = document.getElementById('import-file'); if (f) { f.value = ''; f.click(); } },
    'erase-all': function () {
      confirmBox('Erase everything?', 'All workouts, saved workouts and settings on this device will be deleted. Export a backup first if you might want them.', 'Erase all', true).then(function (ok) {
        if (!ok) return;
        S = ST.defaults(); V.screen = null; V.tab = 'home'; V.rest = null; commit();
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
    if (f === 'weight' || f === 'reps') {
      var entry = findEntry(el.dataset.e); var set = entry && findSet(entry, el.dataset.s);
      if (!set) return;
      var n = parseNum(el.value);
      if (f === 'reps' && n != null) n = Math.round(n);
      set[f] = n;
      clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
    } else if (f === 'tpl-name' && V.tplDraft) {
      V.tplDraft.name = el.value;
    } else if (f === 'picker-q' && V.picker) {
      V.picker.q = el.value; refreshPicker();
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.id === 'import-file' && el.files && el.files[0]) importBackup(el.files[0]);
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
    render();
    var splash = document.getElementById('splash');
    var t0 = window.__prfStart || Date.now();
    var wait = Math.max(0, 3000 - (Date.now() - t0)); // branding shows for at least 3 s
    setTimeout(function () {
      app.hidden = false;
      splash.classList.add('out');
      setTimeout(function () { splash.remove(); }, 450);
    }, wait);
    if (S.active) { V.screen = 'workout'; render(); }

    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && location.hostname !== 'localhost') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache unavailable */ });
    }
  }

  // Exposed for automated layout checks only.
  window.__prf = { state: function () { return S; }, view: V, render: render };

  boot();
})();
