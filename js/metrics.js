/* PR Forge — workout math. Pure functions, no DOM, no storage.
 *
 * Workout shape:
 *   { id, name, templateId, startedAt (ISO), endedAt (ISO|null), unit: 'lb'|'kg',
 *     exercises: [{ id, exerciseId, sets: [{ id, weight, reps, done, warmup }] }] }
 * Weights are stored in the workout's own unit; everything here compares in lb.
 *
 * A "working set" is confirmed (done), not a warm-up, and has reps > 0 or seconds > 0.
 * Per-arm/per-leg sets count once (weight x reps) — volume is never doubled.
 * set.tracking: 'assisted' sets store the help as weight, so they add no volume and no 1RM;
 * 'timed' sets store seconds instead of reps. Other sets work from weight and reps. */
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
    return !!(set && set.done && !set.warmup && (num(set.reps) > 0 || num(set.seconds) > 0));
  }
  function isTimed(set) { return set.tracking === 'timed' || (num(set.seconds) > 0 && !(num(set.reps) > 0)); }

  /**
   * Estimated one-rep max (Epley). 1 rep = the weight itself.
   * Reps above E1RM_MAX_REPS count as that many: the formula overrates long sets
   * (uncapped, 135 x 20 would equal 205 x 3), so light high-rep work can't pose as a strength gain.
   * Volume and rep records still use the real reps.
   */
  var E1RM_MAX_REPS = 12;
  function e1rm(weightLb, reps) {
    var w = num(weightLb), r = Math.min(num(reps), E1RM_MAX_REPS);
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }

  function setVolumeLb(set, unit) {
    if (!isWorkingSet(set) || set.tracking === 'assisted') return 0;
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
    var out = { topE1rm: 0, topWeightLb: 0, topWeightReps: 0, bestE1rmSet: null, maxBwReps: 0, maxSeconds: 0, leastAssistLb: null, assistReps: 0, volumeLb: 0, sets: 0 };
    (workout.exercises || []).forEach(function (ex) {
      if (ex.exerciseId !== exerciseId) return;
      (ex.sets || []).forEach(function (s) {
        if (!isWorkingSet(s) || s.id === skipSetId) return;
        var lb = units.toLb(s.weight, workout.unit);
        var reps = num(s.reps);
        out.sets++;
        if (isTimed(s)) { out.maxSeconds = Math.max(out.maxSeconds, num(s.seconds)); return; }
        if (s.tracking === 'assisted') {
          if (out.leastAssistLb === null || lb < out.leastAssistLb || (lb === out.leastAssistLb && reps > out.assistReps)) {
            out.leastAssistLb = lb;
            out.assistReps = reps;
          }
          return;
        }
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
    if (!isWorkingSet(set) || set.tracking === 'assisted') return null;

    var history = sessionsFor(workouts, entry.exerciseId, active.id);
    if (history.length === 0) return null; // first-ever session of this lift

    var priorE1rm = 0, priorReps = 0, priorSeconds = 0;
    history.forEach(function (h) {
      if (h.topE1rm > priorE1rm) priorE1rm = h.topE1rm;
      if (h.maxBwReps > priorReps) priorReps = h.maxBwReps;
      if (h.maxSeconds > priorSeconds) priorSeconds = h.maxSeconds;
    });
    var today = summarise(active, entry.exerciseId, set.id); // other sets already done today
    priorE1rm = Math.max(priorE1rm, today.topE1rm);
    priorReps = Math.max(priorReps, today.maxBwReps);
    priorSeconds = Math.max(priorSeconds, today.maxSeconds);

    if (isTimed(set)) {
      var secs = num(set.seconds);
      return priorSeconds > 0 && secs > priorSeconds ? { type: 'seconds', seconds: secs, previous: priorSeconds } : null;
    }

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

  /**
   * Every PR event in history (one per exercise per session, never the first session).
   * Imported and edited workouts raise the bar for later sessions but never earn a PR themselves.
   */
  function prEvents(workouts) {
    var best = {}; // exerciseId -> { e1rm, reps, seconds }
    var events = [];
    finished(workouts).forEach(function (w) {
      var ids = {};
      var eligible = !w.imported && !w.edited;
      (w.exercises || []).forEach(function (ex) { ids[ex.exerciseId] = true; });
      Object.keys(ids).forEach(function (id) {
        var s = summarise(w, id);
        if (s.sets === 0) return;
        var b = best[id];
        if (b && eligible) {
          if (s.topE1rm > 0 && b.e1rm > 0 && s.topE1rm > b.e1rm + EPS_LB) {
            events.push({ workoutId: w.id, date: w.startedAt, exerciseId: id, type: 'e1rm',
              e1rmLb: s.topE1rm, weightLb: s.bestE1rmSet.weightLb, reps: s.bestE1rmSet.reps });
          } else if (s.topE1rm === 0 && s.maxBwReps > 0 && b.reps > 0 && s.maxBwReps > b.reps) {
            events.push({ workoutId: w.id, date: w.startedAt, exerciseId: id, type: 'reps', reps: s.maxBwReps });
          } else if (s.maxSeconds > 0 && b.seconds > 0 && s.maxSeconds > b.seconds) {
            events.push({ workoutId: w.id, date: w.startedAt, exerciseId: id, type: 'seconds', seconds: s.maxSeconds });
          }
        }
        if (!b) b = best[id] = { e1rm: 0, reps: 0, seconds: 0 };
        b.e1rm = Math.max(b.e1rm, s.topE1rm);
        b.reps = Math.max(b.reps, s.maxBwReps);
        b.seconds = Math.max(b.seconds, s.maxSeconds);
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
          bestE1rm: null, heaviest: null, maxBwReps: null, maxSeconds: null, leastAssist: null });
        r.sessions++;
        r.lastDate = w.startedAt;
        if (s.topE1rm > 0 && (!r.bestE1rm || s.topE1rm > r.bestE1rm.e1rmLb + EPS_LB)) {
          r.bestE1rm = { e1rmLb: s.topE1rm, weightLb: s.bestE1rmSet.weightLb, reps: s.bestE1rmSet.reps, date: w.startedAt, imported: !!w.imported };
        }
        if (s.topWeightLb > 0 && (!r.heaviest || s.topWeightLb > r.heaviest.weightLb + EPS_LB)) {
          r.heaviest = { weightLb: s.topWeightLb, reps: s.topWeightReps, date: w.startedAt, imported: !!w.imported };
        }
        if (s.maxBwReps > 0 && (!r.maxBwReps || s.maxBwReps > r.maxBwReps.reps)) {
          r.maxBwReps = { reps: s.maxBwReps, date: w.startedAt };
        }
        if (s.maxSeconds > 0 && (!r.maxSeconds || s.maxSeconds > r.maxSeconds.seconds)) {
          r.maxSeconds = { seconds: s.maxSeconds, date: w.startedAt };
        }
        if (s.leastAssistLb !== null && (!r.leastAssist || s.leastAssistLb < r.leastAssist.weightLb)) {
          r.leastAssist = { weightLb: s.leastAssistLb, reps: s.assistReps, date: w.startedAt };
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

  /** Last `weeks` calendar weeks of volume, oldest first; the final one is this week. */
  function weeklySeries(workouts, now, weeks) {
    var count = weeks || 8;
    var thisWeek = startOfWeek(now || new Date());
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var start = addDays(thisWeek, -7 * i);
      out.push({ weekStart: start.toISOString(), start: start, end: addDays(start, 7), volumeLb: 0, count: 0 });
    }
    finished(workouts).forEach(function (w) {
      var t = new Date(w.startedAt);
      out.forEach(function (o) {
        if (t >= o.start && t < o.end) { o.volumeLb += workoutVolumeLb(w); o.count++; }
      });
    });
    return out.map(function (o) { return { weekStart: o.weekStart, volumeLb: o.volumeLb, count: o.count }; });
  }

  /** Workouts this week, and the average per week over the four weeks before it. */
  function workoutFrequency(workouts, now) {
    var series = weeklySeries(workouts, now, 5);
    var prior = series.slice(0, 4).reduce(function (a, o) { return a + o.count; }, 0);
    return { thisWeek: series[4].count, priorAverage: prior / 4 };
  }

  var METRICS = {
    e1rm: function (s) { return s.topE1rm; },
    reps: function (s) { return s.maxBwReps; },
    seconds: function (s) { return s.maxSeconds; }
  };

  /**
   * Per-lift trend, explained in plain words. Judged on the last 90 days of sessions (`best` is the best
   * in that window; `allTimeBest` the best ever). Based on each session's best estimated 1RM, or
   * best reps / longest hold for lifts without weight. Assisted lifts have no trend, because
   * less help and more reps can't be compared. Lifts trained in the last `windowDays` (default 56) only.
   * status: 'building' (<3 sessions) | 'paused' (no session in 14+ days)
   *         | 'down' (last two sessions over 5% under the best of the six weeks before them)
   *         | 'progressing' (new best within the last 3 sessions)
   *         | 'holding' (3–4 sessions since best) | 'stalled' (5+ sessions since best)
   */
  var RECENT_DAYS = 90; // a trend compares sessions within this window; older bests stay in Records
  function liftTrends(workouts, now, windowDays) {
    var at = now || new Date();
    var cutoff = new Date(at.getTime() - (windowDays || 56) * DAY_MS);
    var recentStart = new Date(at.getTime() - RECENT_DAYS * DAY_MS);
    var ids = {};
    finished(workouts).forEach(function (w) {
      (w.exercises || []).forEach(function (ex) { ids[ex.exerciseId] = true; });
    });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var all = sessionsFor(workouts, id);
      if (all.length === 0) return;
      var newest = all[all.length - 1];
      var metric = newest.topE1rm > 0 ? 'e1rm' : newest.maxSeconds > 0 ? 'seconds' : newest.maxBwReps > 0 ? 'reps' : null;
      if (!metric) return;
      var value = METRICS[metric];
      var eps = metric === 'e1rm' ? EPS_LB : 0;
      var history = all.filter(function (s) { return value(s) > 0; });
      var last = history[history.length - 1];
      if (new Date(last.date) < cutoff) return;
      var allTimeBest = 0;
      history.forEach(function (s) { allTimeBest = Math.max(allTimeBest, value(s)); });
      // Judge the trend on the last 90 days only. Measured against an all-time best from before a break,
      // a lifter climbing back every week would read as "Stalled" for months.
      var sessions = history.filter(function (s) { return new Date(s.date) >= recentStart; });
      if (!sessions.length) sessions = [last];

      var best = 0, bestIdx = 0;
      sessions.forEach(function (s, i) {
        if (value(s) > best + eps) { best = value(s); bestIdx = i; }
      });
      var n = sessions.length;
      var since = n - 1 - bestIdx;
      var idle = Math.floor((at - new Date(last.date)) / DAY_MS);
      var lastTwo = sessions.slice(-2);
      var windowStart = new Date(new Date(lastTwo[0].date).getTime() - 42 * DAY_MS);
      var priorBest = 0;
      sessions.slice(0, -2).forEach(function (s) {
        if (new Date(s.date) >= windowStart) priorBest = Math.max(priorBest, value(s));
      });
      var bothDown = priorBest > 0 && lastTwo.every(function (s) { return value(s) < priorBest * 0.95; });
      var status, text;
      if (n < 3) {
        status = 'building';
        text = 'Log ' + (3 - n) + ' more session' + (3 - n === 1 ? '' : 's') + ' to see a trend';
      } else if (idle >= 14) {
        status = 'paused';
        text = 'No session in ' + idle + ' days';
      } else if (bothDown) {
        status = 'down';
        text = 'Last 2 sessions under your recent best';
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
        exerciseId: id, status: status, text: text, sessions: n, totalSessions: history.length, metric: metric,
        best: best, allTimeBest: allTimeBest,
        bestE1rmLb: metric === 'e1rm' ? best : 0, lastE1rmLb: last.topE1rm, lastDate: last.date,
        spark: sessions.slice(-8).map(value),
        points: history.map(function (s) {
          return { date: s.date, workoutId: s.workoutId, value: value(s), set: s.bestE1rmSet };
        })
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
          if (s.done && (num(s.reps) > 0 || num(s.seconds) > 0)) sets.push({ weight: num(s.weight), reps: num(s.reps), seconds: num(s.seconds), warmup: !!s.warmup });
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
    var hint = { weight: weight, reps: s.reps };
    if (s.seconds > 0) hint.seconds = s.seconds;
    return hint;
  }

  var PROGRESSION_STEP = { lb: 5, kg: 2.5 };
  /**
   * Double progression. When every working set last time reached the top of the rep target
   * at one weight, suggest the next step (+5 lb / +2.5 kg; for assisted lifts, that much less help)
   * at the bottom of the range. Otherwise null, and last time's numbers stay the hint.
   * Returns { weight, reps, from } in targetUnit.
   */
  function progressionFor(last, target, targetUnit, kind) {
    if (!last || !target || !(num(target.max) > 0)) return null;
    if (kind !== 'weight' && kind !== 'weighted' && kind !== 'assisted') return null;
    var work = last.sets.filter(function (s) { return !s.warmup && num(s.reps) > 0; });
    if (!work.length) return null;
    var w0 = num(work[0].weight);
    if (!work.every(function (s) { return Math.abs(num(s.weight) - w0) < 0.01 && num(s.reps) >= target.max; })) return null;
    var from = units.roundForEntry(units.convert(w0, last.unit, targetUnit));
    var step = PROGRESSION_STEP[targetUnit] || 5;
    if (kind === 'weight' && !(from > 0)) return null;
    if (kind === 'assisted' && !(from > 0)) return null;
    return { weight: kind === 'assisted' ? Math.max(0, from - step) : from + step, reps: target.min, from: from };
  }

  /**
   * Hint for a set, taking today's earlier sets into account.
   * `today` lists this exercise's earlier confirmed sets of the same kind in this workout
   * ({ weight, reps, seconds }, in targetUnit). If you changed the weight from last session's
   * plan on an earlier set today, later sets follow your change instead of last session's number;
   * with no last session to go on, the previous set today is the hint.
   */
  function hintForSet(last, index, targetUnit, warmup, today, plan) {
    var usePlan = plan && !warmup && last;
    var at = function (i) { return usePlan ? { weight: plan.weight, reps: plan.reps } : hintFor(last, i, targetUnit, warmup); };
    var base = at(index);
    var prev = today && today.length ? today[today.length - 1] : null;
    if (!prev) return base;
    if (!base) {
      var h = { weight: num(prev.weight), reps: num(prev.reps) };
      if (num(prev.seconds) > 0) h.seconds = num(prev.seconds);
      return h;
    }
    var planned = at(today.length - 1);
    if (planned && num(prev.weight) > 0 && Math.abs(num(prev.weight) - planned.weight) > 0.01) {
      base = { weight: num(prev.weight), reps: base.reps, seconds: base.seconds };
      if (base.seconds === undefined) delete base.seconds;
    }
    return base;
  }

  /**
   * Strength total: the sum of each lift's best estimated 1RM over the last `days` (default 56),
   * with the same sum for the `days` before that and each lift's all-time best, for the lifts in `ids`.
   * Lifts without a weighted session in the current window are left out of every sum, so a missing
   * lift can't make the total look like it dropped. Returns null when fewer than 2 lifts qualify.
   */
  function strengthTotal(workouts, ids, now, days) {
    var at = (now || new Date()).getTime();
    var span = (days || 56) * DAY_MS;
    var lifts = [];
    (ids || []).forEach(function (id) {
      var cur = 0, prior = 0, best = 0;
      sessionsFor(workouts, id).forEach(function (s) {
        if (!(s.topE1rm > 0)) return;
        var t = new Date(s.date).getTime();
        best = Math.max(best, s.topE1rm);
        if (t > at - span && t <= at) cur = Math.max(cur, s.topE1rm);
        else if (t > at - 2 * span && t <= at - span) prior = Math.max(prior, s.topE1rm);
      });
      if (cur > 0) lifts.push({ exerciseId: id, currentLb: cur, priorLb: prior, allTimeLb: best });
    });
    if (lifts.length < 2) return null;
    var total = 0, allTime = 0, withPrior = 0, nowOfThose = 0, priorTotal = 0;
    lifts.forEach(function (l) {
      total += l.currentLb; allTime += l.allTimeLb;
      if (l.priorLb > 0) { withPrior++; nowOfThose += l.currentLb; priorTotal += l.priorLb; }
    });
    return {
      totalLb: total, lifts: lifts,
      changeLb: withPrior === lifts.length ? nowOfThose - priorTotal : null, // only when every lift can be compared
      pctOfBest: allTime > 0 ? Math.round((total / allTime) * 100) : null
    };
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
    weeklySeries: weeklySeries,
    workoutFrequency: workoutFrequency,
    lastSessionFor: lastSessionFor,
    hintFor: hintFor,
    hintForSet: hintForSet, progressionFor: progressionFor,
    strengthTotal: strengthTotal,
    E1RM_MAX_REPS: E1RM_MAX_REPS,
    suggestNext: suggestNext
  };

  root.PRF = root.PRF || {};
  root.PRF.metrics = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
