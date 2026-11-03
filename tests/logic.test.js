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
