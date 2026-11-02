/* PR Forge — builds js/exercise-library.js from free-exercise-db (https://github.com/yuhonas/free-exercise-db, Unlicense).
 * Usage: node tools/build-exercises.js path/to/exercises.json [source-commit]
 * Keeps factual fields only (name, muscle, equipment). No images or instructions.
 * Exercises already in the curated list in js/exercises.js are merged, so history stays under one ID. */
'use strict';

var fs = require('fs');
var path = require('path');

// Curated ID -> the free-exercise-db entry for the same movement.
var MERGED = {
  'bench-press': 'Barbell_Bench_Press_-_Medium_Grip',
  'incline-bench-press': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'decline-bench-press': 'Decline_Barbell_Bench_Press',
  'close-grip-bench': 'Close-Grip_Barbell_Bench_Press',
  'db-bench-press': 'Dumbbell_Bench_Press',
  'db-incline-press': 'Incline_Dumbbell_Press',
  'db-fly': 'Dumbbell_Flyes',
  'cable-fly': 'Cable_Crossover',
  'machine-chest-press': 'Leverage_Chest_Press',
  'pec-deck': 'Butterfly',
  'smith-bench': 'Smith_Machine_Bench_Press',
  'push-up': 'Pushups',
  'dip': 'Dips_-_Chest_Version',
  'deadlift': 'Barbell_Deadlift',
  'trap-bar-deadlift': 'Trap_Bar_Deadlift',
  'barbell-row': 'Bent_Over_Barbell_Row',
  't-bar-row': 'T-Bar_Row_with_Handle',
  'db-row': 'One-Arm_Dumbbell_Row',
  'seated-cable-row': 'Seated_Cable_Rows',
  'single-arm-cable-row': 'Seated_One-arm_Cable_Pulley_Rows',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'pull-up': 'Pullups',
  'chin-up': 'Chin-Up',
  'straight-arm-pulldown': 'Straight-Arm_Pulldown',
  'back-extension': 'Hyperextensions_Back_Extensions',
  'rack-pull': 'Rack_Pulls',
  'shrug': 'Barbell_Shrug',
  'db-shrug': 'Dumbbell_Shrug',
  'overhead-press': 'Standing_Military_Press',
  'db-shoulder-press': 'Dumbbell_Shoulder_Press',
  'arnold-press': 'Arnold_Dumbbell_Press',
  'machine-shoulder-press': 'Machine_Shoulder_Military_Press',
  'lateral-raise': 'Side_Lateral_Raise',
  'front-raise': 'Front_Dumbbell_Raise',
  'rear-delt-fly': 'Seated_Bent-Over_Rear_Delt_Raise',
  'reverse-pec-deck': 'Reverse_Machine_Flyes',
  'face-pull': 'Face_Pull',
  'upright-row': 'Upright_Barbell_Row',
  'barbell-curl': 'Barbell_Curl',
  'ez-bar-curl': 'EZ-Bar_Curl',
  'db-curl': 'Dumbbell_Bicep_Curl',
  'hammer-curl': 'Hammer_Curls',
  'incline-db-curl': 'Incline_Dumbbell_Curl',
  'concentration-curl': 'Concentration_Curls',
  'preacher-curl': 'Preacher_Curl',
  'triceps-pushdown': 'Triceps_Pushdown',
  'rope-pushdown': 'Triceps_Pushdown_-_Rope_Attachment',
  'overhead-triceps-ext': 'Cable_Rope_Overhead_Triceps_Extension',
  'db-overhead-ext': 'Standing_Dumbbell_Triceps_Extension',
  'skull-crusher': 'EZ-Bar_Skullcrusher',
  'farmers-carry': 'Farmers_Walk',
  'back-squat': 'Barbell_Squat',
  'front-squat': 'Front_Barbell_Squat',
  'goblet-squat': 'Goblet_Squat',
  'hack-squat': 'Hack_Squat',
  'smith-squat': 'Smith_Machine_Squat',
  'leg-press': 'Leg_Press',
  'leg-extension': 'Leg_Extensions',
  'reverse-lunge': 'Dumbbell_Rear_Lunge',
  'step-up': 'Dumbbell_Step_Ups',
  'romanian-deadlift': 'Romanian_Deadlift',
  'lying-leg-curl': 'Lying_Leg_Curls',
  'seated-leg-curl': 'Seated_Leg_Curl',
  'good-morning': 'Good_Morning',
  'nordic-curl': 'Natural_Glute_Ham_Raise',
  'hip-thrust': 'Barbell_Hip_Thrust',
  'hip-abduction': 'Thigh_Abductor',
  'hip-adduction': 'Thigh_Adductor',
  'standing-calf-raise': 'Standing_Calf_Raises',
  'seated-calf-raise': 'Seated_Calf_Raise',
  'plank': 'Plank',
  'hanging-leg-raise': 'Hanging_Leg_Raise',
  'cable-crunch': 'Cable_Crunch',
  'ab-wheel': 'Ab_Roller',
  'russian-twist': 'Russian_Twist',
  'pallof-press': 'Pallof_Press',
  'power-clean': 'Power_Clean',
  'clean-and-jerk': 'Clean_and_Jerk',
  'snatch': 'Snatch'
};

var MUSCLE = {
  abdominals: 'Core', abductors: 'Glutes', adductors: 'Quads', biceps: 'Biceps', calves: 'Calves', chest: 'Chest',
  forearms: 'Forearms', glutes: 'Glutes', hamstrings: 'Hamstrings', lats: 'Back', 'lower back': 'Back',
  'middle back': 'Back', neck: 'Other', quadriceps: 'Quads', shoulders: 'Shoulders', traps: 'Back', triceps: 'Triceps'
};
var EQUIPMENT = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', 'body only': 'Bodyweight',
  kettlebells: 'Kettlebell', 'e-z curl bar': 'EZ bar', bands: 'Band', 'foam roll': 'Other', 'medicine ball': 'Other',
  'exercise ball': 'Other', other: 'Other'
};
// The source doesn't record one-sided lifts, so they are worked out from the name, with these exceptions.
var SIDE_OVERRIDES = {
  'Glute_Kickback': 'leg',
  'Standing_Concentration_Curl': 'arm',
  'Concentration_Curls': 'arm',
  'Kettlebell_Turkish_Get-Up_Lunge_style': ''
};

function sideOf(e) {
  if (Object.prototype.hasOwnProperty.call(SIDE_OVERRIDES, e.id)) return SIDE_OVERRIDES[e.id];
  if (/\b(one|single)[- ]arm/i.test(e.name)) return 'arm';
  if (/\b(one|single)[- ]leg/i.test(e.name)) return 'leg';
  if (/lunge|split squat|step[- ]?ups?\b|pistol squat/i.test(e.name)) return 'leg';
  return '';
}
// Stretches and cardio are logged by time, assisted lifts by the help used. Everything else uses the default.
function trackingOf(e) {
  if (e.category === 'stretching' || e.category === 'cardio') return 'timed';
  if (/\bassisted\b/i.test(e.name)) return 'assisted';
  return '';
}
function muscleOf(e) {
  if (e.category === 'olympic weightlifting') return 'Full body';
  var m = MUSCLE[e.primaryMuscles[0]];
  if (!m) throw new Error('Unknown muscle on ' + e.id + ': ' + e.primaryMuscles[0]);
  return m;
}
function equipmentOf(e) {
  if (/^smith\b/i.test(e.name)) return 'Smith machine';
  if (e.equipment === null) return 'Other';
  var q = EQUIPMENT[e.equipment];
  if (!q) throw new Error('Unknown equipment on ' + e.id + ': ' + e.equipment);
  return q;
}

var source = process.argv[2];
if (!source) { console.error('Usage: node tools/build-exercises.js path/to/exercises.json [source-commit]'); process.exit(1); }
var commit = process.argv[3] || 'unknown';
var db = JSON.parse(fs.readFileSync(source, 'utf8'));
var byId = {};
db.forEach(function (e) { byId[e.id] = e; });

var curated = require('../js/exercises.js').BUILT_IN.filter(function (e) { return !e.library; });
var curatedIds = {};
curated.forEach(function (e) { curatedIds[e.id] = true; });

var merged = {};
var aliases = {};
Object.keys(MERGED).forEach(function (id) {
  if (!curatedIds[id]) throw new Error('MERGED names an unknown curated exercise: ' + id);
  var entry = byId[MERGED[id]];
  if (!entry) throw new Error('MERGED names an unknown source exercise: ' + MERGED[id]);
  if (merged[entry.id]) throw new Error('Source exercise merged twice: ' + entry.id);
  merged[entry.id] = true;
  aliases[id] = entry.name;
});

var rows = db.filter(function (e) { return !merged[e.id]; }).map(function (e) {
  var row = ['fedb:' + e.id, e.name, muscleOf(e), equipmentOf(e), sideOf(e)];
  var tracking = trackingOf(e);
  if (tracking) row.push(tracking);
  return row;
}).sort(function (a, b) { return a[1].localeCompare(b[1]); });

var out = '/* PR Forge — exercise library. GENERATED by tools/build-exercises.js; do not edit by hand.\n' +
  ' * Source: free-exercise-db (Unlicense), commit ' + commit + '.\n' +
  ' * Each row: [id, name, primary muscle, equipment, side, tracking (when not the default)]. aliases: curated ID -> source name, for search. */\n' +
  '(function (root) {\n  \'use strict\';\n\n  var api = {\n    rows: [\n' +
  rows.map(function (r) { return '      ' + JSON.stringify(r); }).join(',\n') +
  '\n    ],\n    aliases: ' + JSON.stringify(aliases) + '\n  };\n\n' +
  '  root.PRF = root.PRF || {};\n  root.PRF.exerciseLibrary = api;\n' +
  '  if (typeof module === \'object\' && module.exports) module.exports = api;\n' +
  '})(typeof window !== \'undefined\' ? window : globalThis);\n';

var target = path.join(__dirname, '..', 'js', 'exercise-library.js');
fs.writeFileSync(target, out, 'utf8');

var sides = rows.filter(function (r) { return r[4]; });
console.log('Source: ' + db.length + ', merged into curated: ' + Object.keys(merged).length + ', added: ' + rows.length + ', one-sided: ' + sides.length);
console.log('Wrote ' + path.relative(path.join(__dirname, '..'), target) + ' (' + Buffer.byteLength(out) + ' bytes)');
