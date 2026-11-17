/* Sync rules (js/sync.js) against an in-memory stand-in for the Supabase tables. */
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../js/store.js');
const sync = require('../js/sync.js');

/** One person's cloud rows. updated_at is stamped by the "server", like the database trigger. */
function fakeCloud() {
  let clock = 0;
  const stamp = () => '2026-11-02T00:00:00.' + String(++clock).padStart(6, '0') + '+00:00';
  const rows = new Map();
  let profile = null;
  const calls = { pushed: 0, profilePuts: 0 };
  return {
    rows, calls,
    get profile() { return profile; },
    remote: {
      pullWorkouts: async (since) => [...rows.values()]
        .filter((r) => !since || r.updated_at > since)
        .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
        .map((r) => JSON.parse(JSON.stringify(r))),
      pushWorkouts: async (list) => {
        calls.pushed += list.length;
        list.forEach((r) => rows.set(r.id, { id: r.id, data: JSON.parse(JSON.stringify(r.data)), deleted: r.deleted, updated_at: stamp() }));
      },
      getProfile: async () => (profile ? JSON.parse(JSON.stringify(profile)) : null),
      putProfile: async (data) => {
        calls.profilePuts++;
        profile = { data: JSON.parse(JSON.stringify(data)), updated_at: stamp() };
        return { updated_at: profile.updated_at };
      }
    }
  };
}

function workout(id, day, weight) {
  return {
    id, name: 'Push', templateId: null, unit: 'lb',
    startedAt: `2026-10-${day}T10:00:00.000Z`, endedAt: `2026-10-${day}T11:00:00.000Z`,
    exercises: [{ id: id + 'e', exerciseId: 'bench', sets: [{ id: id + 's', weight, reps: 5, seconds: null, done: true, warmup: false }] }]
  };
}

function phone(state) { return { state: state || store.defaults(), meta: sync.emptyMeta() }; }
const run = (p, cloud) => sync.run(p.state, p.meta, cloud.remote);

test('first sign-in uploads what is already on the phone, then has nothing left to send', async () => {
  const cloud = fakeCloud();
  const a = phone();
  a.state.workouts.push(workout('w1', 10, 135), workout('w2', 12, 140));
  a.state.settings.setupDone = true;
  assert.equal(sync.pendingCount(a.state, a.meta), 3); // 2 workouts + profile
  await run(a, cloud);
  assert.equal(cloud.rows.size, 2);
  assert.ok(cloud.profile);
  assert.equal(sync.pendingCount(a.state, a.meta), 0);
  const before = { ...cloud.calls };
  const res = await run(a, cloud);
  assert.deepEqual(cloud.calls, before);
  assert.equal(res.changed, false);
});

test('a new phone gets the workouts, settings and saved workouts without overwriting them with defaults', async () => {
  const cloud = fakeCloud();
  const a = phone();
  a.state.workouts.push(workout('w1', 10, 135));
  a.state.settings.unit = 'kg';
  a.state.settings.setupDone = true;
  a.state.templates.push({ id: 't1', name: 'Push day', exercises: [{ exerciseId: 'bench', sets: 3 }] });
  await run(a, cloud);

  const b = phone();
  const res = await run(b, cloud);
  assert.equal(res.changed, true);
  assert.equal(b.state.workouts.length, 1);
  assert.equal(b.state.settings.unit, 'kg');
  assert.equal(b.state.settings.setupDone, true);
  assert.deepEqual(b.state.templates.map((t) => t.id), ['t1']);
  assert.equal(cloud.profile.data.settings.unit, 'kg');
  assert.equal(sync.pendingCount(b.state, b.meta), 0);
});

test('first sync on a phone that already has its own data keeps both sides', async () => {
  const cloud = fakeCloud();
  const a = phone();
  a.state.workouts.push(workout('w1', 10, 135));
  a.state.templates.push({ id: 't1', name: 'A', exercises: [] });
  await run(a, cloud);

  const b = phone();
  b.state.workouts.push(workout('w2', 11, 150));
  b.state.templates.push({ id: 't2', name: 'B', exercises: [] });
  await run(b, cloud);
  assert.deepEqual(b.state.workouts.map((w) => w.id).sort(), ['w1', 'w2']);
  assert.deepEqual(b.state.templates.map((t) => t.id).sort(), ['t1', 't2']);
  await run(a, cloud);
  assert.deepEqual(a.state.workouts.map((w) => w.id).sort(), ['w1', 'w2']);
  assert.deepEqual(a.state.templates.map((t) => t.id).sort(), ['t1', 't2']);
});

test('edits and deletes on one phone reach the other', async () => {
  const cloud = fakeCloud();
  const a = phone(); const b = phone();
  a.state.workouts.push(workout('w1', 10, 135), workout('w2', 12, 140));
  await run(a, cloud); await run(b, cloud);
  assert.equal(b.state.workouts.length, 2);

  b.state.workouts[0].exercises[0].sets[0].weight = 155; // edit w1
  b.state.workouts = b.state.workouts.filter((w) => w.id !== 'w2'); // delete w2
  assert.equal(sync.pendingCount(b.state, b.meta), 2);
  await run(b, cloud);
  assert.equal(cloud.rows.get('w2').deleted, true);

  const res = await run(a, cloud);
  assert.equal(res.changed, true);
  assert.deepEqual(a.state.workouts.map((w) => w.id), ['w1']);
  assert.equal(a.state.workouts[0].exercises[0].sets[0].weight, 155);
  assert.equal(sync.pendingCount(a.state, a.meta), 0);
});

test('logged offline: nothing is lost if the upload fails, and it goes up on the next run', async () => {
  const cloud = fakeCloud();
  const a = phone();
  await run(a, cloud);
  a.state.workouts.push(workout('w1', 10, 135));
  const failing = { ...cloud.remote, pushWorkouts: async () => { throw new TypeError('Load failed'); } };
  await assert.rejects(sync.run(a.state, a.meta, failing));
  assert.equal(a.state.workouts.length, 1);
  assert.equal(sync.pendingCount(a.state, a.meta), 1);
  await run(a, cloud);
  assert.equal(cloud.rows.size, 1);
  assert.equal(sync.pendingCount(a.state, a.meta), 0);
});

test('if both phones changed the same workout, the phone that syncs keeps its own version', async () => {
  const cloud = fakeCloud();
  const a = phone(); const b = phone();
  a.state.workouts.push(workout('w1', 10, 135));
  await run(a, cloud); await run(b, cloud);
  a.state.workouts[0].exercises[0].sets[0].weight = 145;
  b.state.workouts[0].exercises[0].sets[0].weight = 150;
  await run(a, cloud);
  await run(b, cloud); // b's own edit wins on b and is uploaded
  assert.equal(b.state.workouts[0].exercises[0].sets[0].weight, 150);
  await run(a, cloud);
  assert.equal(a.state.workouts[0].exercises[0].sets[0].weight, 150);
});

test('the workout in progress stays on the phone, and bad cloud rows are ignored', async () => {
  const cloud = fakeCloud();
  const a = phone();
  a.state.active = { ...workout('live', 13, 100), endedAt: null };
  await run(a, cloud);
  assert.equal(cloud.rows.size, 0);
  cloud.rows.set('junk', { id: 'junk', data: { nope: true }, deleted: false, updated_at: '2026-11-03T00:00:00+00:00' });
  await run(a, cloud);
  assert.equal(a.state.workouts.length, 0);
});

test('settings changed on one phone reach the other', async () => {
  const cloud = fakeCloud();
  const a = phone(); const b = phone();
  await run(a, cloud); await run(b, cloud);
  a.state.settings.restSeconds = 180;
  await run(a, cloud);
  await run(b, cloud);
  assert.equal(b.state.settings.restSeconds, 180);
});

test('body weight, RPE and theme sync between phones (1.8.0)', async () => {
  const cloud = fakeCloud();
  const a = phone();
  a.state.settings.setupDone = true;
  a.state.settings.theme = 'light';
  a.state.settings.rpe = true;
  a.state.bodyWeights.push({ id: 'b1', date: '2026-11-01T12:00:00.000Z', weight: 181.4, unit: 'lb' });
  const w = workout('w1', 10, 135); w.exercises[0].sets[0].rpe = 8.5; w.exercises[0].superNext = true;
  a.state.workouts.push(w);
  await run(a, cloud);

  const b = phone();
  await run(b, cloud);
  assert.deepEqual(b.state.bodyWeights.map((x) => [x.id, x.weight]), [['b1', 181.4]]);
  assert.equal(b.state.settings.theme, 'light');
  assert.equal(b.state.settings.rpe, true);
  assert.equal(b.state.workouts[0].exercises[0].sets[0].rpe, 8.5);
  assert.equal(b.state.workouts[0].exercises[0].superNext, true);

  b.state.bodyWeights.push({ id: 'b2', date: '2026-11-08T12:00:00.000Z', weight: 180, unit: 'lb' });
  await run(b, cloud);
  await run(a, cloud);
  assert.deepEqual(a.state.bodyWeights.map((x) => x.id), ['b1', 'b2']);
});
