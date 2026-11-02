/* PR Forge — workout math. Pure functions, no DOM, no storage.
 *
 * Workout shape:
 *   { id, name, templateId, startedAt (ISO), endedAt (ISO|null), unit: 'lb'|'kg',
 *     exercises: [{ id, exerciseId, sets: [{ id, weight, reps, done, warmup }] }] }
 * Weights are stored in the workout's own unit; everything here compares in lb.
 *
 * A "working set" is confirmed (done), not a warm-up, and has reps > 0.
 * Per-arm/per-leg sets count once (weight x reps) — volume is never doubled. */
(function (root) {
  'use strict';

  var units = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./units.js')
    : root.PRF.units;

  var DAY_MS = 24 * 60 * 60 * 1000;
  var EPS_LB = 0.05; // ignore conversion noise when comparing PRs

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function isWorkingSet(set) {
    return !!(set && set.done && !set.warmup && num(set.reps) > 0);
  }

  /** Estimated one-rep max (Epley). 1 rep = the weight itself. */
  function e1rm(weightLb, reps) {
    var w = num(weightLb), r = num(reps);
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }

  function setVolumeLb(set, unit) {
    if (!isWorkingSet(set)) return 0;
    return units.toLb(set.weight, unit) * num(set.reps);
  }

  function workoutVolumeLb(workout) {
    var total = 0;
    (workout.exercises || []).forEach(function (ex) {
      (ex.sets || []).forEach(function (s) { total += setVolumeLb(s, workout.unit); });
    });
    return total;
  }

  function workoutSetCount(workout) {
    var n = 0;
    (workout.exercises || []).forEach(function (ex) {
      (ex.sets || []).forEach(function (s) { if (isWorkingSet(s)) n++; });
    });
    return n;
  }

  function finished(workouts) {
    return (workouts || [])
      .filter(function (w) { return w && w.endedAt; })
      .slice()
      .sort(function (a, b) { return new Date(a.startedAt) - new Date(b.startedAt); });
  }

  /** Summarise one exercise inside one workout (merging repeated entries). */
  function summarise(workout, exerciseId, skipSetId) {
    var out = { topE1rm: 0, topWeightLb: 0, topWeightReps: 0, bestE1rmSet: null, maxBwReps: 0, volumeLb: 0, sets: 0 };
    (workout.exercises || []).forEach(function (ex) {
      if (ex.exerciseId !== exerciseId) return;
      (ex.sets || []).forEach(function (s) {
        if (!isWorkingSet(s) || s.id === skipSetId) return;
        var lb = units.toLb(s.weight, workout.unit);
        var reps = num(s.reps);
        out.sets++;
        out.volumeLb += lb * reps;
        if (lb > 0) {
          var est = e1rm(lb, reps);
          if (est > out.topE1rm) {
            out.topE1rm = est;
            out.bestE1rmSet = { weightLb: lb, reps: reps };
          }
          if (lb > out.topWeightLb || (lb === out.topWeightLb && reps > out.topWeightReps)) {
            out.topWeightLb = lb;
            out.topWeightReps = reps;
          }
        } else if (reps > out.maxBwReps) {
          out.maxBwReps = reps;
        }
      });
    });
    return out;
  }

  /** Chronological sessions of one exercise across finished workouts. */
  function sessionsFor(workouts, exerciseId, excludeWorkoutId) {
    var list = [];
    finished(workouts).forEach(function (w) {
      if (w.id === excludeWorkoutId) return;
      var s = summarise(w, exerciseId);
      if (s.sets > 0) {
        s.workoutId = w.id;
        s.date = w.startedAt;
        list.push(s);
      }
    });
    return list;
  }

  /**
   * Did confirming this set in the active workout set a new PR?
   * Returns null, or { type: 'e1rm', e1rmLb, weightLb, reps, previousLb }
   * or { type: 'reps', reps, previous } (body-weight sets).
   * No PR on the first-ever session of a lift, on warm-ups, or on unconfirmed sets.
   */
  function checkPr(workouts, active, entryId, setId) {
    if (!active) return null;
    var entry = (active.exercises || []).filter(function (e) { return e.id === entryId; })[0];
    if (!entry) return null;
    var set = (entry.sets || []).filter(function (s) { return s.id === setId; })[0];
    if (!isWorkingSet(set)) return null;

    var history = sessionsFor(workouts, entry.exerciseId, active.id);
    if (history.length === 0) return null; // first-ever session of this lift

    var priorE1rm = 0, priorReps = 0;
    history.forEach(function (h) {
      if (h.topE1rm > priorE1rm) priorE1rm = h.topE1rm;
      if (h.maxBwReps > priorReps) priorReps = h.maxBwReps;
    });
    var today = summarise(active, entry.exerciseId, set.id); // other sets already done today
    priorE1rm = Math.max(priorE1rm, today.topE1rm);
    priorReps = Math.max(priorReps, today.maxBwReps);

    var lb = units.toLb(set.weight, active.unit);
    var reps = num(set.reps);
    if (lb > 0) {
      var est = e1rm(lb, reps);
      if (priorE1rm > 0 && est > priorE1rm + EPS_LB) {
        return { type: 'e1rm', e1rmLb: est, weightLb: lb, reps: reps, previousLb: priorE1rm };
      }
      return null;
    }
    if (priorReps > 0 && reps > priorReps) {
      return { type: 'reps', reps: reps, previous: priorReps };
    }
    return null;
  }

  /** Every PR event in history (one per exercise per session, never the first session). */
  function prEvents(workouts) {
    var best = {}; // exerciseId -> { e1rm, reps }
    var events = [];
    finished(workouts).forEach(function (w) {
      var ids = {};
      (w.exercises || []).forEach(function (ex) { ids[ex.exerciseId] = true; });
      Object.keys(ids).forEach(function (id) {
        var s = summarise(w, id);
        if (s.sets === 0) return;
        var b = best[id];
        if (b) {
          if (s.topE1rm > 0 && b.e1rm > 0 && s.topE1rm > b.e1rm + EPS_LB) {
            events.push({ workoutId: w.id, date: w.startedAt, exerciseId: id, type: 'e1rm',
              e1rmLb: s.topE1rm, weightLb: s.bestE1rmSet.weightLb, reps: s.bestE1rmSet.reps });
          } else if (s.topE1rm === 0 && s.maxBwReps > 0 && b.reps > 0 && s.maxBwReps > b.reps) {
            events.push({ workoutId: w.id, date: w.startedAt, exerciseId: id, type: 'reps', reps: s.maxBwReps });
          }
        } else {
          b = best[id] = { e1rm: 0, reps: 0 };
        }
        b.e1rm = Math.max(b.e1rm, s.topE1rm);
        b.reps = Math.max(b.reps, s.maxBwReps);
      });
    });
    return events;
  }

  /** Best marks per exercise, most recently trained first. */
  function personalRecords(workouts) {
    var map = {};
    finished(workouts).forEach(function (w) {
      var ids = {};
      (w.exercises || []).forEach(function (ex) { ids[ex.exerciseId] = true; });
      Object.keys(ids).forEach(function (id) {
        var s = summarise(w, id);
        if (s.sets === 0) return;
        var r = map[id] || (map[id] = { exerciseId: id, sessions: 0, lastDate: null,
          bestE1rm: null, heaviest: null, maxBwReps: null });
        r.sessions++;
        r.lastDate = w.startedAt;
        if (s.topE1rm > 0 && (!r.bestE1rm || s.topE1rm > r.bestE1rm.e1rmLb + EPS_LB)) {
          r.bestE1rm = { e1rmLb: s.topE1rm, weightLb: s.bestE1rmSet.weightLb, reps: s.bestE1rmSet.reps, date: w.startedAt };
        }
        if (s.topWeightLb > 0 && (!r.heaviest || s.topWeightLb > r.heaviest.weightLb + EPS_LB)) {
          r.heaviest = { weightLb: s.topWeightLb, reps: s.topWeightReps, date: w.startedAt };
        }
        if (s.maxBwReps > 0 && (!r.maxBwReps || s.maxBwReps > r.maxBwReps.reps)) {
          r.maxBwReps = { reps: s.maxBwReps, date: w.startedAt };
        }
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return new Date(b.lastDate) - new Date(a.lastDate); });
  }

  /** Monday 00:00 local time of the week containing `date`. */
  function startOfWeek(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    var offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  /**
   * This week vs last week. `pct` is null whenever a percentage would mislead
   * (no workouts yet this week, or nothing to compare with). It never shows -100%.
   * status: 'none' (no workouts this week) | 'new' (nothing last week) | 'up' | 'down' | 'even'
   */
  function weeklySummary(workouts, now) {
    var ws = startOfWeek(now || new Date());
    var we = addDays(ws, 7);
    var lws = addDays(ws, -7);
    var thisVol = 0, lastVol = 0, thisCount = 0, lastCount = 0, thisSets = 0;
    var days = [false, false, false, false, false, false, false];
    finished(workouts).forEach(function (w) {
      var t = new Date(w.startedAt);
      if (t >= ws && t < we) {
        thisVol += workoutVolumeLb(w);
        thisSets += workoutSetCount(w);
        thisCount++;
        days[(t.getDay() + 6) % 7] = true;
      } else if (t >= lws && t < ws) {
        lastVol += workoutVolumeLb(w);
        lastCount++;
      }
    });
    var pct = null, status;
    if (thisCount === 0) status = 'none';
    else if (lastVol <= 0) status = 'new';
    else {
      pct = Math.round(((thisVol - lastVol) / lastVol) * 100);
      if (pct <= -100) pct = -99; // only reachable by rounding; never display -100%
      status = pct > 0 ? 'up' : pct < 0 ? 'down' : 'even';
    }
    var prs = prEvents(workouts).filter(function (e) {
      var t = new Date(e.date);
      return t >= ws && t < we;
    });
    return {
      weekStart: ws.toISOString(),
      thisVolumeLb: thisVol, lastVolumeLb: lastVol,
      thisCount: thisCount, lastCount: lastCount, thisSets: thisSets,
      pct: pct, status: status, days: days, prs: prs
    };
  }

  /**
   * Per-lift trend, explained in plain words. Based on each session's best
   * estimated 1RM. Lifts trained in the last `windowDays` (default 56) only.
   * status: 'building' (<3 sessions) | 'progressing' (new best within the last 3 sessions)
   *         | 'holding' (3–4 sessions since best) | 'stalled' (5+ sessions since best)
   */
  function liftTrends(workouts, now, windowDays) {
    var cutoff = new Date((now || new Date()).getTime() - (windowDays || 56) * DAY_MS);
    var ids = {};
    finished(workouts).forEach(function (w) {
      (w.exercises || []).forEach(function (ex) { ids[ex.exerciseId] = true; });
    });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var sessions = sessionsFor(workouts, id).filter(function (s) { return s.topE1rm > 0; });
      if (sessions.length === 0) return;
      var last = sessions[sessions.length - 1];
      if (new Date(last.date) < cutoff) return;

      var best = 0, bestIdx = 0;
      sessions.forEach(function (s, i) {
        if (s.topE1rm > best + EPS_LB) { best = s.topE1rm; bestIdx = i; }
      });
      var n = sessions.length;
      var since = n - 1 - bestIdx;
      var status, text;
      if (n < 3) {
        status = 'building';
        text = 'Log ' + (3 - n) + ' more session' + (3 - n === 1 ? '' : 's') + ' to see a trend';
      } else if (since <= 2) {
        status = 'progressing';
        text = since === 0 ? 'New best last session'
          : 'New best ' + since + ' session' + (since === 1 ? '' : 's') + ' ago';
      } else if (since <= 4) {
        status = 'holding';
        text = 'No new best in ' + since + ' sessions';
      } else {
        status = 'stalled';
        text = 'No new best in ' + since + ' sessions';
      }
      out.push({
        exerciseId: id, status: status, text: text, sessions: n,
        bestE1rmLb: best, lastE1rmLb: last.topE1rm, lastDate: last.date,
        spark: sessions.slice(-8).map(function (s) { return s.topE1rm; })
      });
    });
    return out.sort(function (a, b) { return new Date(b.lastDate) - new Date(a.lastDate); });
  }

  /** The most recent finished session containing this exercise (for ghost hints). */
  function lastSessionFor(workouts, exerciseId, excludeWorkoutId) {
    var list = finished(workouts);
    for (var i = list.length - 1; i >= 0; i--) {
      var w = list[i];
      if (w.id === excludeWorkoutId) continue;
      var sets = [];
      (w.exercises || []).forEach(function (ex) {
        if (ex.exerciseId !== exerciseId) return;
        (ex.sets || []).forEach(function (s) {
          if (s.done && num(s.reps) > 0) sets.push({ weight: num(s.weight), reps: num(s.reps), warmup: !!s.warmup });
        });
      });
      if (sets.length) return { workoutId: w.id, date: w.startedAt, unit: w.unit, sets: sets };
    }
    return null;
  }

  /**
   * Faded hint for a set, converted into the active workout's unit.
   * `index` counts sets of the same kind: working sets get hints from last
   * session's working sets, warm-ups from its warm-ups (falls back to any set).
   */
  function hintFor(last, index, targetUnit, warmup) {
    if (!last || !last.sets.length) return null;
    var pool = last.sets.filter(function (s) { return !!s.warmup === !!warmup; });
    if (!pool.length) pool = last.sets;
    var s = pool[Math.min(index, pool.length - 1)];
    var weight = s.weight > 0 ? units.roundForEntry(units.convert(s.weight, last.unit, targetUnit)) : 0;
    return { weight: weight, reps: s.reps };
  }

  /** Suggest the template done least recently (never-done ones first, in list order). */
  function suggestNext(templates, workouts) {
    if (!templates || !templates.length) return null;
    var lastDone = {};
    finished(workouts).forEach(function (w) {
      if (w.templateId) lastDone[w.templateId] = w.startedAt;
    });
    var pick = null;
    templates.forEach(function (t) {
      var d = lastDone[t.id] || null;
      if (!pick) { pick = { template: t, lastDate: d }; return; }
      if (pick.lastDate === null) return;
      if (d === null || new Date(d) < new Date(pick.lastDate)) pick = { template: t, lastDate: d };
    });
    return pick;
  }

  var api = {
    isWorkingSet: isWorkingSet,
    e1rm: e1rm,
    setVolumeLb: setVolumeLb,
    workoutVolumeLb: workoutVolumeLb,
    workoutSetCount: workoutSetCount,
    finished: finished,
    sessionsFor: sessionsFor,
    checkPr: checkPr,
    prEvents: prEvents,
    personalRecords: personalRecords,
    startOfWeek: startOfWeek,
    weeklySummary: weeklySummary,
    liftTrends: liftTrends,
    lastSessionFor: lastSessionFor,
    hintFor: hintFor,
    suggestNext: suggestNext
  };

  root.PRF = root.PRF || {};
  root.PRF.metrics = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
