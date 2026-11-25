// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const units = require('../js/units.js');
const m = require('../js/metrics.js');
const store = require('../js/store.js');
const ex = require('../js/exercises.js');
const plates = require('../js/plates.js');
const importers = require('../js/importers.js');

let n = 0;
const id = () => 'id' + (++n);
function workout(dateStr, unit, entries, extra) {
  return Object.assign({
    id: id(), name: 'W', templateId: null,
    startedAt: new Date(dateStr).toISOString(),
    endedAt: new Date(new Date(dateStr).getTime() + 3600e3).toISOString(),
    unit,
    exercises: entries.map(([exerciseId, sets]) => ({
      id: id(), exerciseId,
      sets: sets.map(([weight, reps, opts]) => Object.assign({ id: id(), weight, reps, done: true, warmup: false }, opts || {}))
    }))
  }, extra || {});
}

test('exercise library: 800+ rows, unique IDs, valid fields, curated IDs kept', () => {
  assert.ok(ex.BUILT_IN.length >= 800);
  const ids = new Set(ex.BUILT_IN.map((e) => e.id));
  assert.equal(ids.size, ex.BUILT_IN.length);
  const names = new Set(ex.BUILT_IN.map((e) => e.name.toLowerCase()));
  assert.equal(names.size, ex.BUILT_IN.length);
  const muscles = new Set(ex.MUSCLES.concat(['Other']));
  ex.BUILT_IN.forEach((e) => {
    assert.ok(muscles.has(e.muscle), e.id + ' muscle ' + e.muscle);
    assert.ok(ex.EQUIPMENT.includes(e.equipment), e.id + ' equipment ' + e.equipment);
    assert.ok(['', 'arm', 'leg'].includes(e.side), e.id + ' side ' + e.side);
  });
  // Saved workouts refer to these IDs, so they must never change.
  ['bench-press', 'deadlift', 'back-squat', 'db-row', 'bulgarian-split-squat', 'push-up', 'plank', 'thruster']
    .forEach((id) => assert.ok(ids.has(id), id));
  // A merged movement appears once, under its curated ID, and is findable by its source name.
  assert.ok(!ids.has('fedb:Barbell_Deadlift'));
  assert.equal(ex.BUILT_IN.find((e) => e.id === 'pec-deck').alias, 'Butterfly');
});

test('exercise library: one-sided lifts are labelled and volume still counts once', () => {
  const byName = (n) => ex.BUILT_IN.find((e) => e.name === n);
  assert.equal(byName('One-Arm Kettlebell Row').side, 'arm');
  assert.equal(byName('Single-Leg Leg Extension').side, 'leg');
  assert.equal(byName('Barbell Walking Lunge').side, 'leg');
  assert.equal(byName('Split Squats').side, 'leg');
  assert.equal(byName('Reverse Barbell Curl').side, '');
  assert.equal(byName('Seated Close-Grip Concentration Barbell Curl').side, '');
  const w = workout('2026-10-01T10:00:00', 'lb', [['fedb:One-Arm_Kettlebell_Row', [[50, 10]]]]);
  assert.equal(m.workoutVolumeLb(w), 500);
});

test('units convert and format', () => {
  assert.equal(units.fmtNum(100), '100');
  assert.equal(units.fmtNum(102.25), '102.3');
  assert.ok(Math.abs(units.toLb(100, 'kg') - 220.462) < 0.01);
  assert.equal(units.convert(225, 'lb', 'lb'), 225);
  assert.equal(units.roundForEntry(units.convert(100, 'kg', 'lb')), 220.5);
  assert.equal(units.fmtVolumeLb(12345.4, 'lb'), '12,345 lb');
});

test('e1rm: 1 rep is the weight; Epley otherwise; zero for no weight', () => {
  assert.equal(m.e1rm(200, 1), 200);
  assert.ok(Math.abs(m.e1rm(200, 5) - 233.33) < 0.01);
  assert.equal(m.e1rm(0, 10), 0);
});

test('volume ignores warm-ups, unconfirmed sets, and does not double per-arm sets', () => {
  const w = workout('2026-10-05T10:00', 'lb', [
    ['db-row', [[50, 10], [50, 10], [20, 10, { warmup: true }], [60, 8, { done: false }]]]
  ]);
  assert.equal(m.workoutVolumeLb(w), 1000);
  assert.equal(m.workoutSetCount(w), 2);
});

test('mixed-unit volume sums in lb', () => {
  const a = workout('2026-10-05T10:00', 'kg', [['back-squat', [[100, 5]]]]);
  assert.ok(Math.abs(m.workoutVolumeLb(a) - 1102.31) < 0.05);
});

test('no PR on first-ever session of a lift', () => {
  const active = workout('2026-10-10T10:00', 'lb', [['bench-press', [[225, 5]]]], { endedAt: null });
  const e = active.exercises[0];
  assert.equal(m.checkPr([], active, e.id, e.sets[0].id), null);
});

test('PR across units: 100 kg x1 beats an earlier 220 lb x1', () => {
  const past = workout('2026-10-01T10:00', 'lb', [['bench-press', [[220, 1]]]]);
  const active = workout('2026-10-08T10:00', 'kg', [['bench-press', [[100, 1]]]], { endedAt: null });
  const e = active.exercises[0];
  const pr = m.checkPr([past], active, e.id, e.sets[0].id);
  assert.ok(pr && pr.type === 'e1rm');
});

test('no PR for warm-ups or equal performance; second set must beat the first', () => {
  const past = workout('2026-10-01T10:00', 'lb', [['bench-press', [[200, 5]]]]);
  const active = workout('2026-10-08T10:00', 'lb', [['bench-press', [[205, 5], [205, 5], [300, 5, { warmup: true }], [200, 5]]]], { endedAt: null });
  const e = active.exercises[0];
  // set 1 alone would be a PR, but set 2 is compared against set 1 (already done)
  assert.equal(m.checkPr([past], active, e.id, e.sets[1].id), null);
  assert.equal(m.checkPr([past], active, e.id, e.sets[2].id), null);
  assert.equal(m.checkPr([past], active, e.id, e.sets[3].id), null);
  const onlyFirst = workout('2026-10-08T10:00', 'lb', [['bench-press', [[205, 5]]]], { endedAt: null });
  const e2 = onlyFirst.exercises[0];
  assert.ok(m.checkPr([past], onlyFirst, e2.id, e2.sets[0].id));
});

test('body-weight rep PR', () => {
  const past = workout('2026-10-01T10:00', 'lb', [['pull-up', [[0, 8]]]]);
  const active = workout('2026-10-08T10:00', 'lb', [['pull-up', [[0, 10]]]], { endedAt: null });
  const e = active.exercises[0];
  const pr = m.checkPr([past], active, e.id, e.sets[0].id);
  assert.deepEqual(pr, { type: 'reps', reps: 10, previous: 8 });
});

test('weekly summary never shows -100% and handles empty weeks', () => {
  const now = new Date('2026-10-14T12:00'); // Wednesday
  const last = workout('2026-10-06T10:00', 'lb', [['back-squat', [[200, 5]]]]);
  let s = m.weeklySummary([last], now);
  assert.equal(s.status, 'none');
  assert.equal(s.pct, null);
  const tiny = workout('2026-10-13T10:00', 'lb', [['back-squat', [[1, 1]]]]);
  s = m.weeklySummary([last, tiny], now);
  assert.equal(s.status, 'down');
  assert.ok(s.pct > -100);
  assert.equal(s.days[1], true); // Tuesday
  s = m.weeklySummary([tiny], now);
  assert.equal(s.status, 'new');
  assert.equal(s.pct, null);
});

test('lift trend statuses', () => {
  const ws = [];
  const tops = [200, 210, 220, 215, 215, 215, 215, 215];
  tops.forEach((w, i) => ws.push(workout(new Date(2026, 9, 1 + i * 3, 10).toISOString(), 'lb', [['deadlift', [[w, 1]]]])));
  const now = new Date(2026, 9, 26);
  let t = m.liftTrends(ws, now)[0];
  assert.equal(t.status, 'stalled');
  assert.equal(t.text, 'No new best in 5 sessions');
  t = m.liftTrends(ws.slice(0, 3), new Date(2026, 9, 10))[0];
  assert.equal(t.status, 'progressing');
  t = m.liftTrends(ws.slice(0, 2), now)[0];
  assert.equal(t.status, 'building');
  assert.equal(m.liftTrends(ws, new Date(2027, 5, 1)).length, 0); // nothing recent
});

test('lift trends: paused after 14 quiet days, down when the last two sessions drop over 5%', () => {
  const session = (day, w) => workout(new Date(2026, 9, day, 10).toISOString(), 'lb', [['deadlift', [[w, 1]]]]);
  const steady = [session(1, 200), session(4, 210), session(7, 220)];
  const paused = m.liftTrends(steady, new Date(2026, 9, 25))[0];
  assert.equal(paused.status, 'paused');
  assert.equal(paused.text, 'No session in 17 days');
  const dropping = steady.concat([session(10, 200), session(13, 195)]);
  assert.equal(m.liftTrends(dropping, new Date(2026, 9, 15))[0].status, 'down');
  const smallDip = steady.concat([session(10, 215), session(13, 212)]);
  assert.notEqual(m.liftTrends(smallDip, new Date(2026, 9, 15))[0].status, 'down');
});

test('lift trends cover reps and timed holds; assisted lifts have none', () => {
  const day = (d) => new Date(2026, 9, d, 10).toISOString();
  const now = new Date(2026, 9, 12);
  const hold = (d, s) => workout(day(d), 'lb', [['plank', [[0, null, { seconds: s, tracking: 'timed' }]]]]);
  const t = m.liftTrends([hold(1, 40), hold(4, 45), hold(7, 60)], now)[0];
  assert.equal(t.metric, 'seconds');
  assert.equal(t.best, 60);
  assert.equal(t.status, 'progressing');
  const pull = (d, r) => workout(day(d), 'lb', [['pull-up', [[0, r]]]]);
  assert.equal(m.liftTrends([pull(1, 8), pull(4, 9), pull(7, 10)], now)[0].metric, 'reps');
  const helped = workout(day(1), 'lb', [['pull-up', [[40, 8, { tracking: 'assisted' }]]]]);
  assert.equal(m.liftTrends([helped], now).length, 0);
});

test('exercise types: assisted adds no volume or 1RM, timed sets count and can PR', () => {
  const helped = workout('2026-10-01T10:00', 'lb', [['pull-up', [[40, 8, { tracking: 'assisted' }]]]]);
  assert.equal(m.workoutVolumeLb(helped), 0);
  assert.equal(m.workoutSetCount(helped), 1);
  const rec = m.personalRecords([helped])[0];
  assert.equal(rec.bestE1rm, null);
  assert.equal(rec.leastAssist.weightLb, 40);
  const active = workout('2026-10-08T10:00', 'lb', [['pull-up', [[20, 8, { tracking: 'assisted' }]]]], { endedAt: null });
  assert.equal(m.checkPr([helped], active, active.exercises[0].id, active.exercises[0].sets[0].id), null);

  const hold = workout('2026-10-01T10:00', 'lb', [['plank', [[0, null, { seconds: 45, tracking: 'timed' }]]]]);
  assert.equal(m.workoutVolumeLb(hold), 0);
  assert.equal(m.workoutSetCount(hold), 1);
  const longer = workout('2026-10-08T10:00', 'lb', [['plank', [[0, null, { seconds: 60, tracking: 'timed' }]]]], { endedAt: null });
  const e = longer.exercises[0];
  assert.deepEqual(m.checkPr([hold], longer, e.id, e.sets[0].id), { type: 'seconds', seconds: 60, previous: 45 });
  assert.deepEqual(m.hintFor(m.lastSessionFor([hold], 'plank'), 0, 'lb'), { weight: 0, reps: 0, seconds: 45 });
  assert.equal(m.checkPr([], longer, e.id, e.sets[0].id), null); // never on a first session
});

test('no PR badge on imported or edited workouts, but they still raise the bar', () => {
  const base = workout('2026-10-01T10:00', 'lb', [['bench-press', [[200, 5]]]]);
  const edited = workout('2026-10-04T10:00', 'lb', [['bench-press', [[250, 5]]]], { edited: true });
  const imported = workout('2026-10-07T10:00', 'lb', [['bench-press', [[260, 5]]]], { imported: true });
  assert.equal(m.prEvents([base, edited, imported]).length, 0);
  const later = workout('2026-10-10T10:00', 'lb', [['bench-press', [[255, 5]]]]);
  assert.equal(m.prEvents([base, edited, imported, later]).length, 0); // 260 is still the best
  const beat = workout('2026-10-13T10:00', 'lb', [['bench-press', [[265, 5]]]]);
  assert.equal(m.prEvents([base, edited, imported, later, beat]).length, 1);
  assert.equal(m.personalRecords([base, imported])[0].heaviest.weightLb, 260);
});

test('weekly series and training frequency', () => {
  const now = new Date(2026, 9, 14, 12); // Wednesday
  const a = workout(new Date(2026, 9, 13, 10).toISOString(), 'lb', [['deadlift', [[100, 10]]]]);
  const b = workout(new Date(2026, 9, 6, 10).toISOString(), 'lb', [['deadlift', [[100, 5]]]]);
  const series = m.weeklySeries([a, b], now, 8);
  assert.equal(series.length, 8);
  assert.equal(series[7].volumeLb, 1000);
  assert.equal(series[6].volumeLb, 500);
  assert.equal(series[0].count, 0);
  const f = m.workoutFrequency([a, b], now);
  assert.equal(f.thisWeek, 1);
  assert.equal(f.priorAverage, 0.25);
});

test('plate calculator', () => {
  const { calculate, PLATES } = plates;
  assert.deepEqual(calculate(205, 45, PLATES.lb).perSide, [45, 35]);
  assert.deepEqual(calculate(45, 45, PLATES.lb).perSide, []);
  assert.equal(calculate(45, 45, PLATES.lb).exact, true);
  assert.deepEqual(calculate(135, 45, PLATES.lb).perSide, [45]);
  assert.deepEqual(calculate(125, 45, PLATES.lb).perSide, [35, 5]); // fewest plates
  assert.deepEqual(calculate(100, 20, PLATES.kg).perSide, [25, 15]);
  assert.deepEqual(calculate(21.25, 20, PLATES.kg).exact, false);
  const near = calculate(137, 45, PLATES.lb);
  assert.equal(near.exact, false);
  assert.equal(near.below, 135);
  assert.equal(near.above, 140);
  assert.deepEqual(near.belowPlates, [45]);
  assert.deepEqual(near.abovePlates, [45, 2.5]);
  assert.equal(calculate(30, 45, PLATES.lb).lessThanBar, true);
  assert.equal(calculate(null, 45, PLATES.lb), null);
  assert.equal(calculate(0, 45, PLATES.lb), null);
});

const FITBOD = [
  'Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier',
  '2026-03-01 18:00:00 -0700,Barbell Bench Press,10,20.0,0.0,0.0,0.0,0.0,true,,1.0',
  '2026-03-01 18:05:00 -0700,Barbell Bench Press,5,102.058,0.0,0.0,0.0,0.0,false,"Felt good, solid",1.0',
  '2026-03-01 18:30:00 -0700,Plank,0,0.0,45.0,0.0,0.0,0.0,false,,1.0',
  '2026-03-01 18:35:00 -0700,Pull Up,8,0.0,0.0,0.0,0.0,0.0,false,,1.0',
  '2026-03-01 18:40:00 -0700,Machine Leg Press,10,100.0,0.0,0.0,0.0,0.0,false,,1.0',
  '2026-03-01 18:50:00 -0700,Rowing,0,0.0,0.0,500.0,0.0,0.0,false,,1.0',
  '2026-03-04 18:00:00 -0700,Zottman Twist Thing,10,10.0,0.0,0.0,0.0,0.0,false,,1.0',
  'not a date,Back Squat,5,100.0,0.0,0.0,0.0,0.0,false,,1.0'
].join('\r\n');

test('csv parser handles quotes, commas and blank lines', () => {
  assert.deepEqual(importers.parseCsv('﻿a,"b,c"\r\n\r\n"d ""e""",f\n'), [['a', 'b,c'], ['d "e"', 'f']]);
});

test('fitbod import: groups by day, converts units, maps names, skips bad rows', () => {
  let n = 0;
  const opts = { exercises: ex.BUILT_IN, targetUnit: 'lb', uid: () => 'u' + (++n), batchId: 'B' };
  const out = importers.parseFitbod(FITBOD, opts);
  assert.equal(out.stats.workouts, 2);
  assert.equal(out.stats.sets, 6);
  assert.equal(out.stats.skipped, 2); // distance-only row and bad date
  assert.deepEqual(out.stats.created, ['Zottman Twist Thing']);
  const day = out.workouts[0];
  assert.ok(day.imported);
  assert.equal(day.importBatch, 'B');
  assert.equal(day.sourceKey, 'fitbod:2026-03-01');
  assert.equal(day.startedAt, '2026-03-02T01:00:00.000Z');
  assert.deepEqual(day.exercises.map((e) => e.exerciseId), ['bench-press', 'plank', 'pull-up', 'leg-press']);
  const bench = day.exercises[0].sets;
  assert.equal(bench[0].warmup, true);
  assert.equal(bench[1].weight, 225);
  assert.equal(day.exercises[1].sets[0].seconds, 45);
  assert.equal(day.exercises[1].tracking, 'timed');
  assert.equal(day.exercises[2].tracking, 'bodyweight');
  assert.equal(m.workoutVolumeLb(day), bench[1].weight * 5 + day.exercises[3].sets[0].weight * 10);
  assert.equal(m.prEvents(out.workouts).length, 0);
  assert.equal(out.customs[0].importBatch, 'B');
});

test('fitbod import: re-importing skips days already there, and foreign files are refused', () => {
  let n = 0;
  const opts = { exercises: ex.BUILT_IN, targetUnit: 'kg', uid: () => 'u' + (++n), batchId: 'B', existingKeys: { 'fitbod:2026-03-01': true } };
  const out = importers.parseFitbod(FITBOD, opts);
  assert.equal(out.stats.workouts, 1);
  assert.equal(out.stats.duplicateDays, 1);
  assert.throws(() => importers.parseFitbod('name,value\na,1', opts), /doesn’t look like a Fitbod export/);
  assert.throws(() => importers.parseFitbod('', opts), /empty/);
});

test('store keeps types, edits, imports and settings through a backup; old data still loads', () => {
  const s = store.defaults();
  s.settings.barLb = 35;
  s.settings.exerciseTypes = { 'pull-up': 'assisted', bad: 'nonsense' };
  s.imports = [{ id: 'B', source: 'Fitbod', at: '2026-11-01', workouts: 1 }];
  const wk = workout('2026-10-01T10:00', 'lb', [['plank', [[0, null, { seconds: 45, tracking: 'timed' }]]]], { imported: true, importBatch: 'B', sourceKey: 'fitbod:2026-10-01', edited: true });
  wk.exercises[0].tracking = 'timed';
  s.workouts.push(wk);
  const back = store.parseBackup(store.exportBackup(s));
  const w2 = back.workouts[0];
  assert.equal(w2.imported, true);
  assert.equal(w2.edited, true);
  assert.equal(w2.importBatch, 'B');
  assert.equal(w2.sourceKey, 'fitbod:2026-10-01');
  assert.equal(w2.exercises[0].tracking, 'timed');
  assert.equal(w2.exercises[0].sets[0].seconds, 45);
  assert.equal(back.settings.barLb, 35);
  assert.deepEqual(back.settings.exerciseTypes, { 'pull-up': 'assisted' });
  assert.equal(back.imports.length, 1);
  assert.equal(back.settings.setupDone, true);

  const old = store.normalise({ settings: { unit: 'kg', restSeconds: 60 }, workouts: [], templates: [{ id: 't', name: 'A', exercises: [] }] });
  assert.equal(old.settings.barKg, 20);
  assert.equal(old.settings.setupDone, true); // already had data
  assert.equal(store.normalise({ workouts: [] }).settings.setupDone, false);
});

test('built-in logging types', () => {
  const byId = (id) => ex.BUILT_IN.find((e) => e.id === id);
  assert.equal(ex.defaultTracking(byId('plank')), 'timed');
  assert.equal(ex.defaultTracking(byId('pull-up')), 'bodyweight');
  assert.equal(ex.defaultTracking(byId('bench-press')), 'weight');
  assert.equal(ex.defaultTracking(byId('fedb:Band_Assisted_Pull-Up')), 'assisted');
  assert.equal(ex.defaultTracking(byId('fedb:Chin_To_Chest_Stretch')), 'timed');
});

test('ghost hints come from the last session, converted to the active unit', () => {
  const past = workout('2026-10-01T10:00', 'kg', [['back-squat', [[100, 5], [100, 4]]]]);
  const last = m.lastSessionFor([past], 'back-squat');
  assert.deepEqual(m.hintFor(last, 0, 'lb'), { weight: 220.5, reps: 5 });
  assert.deepEqual(m.hintFor(last, 5, 'kg'), { weight: 100, reps: 4 });
  assert.equal(m.lastSessionFor([past], 'bench-press'), null);
  const withWarm = workout('2026-10-02T10:00', 'lb', [['bench-press', [[95, 10, { warmup: true }], [195, 5], [195, 4]]]]);
  const lw = m.lastSessionFor([withWarm], 'bench-press');
  assert.deepEqual(m.hintFor(lw, 0, 'lb', false), { weight: 195, reps: 5 });
  assert.deepEqual(m.hintFor(lw, 0, 'lb', true), { weight: 95, reps: 10 });
});

test('suggestNext picks never-done, then least recent', () => {
  const tA = { id: 'A', name: 'A', exercises: [] }, tB = { id: 'B', name: 'B', exercises: [] };
  const wA = workout('2026-10-01T10:00', 'lb', [], { templateId: 'A' });
  assert.equal(m.suggestNext([tA, tB], [wA]).template.id, 'B');
  const wB = workout('2026-10-03T10:00', 'lb', [], { templateId: 'B' });
  assert.equal(m.suggestNext([tA, tB], [wA, wB]).template.id, 'A');
});

test('prEvents and personalRecords', () => {
  const ws = [
    workout('2026-10-01T10:00', 'lb', [['bench-press', [[200, 5]]]]),
    workout('2026-10-04T10:00', 'lb', [['bench-press', [[210, 5]]]]),
    workout('2026-10-07T10:00', 'lb', [['bench-press', [[205, 5]]]])
  ];
  const ev = m.prEvents(ws);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].weightLb, 210);
  const pr = m.personalRecords(ws)[0];
  assert.equal(pr.heaviest.weightLb, 210);
  assert.equal(pr.sessions, 3);
});

test('store: round trip, rejects foreign files, survives corrupt storage', () => {
  const mem = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } };
  const s = store.defaults();
  s.workouts.push(workout('2026-10-01T10:00', 'kg', [['bench-press', [[100, 5]]]]));
  s.settings.unit = 'kg';
  assert.ok(store.save(s, mem));
  const back = store.load(mem);
  assert.equal(back.workouts.length, 1);
  assert.equal(back.settings.unit, 'kg');

  const restored = store.parseBackup(store.exportBackup(s));
  assert.equal(restored.workouts[0].exercises[0].sets[0].weight, 100);
  assert.throws(() => store.parseBackup('{"hello":1}'), /not a PR Forge backup/);
  assert.throws(() => store.parseBackup('nope'), /not valid JSON/);

  mem.data[store.KEY] = '{broken';
  const fresh = store.load(mem);
  assert.equal(fresh.workouts.length, 0);
  assert.ok(Object.keys(mem.data).some(k => k.includes(':unreadable:')));
});

test('pasted workout plan: Claude-style list, abbreviations, tables, several days', () => {
  const text = [
    '# Upper Body Workout', '', "Here's a solid session:", '**Warm-up:** 5 minutes rowing, arm circles', '',
    '1. **Barbell Bench Press** — 4 sets x 6-8 reps', '2. Bent-Over Barbell Rows: 4 x 8', '3. DB Lateral Raises 3x12-15',
    '4. Pull-ups 3 x AMRAP', '5. Tricep Rope Pushdowns 3 × 12', '6. Dumbbell Bicep Curls - 3 sets, 10-12 reps', '7. Zercher Wiggle 2x5',
    'Rest 60–90 seconds between sets.', '',
    'Day 2: Lower', '| Exercise | Sets | Reps |', '|---|---|---|', '| Back Squat | 5 | 5 |', '| Romanian Deadlift | 3 | 8 |'
  ].join('\n');
  const r = importers.parseWorkoutText(text, { exercises: ex.BUILT_IN });
  assert.equal(r.workouts.length, 2);
  const [up, low] = r.workouts;
  assert.equal(up.name, 'Upper Body Workout');
  assert.deepEqual(up.exercises.map((e) => [e.exerciseId, e.sets, e.reps]), [
    ['bench-press', 4, '6-8'], ['barbell-row', 4, '8'], ['lateral-raise', 3, '12-15'], ['pull-up', 3, 'AMRAP'],
    ['rope-pushdown', 3, '12'], ['db-curl', 3, '10-12'], [null, 2, '5']
  ]);
  assert.equal(up.exercises[6].name, 'Zercher Wiggle'); // unknown: kept by name, becomes a custom exercise
  assert.equal(low.name, 'Lower');
  assert.deepEqual(low.exercises.map((e) => [e.exerciseId, e.sets]), [['back-squat', 5], ['romanian-deadlift', 3]]);
  assert.equal(r.skipped.length, 2); // warm-up note and rest note
});

test('pasted workout plan: bare names get 3 sets, sets are clamped, nothing usable gives no workouts', () => {
  const r = importers.parseWorkoutText('Push\nBench Press\nDips 40x10\n', { exercises: ex.BUILT_IN });
  assert.equal(r.workouts[0].name, 'Push');
  assert.deepEqual(r.workouts[0].exercises.map((e) => [e.exerciseId, e.sets]), [['bench-press', 3], ['dip', 20]]);
  assert.equal(importers.parseWorkoutText('Just stretch and rest today.', { exercises: ex.BUILT_IN }).workouts.length, 0);
});

test('workout files: PDF text items rebuild lines and table columns; CSV becomes table rows', () => {
  const it = (s, x, y, w) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });
  const text = importers.pdfItemsToText([
    it('Upper', 50, 700, 30), it('Body', 83, 700, 25),
    it('Bench Press', 50, 680, 60), it('4', 200, 680, 5), it('8', 260, 680, 5),
    it('Pull-ups', 50, 660, 40), it('3', 200, 661, 5), it('AMRAP', 260, 660, 30)
  ]);
  assert.equal(text, 'Upper Body\nBench Press | 4 | 8\nPull-ups | 3 | AMRAP');
  const plan = importers.parseWorkoutText(text, { exercises: ex.BUILT_IN });
  assert.equal(plan.workouts[0].name, 'Upper Body');
  assert.deepEqual(plan.workouts[0].exercises.map((e) => [e.exerciseId, e.sets]), [['bench-press', 4], ['pull-up', 3]]);

  const csv = importers.csvToPlanText('Exercise,Sets,Reps\nBack Squat,5,5\nLeg Press,3,12\n');
  assert.deepEqual(importers.parseWorkoutText(csv, { exercises: ex.BUILT_IN }).workouts[0].exercises.map((e) => [e.exerciseId, e.sets, e.reps]),
    [['back-squat', 5, '5'], ['leg-press', 3, '12']]);
  assert.throws(() => importers.csvToPlanText(FITBOD), /Fitbod/);
});

test('workout CSV: columns found by name in any order, a Workout/Day column splits workouts', () => {
  const plan = (csv) => importers.parseWorkoutText(importers.csvToPlanText(csv), { exercises: ex.BUILT_IN }).workouts
    .map((w) => [w.name, w.exercises.map((e) => [e.exerciseId, e.sets, e.reps])]);
  assert.deepEqual(plan('Workout,Exercise,Sets,Reps\nUpper,Bench Press,4,6-8\nUpper,Pull-ups,3,AMRAP\nLower,Back Squat,5,5\n'),
    [['Upper', [['bench-press', 4, '6-8'], ['pull-up', 3, 'AMRAP']]], ['Lower', [['back-squat', 5, '5']]]]);
  assert.deepEqual(plan('Day,Name,Reps,Sets,Rest\n1,Overhead press,8,3,90s\n2,Deadlift,5,1,3 min\n'),
    [['Day 1', [['overhead-press', 3, '8']]], ['Day 2', [['deadlift', 1, '5']]]]);
});

test('pasted CSV text (with or without its header) reads like a CSV file', () => {
  const body = 'Upper,Bench Press,4,6-8\nUpper,Pull-ups,3,AMRAP\nLower,Back Squat,5,5\nLower,Leg Curl,3,12';
  const plan = (t) => importers.parseWorkoutText(t, { exercises: ex.BUILT_IN }).workouts.map((w) => [w.name, w.exercises.map((e) => [e.exerciseId, e.sets])]);
  const want = [['Upper', [['bench-press', 4], ['pull-up', 3]]], ['Lower', [['back-squat', 5], ['lying-leg-curl', 3]]]];
  assert.deepEqual(plan('Workout,Exercise,Sets,Reps\n' + body), want);
  assert.deepEqual(plan(body), want);
  assert.equal(importers.looksLikeCsv('Upper body\nBench press 4x8, then rows 3x10, then curls.\nSquat 5x5'), false);
});

test('shared routine text reads back as the same routine, equipment and custom names included', () => {
  const name = {}; ex.BUILT_IN.forEach((e) => { name[e.id] = e.name; });
  const t = { name: 'Heavy Upper Body Push and Arms Day', exercises: [{ exerciseId: 'bench-press', sets: 4 }, { exerciseId: 'db-curl', sets: 3 }, { exerciseId: 'cable-curl', sets: 2 }, { exerciseId: 'c-1', sets: 1 }] };
  const text = importers.routineToText(t, (id) => name[id] || 'Zercher Wiggle (pause)');
  assert.match(text, /^Routine: Heavy Upper Body Push and Arms Day\nBench Press \(Barbell\): 4 sets/);
  const back = importers.parseWorkoutText(text, { exercises: ex.BUILT_IN });
  assert.equal(back.skipped.length, 0);
  assert.equal(back.workouts[0].name, 'Heavy Upper Body Push and Arms Day');
  assert.deepEqual(back.workouts[0].exercises.map((e) => [e.exerciseId, e.sets]), [['bench-press', 4], ['db-curl', 3], ['cable-curl', 2], [null, 1]]);
  assert.equal(back.workouts[0].exercises[3].name, 'Zercher Wiggle (pause)');
});

// ----- Review fixes (Nov 2026) -----
const DAY = 864e5;
const benchAt = (now, ago, wt, reps, extra) => Object.assign({ id: 'w' + ago + '-' + wt, name: 'x', unit: 'lb', startedAt: new Date(now - ago * DAY).toISOString(), endedAt: new Date(now - ago * DAY + 36e5).toISOString(),
  exercises: [{ id: 'e', exerciseId: 'bench-press', sets: [{ id: 's', weight: wt, reps, done: true }] }] }, extra || {});

test('e1rm: reps above 12 count as 12, so light high-rep sets cannot pose as strength gains', () => {
  assert.equal(m.E1RM_MAX_REPS, 12);
  assert.ok(Math.abs(m.e1rm(135, 20) - 135 * 1.4) < 1e-9);
  assert.ok(m.e1rm(205, 3) > m.e1rm(135, 20)); // was 225.5 vs 225.0 uncapped
  assert.equal(m.e1rm(100, 12), m.e1rm(100, 30));
  assert.ok(Math.abs(m.e1rm(200, 5) - 233.33) < 0.01); // unchanged for normal sets
});

test('trends: a lifter climbing back after a break reads Progressing, not Stalled; the old best stays as all-time best', () => {
  const now = new Date(2026, 10, 17).getTime();
  const ws = [benchAt(now, 730, 225, 5, { imported: true }), benchAt(now, 720, 225, 5, { imported: true }), benchAt(now, 700, 220, 5, { imported: true }),
    benchAt(now, 42, 185, 5), benchAt(now, 35, 190, 5), benchAt(now, 28, 195, 5), benchAt(now, 21, 200, 5), benchAt(now, 14, 205, 5), benchAt(now, 7, 210, 5)];
  const t = m.liftTrends(ws, new Date(now))[0];
  assert.equal(t.status, 'progressing');
  assert.equal(t.sessions, 6);          // judged on the last 90 days
  assert.equal(t.totalSessions, 9);
  assert.ok(Math.abs(t.best - m.e1rm(210, 5)) < 1e-9);
  assert.ok(Math.abs(t.allTimeBest - m.e1rm(225, 5)) < 1e-9);
  assert.equal(t.points.length, 9);     // the chart still has the whole history
  // A genuine stall inside the window is still a stall
  const flat = [benchAt(now, 63, 215, 5), benchAt(now, 56, 210, 5), benchAt(now, 49, 210, 5), benchAt(now, 42, 210, 5), benchAt(now, 35, 210, 5), benchAt(now, 28, 210, 5), benchAt(now, 21, 210, 5), benchAt(now, 7, 210, 5)];
  assert.equal(m.liftTrends(flat, new Date(now))[0].status, 'stalled');
});

test('hints: a weight change on an earlier set today carries to the next sets; no history falls back to the previous set', () => {
  const now = Date.now();
  const last = m.lastSessionFor([{ id: 'p', name: 'x', unit: 'lb', startedAt: new Date(now - 7 * DAY).toISOString(), endedAt: new Date(now - 7 * DAY + 36e5).toISOString(),
    exercises: [{ id: 'e', exerciseId: 'bench-press', sets: [203, 203, 203, 203].map((w, i) => ({ id: 's' + i, weight: w, reps: 8, done: true })) }] }], 'bench-press');
  assert.deepEqual(m.hintForSet(last, 0, 'lb', false, []), { weight: 203, reps: 8 });
  assert.deepEqual(m.hintForSet(last, 2, 'lb', false, [{ weight: 205, reps: 8 }, { weight: 205, reps: 8 }]), { weight: 205, reps: 8 });
  assert.deepEqual(m.hintForSet(last, 1, 'lb', false, [{ weight: 203, reps: 6 }]), { weight: 203, reps: 8 }); // same weight: plan stands
  assert.deepEqual(m.hintForSet(null, 1, 'lb', false, [{ weight: 60, reps: 12 }]), { weight: 60, reps: 12 });
  assert.equal(m.hintForSet(null, 0, 'lb', false, []), null);
  // pyramids keep their per-set plan when today's weights match it
  const pyr = m.lastSessionFor([{ id: 'p', name: 'x', unit: 'lb', startedAt: new Date(now - 7 * DAY).toISOString(), endedAt: new Date(now - 7 * DAY + 36e5).toISOString(),
    exercises: [{ id: 'e', exerciseId: 'bench-press', sets: [185, 205, 225].map((w, i) => ({ id: 's' + i, weight: w, reps: 5, done: true })) }] }], 'bench-press');
  assert.deepEqual(m.hintForSet(pyr, 1, 'lb', false, [{ weight: 185, reps: 5 }]), { weight: 205, reps: 5 });
});

test('strength total: sums current bests of chosen lifts, compares with the 8 weeks before, and the all-time best', () => {
  const now = new Date(2026, 10, 17).getTime();
  const lift = (id, ago, wt) => ({ id: id + ago, name: 'x', unit: 'lb', startedAt: new Date(now - ago * DAY).toISOString(), endedAt: new Date(now - ago * DAY + 36e5).toISOString(),
    exercises: [{ id: 'e', exerciseId: id, sets: [{ id: 's', weight: wt, reps: 1, done: true }] }] });
  const ws = [lift('bench-press', 300, 250), lift('bench-press', 80, 220), lift('bench-press', 10, 230), lift('back-squat', 70, 300), lift('back-squat', 5, 320), lift('deadlift', 400, 405)];
  const st = m.strengthTotal(ws, ['bench-press', 'back-squat', 'deadlift'], new Date(now));
  assert.equal(st.totalLb, 550);                  // deadlift has no session in 8 weeks: left out
  assert.equal(st.lifts.length, 2);
  assert.equal(st.changeLb, 30);                  // 230+320 vs 220+300
  assert.equal(st.pctOfBest, Math.round(550 / 570 * 100));
  assert.equal(m.strengthTotal(ws, ['bench-press'], new Date(now)), null);
  const noPrior = m.strengthTotal([lift('bench-press', 3, 200), lift('back-squat', 3, 300)], ['bench-press', 'back-squat'], new Date(now));
  assert.equal(noPrior.changeLb, null);
});

test('records: a best that came from an imported workout says so', () => {
  const now = Date.now();
  const r = m.personalRecords([benchAt(now, 30, 250, 3, { imported: true }), benchAt(now, 3, 225, 5)])[0];
  assert.equal(r.bestE1rm.imported, true);
  assert.equal(r.heaviest.imported, true);
});

// ---------- Rep targets and progression (1.7.1) ----------
test('rep targets: parse, text, share round trip', () => {
  assert.deepEqual(importers.parseRepTarget('8-12'), { min: 8, max: 12 });
  assert.deepEqual(importers.parseRepTarget(' 8 – 12 reps'), { min: 8, max: 12 });
  assert.deepEqual(importers.parseRepTarget('12-8'), { min: 8, max: 12 });
  assert.deepEqual(importers.parseRepTarget('5'), { min: 5, max: 5 });
  for (const bad of ['', 'AMRAP', '30s', '0', '8-200', 'eight']) assert.equal(importers.parseRepTarget(bad), null, bad);
  assert.equal(importers.repTargetText({ min: 8, max: 12 }), '8–12');
  assert.equal(importers.repTargetText({ min: 5, max: 5 }), '5');
  const t = { name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: 4, reps: { min: 8, max: 12 } }, { exerciseId: 'dip', sets: 3 }] };
  const name = { 'bench-press': 'Bench Press (Barbell)', dip: 'Dip' };
  const back = importers.parseWorkoutText(importers.routineToText(t, (id) => name[id]), { exercises: ex.BUILT_IN }).workouts[0];
  assert.equal(back.name, 'Push');
  assert.deepEqual(back.exercises.map((e) => [e.exerciseId, e.sets, importers.parseRepTarget(e.reps)]),
    [['bench-press', 4, { min: 8, max: 12 }], ['dip', 3, null]]);
});

test('rep targets: kept on routines and the workout in progress, invalid ones dropped', () => {
  const st = store.normalise({
    templates: [{ id: 't', name: 'A', exercises: [{ exerciseId: 'bench-press', sets: 4, reps: { min: 8, max: 12 } }, { exerciseId: 'dip', sets: 3, reps: { min: 12, max: 8 } }] }],
    workouts: [{ id: 'w', startedAt: '2026-11-01T10:00:00Z', endedAt: '2026-11-01T11:00:00Z', lastSetAt: '2026-11-01T10:50:00Z', exercises: [] }],
    active: { id: 'a', startedAt: '2026-11-02T10:00:00Z', lastSetAt: '2026-11-02T10:20:00Z', exercises: [{ id: 'e', exerciseId: 'bench-press', target: { min: 8, max: 12 }, sets: [] }] }
  });
  assert.deepEqual(st.templates[0].exercises[0].reps, { min: 8, max: 12 });
  assert.equal('reps' in st.templates[0].exercises[1], false);
  assert.deepEqual(st.active.exercises[0].target, { min: 8, max: 12 });
  assert.equal(st.active.lastSetAt, '2026-11-02T10:20:00.000Z');
  assert.equal('lastSetAt' in st.workouts[0], false);
});

test('progression: up a step only when every working set hit the top of the range', () => {
  const sess = (sets, unit = 'lb') => ({ unit, sets: sets.map(([w, r, warm]) => ({ weight: w, reps: r, warmup: !!warm })) });
  const tg = { min: 8, max: 12 };
  assert.deepEqual(m.progressionFor(sess([[45, 10, true], [135, 12], [135, 12], [135, 13]]), tg, 'lb', 'weight'), { weight: 140, reps: 8, from: 135 });
  assert.equal(m.progressionFor(sess([[135, 12], [135, 11]]), tg, 'lb', 'weight'), null);          // one set short
  assert.equal(m.progressionFor(sess([[135, 12], [140, 12]]), tg, 'lb', 'weight'), null);          // mixed weights
  assert.deepEqual(m.progressionFor(sess([[60, 12], [60, 12]], 'kg'), tg, 'kg', 'weight'), { weight: 62.5, reps: 8, from: 60 });
  assert.deepEqual(m.progressionFor(sess([[40, 12]]), tg, 'lb', 'assisted'), { weight: 35, reps: 8, from: 40 });
  assert.deepEqual(m.progressionFor(sess([[0, 12]]), tg, 'lb', 'weighted'), { weight: 5, reps: 8, from: 0 });
  assert.equal(m.progressionFor(sess([[0, 12]]), tg, 'lb', 'bodyweight'), null);
  assert.equal(m.progressionFor(null, tg, 'lb', 'weight'), null);
  assert.equal(m.progressionFor(sess([[135, 12]]), null, 'lb', 'weight'), null);
});

test('progression: the suggestion becomes the hint, and today’s own weight still wins', () => {
  const last = { unit: 'lb', sets: [{ weight: 135, reps: 12 }, { weight: 135, reps: 12 }, { weight: 135, reps: 12 }] };
  const plan = { weight: 140, reps: 8 };
  assert.deepEqual(m.hintForSet(last, 0, 'lb', false, [], plan), { weight: 140, reps: 8 });
  assert.deepEqual(m.hintForSet(last, 1, 'lb', false, [{ weight: 140, reps: 9 }], plan), { weight: 140, reps: 8 });
  assert.deepEqual(m.hintForSet(last, 1, 'lb', false, [{ weight: 145, reps: 8 }], plan), { weight: 145, reps: 8 });
  assert.deepEqual(m.hintForSet(last, 0, 'lb', true, [], plan), m.hintFor(last, 0, 'lb', true)); // warm-ups ignore the plan
});

test('sets per muscle: this week vs last week, warm-ups and unconfirmed sets ignored', () => {
  const now = new Date(2026, 10, 18, 12); // Wednesday
  const wk = (date, sets) => ({ startedAt: date.toISOString(), endedAt: date.toISOString(), unit: 'lb',
    exercises: sets.map(([id, n, warm = 0, open = 0]) => ({ exerciseId: id, sets: [
      ...Array(n).fill(0).map(() => ({ weight: 100, reps: 5, done: true })),
      ...Array(warm).fill(0).map(() => ({ weight: 45, reps: 5, done: true, warmup: true })),
      ...Array(open).fill(0).map(() => ({ weight: null, reps: null, done: false }))] })) });
  const muscle = { 'bench-press': 'Chest', 'barbell-row': 'Back', curl: 'Biceps' };
  const rows = m.setsByMuscle([
    wk(new Date(2026, 10, 16, 18), [['bench-press', 4, 2, 1], ['barbell-row', 3]]),  // Monday this week
    wk(new Date(2026, 10, 12, 18), [['bench-press', 3], ['curl', 2]]),               // last week
    wk(new Date(2026, 10, 1, 18), [['curl', 9]])                                      // older: ignored
  ], (id) => muscle[id], now);
  assert.deepEqual(rows, [
    { muscle: 'Chest', thisWeek: 4, lastWeek: 3 },
    { muscle: 'Back', thisWeek: 3, lastWeek: 0 },
    { muscle: 'Biceps', thisWeek: 0, lastWeek: 2 }]);
  assert.deepEqual(m.setsByMuscle([], () => 'Chest', now), []);
});

// ---------- 1.8.0: CSV export, body weight, RPE, supersets, theme ----------
test('CSV export: one row per confirmed set, quoted safely, oldest first', () => {
  const ws = [
    { name: 'Legs, heavy', unit: 'kg', startedAt: new Date(2026, 10, 12, 18, 5).toISOString(), endedAt: new Date(2026, 10, 12, 19, 15).toISOString(), imported: true,
      exercises: [{ exerciseId: 'back-squat', sets: [{ weight: 100, reps: 5, done: true, warmup: false, rpe: 8 }] }] },
    { name: '=cmd', unit: 'lb', startedAt: new Date(2026, 10, 10, 7, 0).toISOString(), endedAt: new Date(2026, 10, 10, 8, 0).toISOString(),
      exercises: [{ exerciseId: 'plank', sets: [{ weight: 0, reps: null, seconds: 60, done: true, warmup: false }, { weight: null, reps: null, done: false }] },
                  { exerciseId: 'bench-press', sets: [{ weight: 45, reps: 10, done: true, warmup: true }, { weight: 135, reps: 5, done: true }] }] }];
  const csv = importers.workoutsToCsv(ws, (id) => ({ 'back-squat': 'Back Squat "Barbell"', plank: 'Plank', 'bench-press': 'Bench Press (Barbell)' })[id]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Date,Time,Workout,Exercise,Set,Warm-up,Weight,Unit,Reps,Seconds,RPE,Duration (min),Imported');
  assert.equal(lines.length, 5);
  assert.equal(lines[1], "2026-11-10,07:00,'=cmd,Plank,1,,0,lb,,60,,60,");
  assert.equal(lines[2], "2026-11-10,07:00,'=cmd,Bench Press (Barbell),1,yes,45,lb,10,,,60,");
  assert.equal(lines[4], '2026-11-12,18:05,"Legs, heavy","Back Squat ""Barbell""",1,,100,kg,5,,8,70,yes');
});

test('store keeps body weight, RPE, supersets and theme; drops bad values', () => {
  const st = store.normalise({
    workouts: [{ id: 'w', startedAt: '2026-11-01T10:00:00Z', endedAt: '2026-11-01T11:00:00Z',
      exercises: [{ exerciseId: 'a', superNext: true, sets: [{ weight: 100, reps: 5, done: true, rpe: 8.3 }, { weight: 100, reps: 5, done: true, rpe: 14 }] }] }],
    templates: [{ id: 't', name: 'A', exercises: [{ exerciseId: 'a', sets: 3, superNext: true }, { exerciseId: 'b', sets: 3 }] }],
    bodyWeights: [{ id: 'x', date: '2026-11-03T12:00:00Z', weight: 180.04, unit: 'lb' }, { id: 'y', date: '2026-11-01T12:00:00Z', weight: 82, unit: 'kg' },
      { id: 'z', date: 'nope', weight: 180 }, { id: 'q', date: '2026-11-02T12:00:00Z', weight: 5000, unit: 'lb' }],
    settings: { theme: 'neon', rpe: 'yes' }
  });
  const sets = st.workouts[0].exercises[0].sets;
  assert.equal(sets[0].rpe, 8.5);
  assert.equal('rpe' in sets[1], false);
  assert.equal(st.workouts[0].exercises[0].superNext, true);
  assert.equal(st.templates[0].exercises[0].superNext, true);
  assert.equal('superNext' in st.templates[0].exercises[1], false);
  assert.deepEqual(st.bodyWeights.map((b) => [b.id, b.weight, b.unit]), [['y', 82, 'kg'], ['x', 180, 'lb']]);
  assert.equal(st.settings.theme, 'dark');
  assert.equal(st.settings.rpe, false);
  assert.equal(store.normalise({ workouts: [], settings: { theme: 'system', rpe: true } }).settings.theme, 'system');
});

test('exercise sides: your choice is kept, bad values dropped (2.0.1)', () => {
  const st = store.normalise({ workouts: [], settings: { exerciseSides: { 'hammer-curl': 'arm', 'db-row': 'both', x: 'both-ish', y: 'leg' } } });
  assert.deepEqual(st.settings.exerciseSides, { 'hammer-curl': 'arm', 'db-row': 'both', y: 'leg' });
  assert.deepEqual(store.normalise({ workouts: [] }).settings.exerciseSides, {});
});

test('push / pull / legs: weekly sets and when each muscle was last trained (2.2.0)', () => {
  const now = new Date(2026, 10, 25, 12); // Wednesday
  const wk = (date, list, done = true) => ({ startedAt: date.toISOString(), endedAt: done ? date.toISOString() : null, unit: 'lb',
    exercises: list.map(([id, n, warm]) => ({ exerciseId: id, sets: Array(n).fill(0).map(() => ({ weight: 100, reps: 5, done: true, warmup: !!warm })) })) });
  const muscle = { bench: 'Chest', ohp: 'Shoulders', row: 'Back', squat: 'Quads', plank: 'Core', odd: 'Neck' };
  const split = m.trainingSplit([
    wk(new Date(2026, 10, 24, 18), [['bench', 4], ['ohp', 3]]),   // yesterday: push
    wk(new Date(2026, 10, 18, 18), [['row', 4], ['bench', 2]]),   // last week
    wk(new Date(2026, 10, 10, 18), [['squat', 5], ['odd', 2]]),   // 15 days ago
    wk(new Date(2026, 10, 25, 9), [['squat', 1, true]]),          // warm-up only: doesn't count
    wk(new Date(2026, 10, 25, 10), [['plank', 3]], false)         // unfinished: doesn't count
  ], (id) => muscle[id], now);
  assert.deepEqual(split.map((g) => [g.id, g.thisWeek, g.lastWeek, g.days]), [['push', 7, 2, 1], ['pull', 0, 4, 7], ['legs', 0, 0, 15], ['core', 0, 0, 15]]);
  assert.deepEqual(split[0].muscles.map((x) => [x.muscle, x.thisWeek, x.days]), [['Chest', 4, 1], ['Shoulders', 3, 1]]);
  assert.deepEqual(split[3].muscles.map((x) => x.muscle), ['Neck']);   // unknown muscles go to Core & other
  assert.deepEqual(m.trainingSplit([], () => 'Chest', now), []);
  assert.equal(m.daysSince(new Date(2026, 10, 24, 23, 59).toISOString(), now), 1);
});

// ---------- Phase 2 (2.4.0): heaviest and rep-at-weight PRs, what changed ----------
const pW = (id, date, sets, extra = {}) => ({ id, name: 'W', unit: 'lb', startedAt: date, endedAt: date, ...extra,
  exercises: [{ id: id + 'e', exerciseId: 'bench', sets: sets.map(([w, r, warm], i) => ({ id: id + 's' + i, weight: w, reps: r, done: true, warmup: !!warm })) }] });

test('PRs: heaviest weight ever and more reps at a weight count, alongside est. 1RM', () => {
  const past = [pW('a', '2026-11-01T10:00:00Z', [[225, 10], [185, 8], [205, 5]])]; // best e1RM 300 (225x10)
  const live = (w, r) => { const act = pW('t', '2026-11-20T10:00:00Z', [[w, r]]); act.endedAt = null; return m.checkPr(past, act, 'te', 'ts0'); };
  assert.equal(live(230, 1).type, 'weight');                  // heaviest ever, e1RM 230 < 300
  assert.equal(live(230, 1).previousLb, 225);
  assert.equal(live(205, 6), null);                           // 225 x 10 earlier: 6 reps at 205+ is no record
  assert.equal(live(205, 9), null);                           // 225 x 10 already beats 9 reps at 205+
  assert.equal(live(225, 11).type, 'e1rm');                   // est. 1RM wins when it's a record too
  const past2 = [pW('a', '2026-11-01T10:00:00Z', [[225, 5], [185, 8]])];
  const live2 = (w, r) => { const act = pW('t', '2026-11-20T10:00:00Z', [[w, r]]); act.endedAt = null; return m.checkPr(past2, act, 'te', 'ts0'); };
  assert.deepEqual(live2(185, 9) && [live2(185, 9).type, live2(185, 9).previous], ['repsAt', 8]);
  assert.equal(live2(100, 20), null);                         // under half the heaviest: not a record
  assert.equal(live2(185, 8), null);                          // tie isn't a record
  const warm = pW('t', '2026-11-20T10:00:00Z', [[300, 1, true]]); warm.endedAt = null;
  assert.equal(m.checkPr(past2, warm, 'te', 'ts0'), null);    // warm-ups never
  const first = pW('t', '2026-11-20T10:00:00Z', [[300, 1]]); first.endedAt = null;
  assert.equal(m.checkPr([], first, 'te', 'ts0'), null);      // first session never
});

test('PR history: heaviest and rep PRs appear once per session; imported raises the bar without a PR', () => {
  const ws = [
    pW('a', '2026-11-01T10:00:00Z', [[225, 5], [185, 8]]),
    pW('b', '2026-11-05T10:00:00Z', [[185, 10], [185, 9]]),            // rep PR at 185 (10 > 8); e1RM 246.7 < 262.5? 185x10 = 246.7 < 225x5 = 262.5
    pW('c', '2026-11-09T10:00:00Z', [[235, 1], [190, 3]]),              // heaviest (235 > 225)
    pW('d', '2026-11-12T10:00:00Z', [[245, 1]], { imported: true }),   // imported: no PR, raises the bar
    pW('e', '2026-11-15T10:00:00Z', [[240, 1]])                         // not heaviest any more (245 imported)
  ];
  assert.deepEqual(m.prEvents(ws).map((e) => [e.workoutId, e.type, e.weightLb, e.reps]), [['b', 'repsAt', 185, 10], ['c', 'weight', 235, 1]]);
});

test('what changed: top set against last time, in plain kinds', () => {
  const ws = [
    pW('a', '2026-11-01T10:00:00Z', [[225, 5], [225, 5]]),
    pW('b', '2026-11-05T10:00:00Z', [[225, 6], [225, 5]]),
    pW('c', '2026-11-09T10:00:00Z', [[235, 3]]),
    pW('d', '2026-11-12T10:00:00Z', [[205, 8]])
  ];
  const k = (w) => m.sessionChanges(ws, w).map((x) => [x.kind, x.delta])[0];
  assert.deepEqual(k(ws[0]), ['first', undefined]);
  assert.deepEqual(k(ws[1]), ['moreReps', 1]);
  assert.deepEqual(k(ws[2]), ['heavier', 10]);
  assert.deepEqual(k(ws[3]), ['lighter', -30]);
  assert.deepEqual(m.sessionChanges(ws, ws[1])[0].before, { lb: 225, reps: 5 });
});

test('starter routines only use built-in exercises, with valid rep targets (2.4.0)', () => {
  const ids = new Set(ex.BUILT_IN.map((e) => e.id));
  assert.equal(ex.STARTERS.length, 3);
  ex.STARTERS.forEach((p) => p.routines.forEach((r) => r.rows.forEach(([id, sets, reps]) => {
    assert.ok(ids.has(id), p.id + ' uses unknown ' + id);
    assert.ok(sets >= 1 && sets <= 6);
    if (reps) assert.ok(importers.parseRepTarget(reps), reps);
  })));
});

test('library equipment filled in from names where plain; logging defaults unchanged (2.5.0)', () => {
  const by = (n) => ex.BUILT_IN.find((e) => e.name === n);
  assert.equal(by('Hamstring Stretch').equipment, 'Bodyweight');   // "hamstring" isn't gymnastic rings
  assert.equal(by('IT Band and Glute Stretch').equipment, 'Bodyweight');
  assert.equal(by('Band Assisted Pull-Up').equipment, 'Band');
  assert.equal(by('Axle Deadlift').equipment, 'Barbell');
  for (const n of ['Ring Dips', 'Sled Push', 'Prowler Sprint', 'Medicine Ball Chest Pass', 'Weighted Pull Ups', 'Calves-SMR']) assert.equal(by(n).equipment, 'Other', n);
  assert.equal(by('Muscle Up').equipment, 'Bodyweight');
  assert.equal(ex.defaultTracking(by('Muscle Up')), 'weight');      // relabelled as body weight, still logged with a weight box as before
  assert.ok(ex.BUILT_IN.filter((e) => e.library && e.equipment === 'Other').length < 130);
});
