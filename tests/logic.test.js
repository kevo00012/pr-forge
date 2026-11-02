// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const units = require('../js/units.js');
const m = require('../js/metrics.js');
const store = require('../js/store.js');
const ex = require('../js/exercises.js');

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
  t = m.liftTrends(ws.slice(0, 3), now)[0];
  assert.equal(t.status, 'progressing');
  t = m.liftTrends(ws.slice(0, 2), now)[0];
  assert.equal(t.status, 'building');
  assert.equal(m.liftTrends(ws, new Date(2027, 5, 1)).length, 0); // nothing recent
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
