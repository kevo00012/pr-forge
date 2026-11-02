/* PR Forge — built-in exercise library (works offline).
 * Each row: [id, name, primary muscle, equipment, side]
 * side: '' = both sides together, 'arm' = per arm, 'leg' = per leg.
 * Per-side exercises show "Per arm"/"Per leg" under reps and volume is counted
 * once (weight x reps), never doubled. */
(function (root) {
  'use strict';

  var ROWS = [
    // Chest
    ['bench-press', 'Bench Press (Barbell)', 'Chest', 'Barbell', ''],
    ['incline-bench-press', 'Incline Bench Press (Barbell)', 'Chest', 'Barbell', ''],
    ['decline-bench-press', 'Decline Bench Press (Barbell)', 'Chest', 'Barbell', ''],
    ['close-grip-bench', 'Close-Grip Bench Press', 'Triceps', 'Barbell', ''],
    ['db-bench-press', 'Bench Press (Dumbbell)', 'Chest', 'Dumbbell', ''],
    ['db-incline-press', 'Incline Press (Dumbbell)', 'Chest', 'Dumbbell', ''],
    ['db-fly', 'Chest Fly (Dumbbell)', 'Chest', 'Dumbbell', ''],
    ['cable-fly', 'Cable Fly', 'Chest', 'Cable', ''],
    ['machine-chest-press', 'Chest Press (Machine)', 'Chest', 'Machine', ''],
    ['pec-deck', 'Pec Deck', 'Chest', 'Machine', ''],
    ['smith-bench', 'Bench Press (Smith Machine)', 'Chest', 'Smith machine', ''],
    ['push-up', 'Push-Up', 'Chest', 'Bodyweight', ''],
    ['dip', 'Dip', 'Chest', 'Bodyweight', ''],

    // Back
    ['deadlift', 'Deadlift (Barbell)', 'Back', 'Barbell', ''],
    ['trap-bar-deadlift', 'Deadlift (Trap Bar)', 'Back', 'Trap bar', ''],
    ['barbell-row', 'Bent-Over Row (Barbell)', 'Back', 'Barbell', ''],
    ['pendlay-row', 'Pendlay Row', 'Back', 'Barbell', ''],
    ['t-bar-row', 'T-Bar Row', 'Back', 'Barbell', ''],
    ['db-row', 'Single-Arm Row (Dumbbell)', 'Back', 'Dumbbell', 'arm'],
    ['chest-supported-row', 'Chest-Supported Row (Dumbbell)', 'Back', 'Dumbbell', ''],
    ['seated-cable-row', 'Seated Cable Row', 'Back', 'Cable', ''],
    ['single-arm-cable-row', 'Single-Arm Cable Row', 'Back', 'Cable', 'arm'],
    ['lat-pulldown', 'Lat Pulldown', 'Back', 'Cable', ''],
    ['machine-row', 'Row (Machine)', 'Back', 'Machine', ''],
    ['pull-up', 'Pull-Up', 'Back', 'Bodyweight', ''],
    ['chin-up', 'Chin-Up', 'Back', 'Bodyweight', ''],
    ['straight-arm-pulldown', 'Straight-Arm Pulldown', 'Back', 'Cable', ''],
    ['back-extension', 'Back Extension', 'Back', 'Bodyweight', ''],
    ['rack-pull', 'Rack Pull', 'Back', 'Barbell', ''],
    ['shrug', 'Shrug (Barbell)', 'Back', 'Barbell', ''],
    ['db-shrug', 'Shrug (Dumbbell)', 'Back', 'Dumbbell', ''],

    // Shoulders
    ['overhead-press', 'Overhead Press (Barbell)', 'Shoulders', 'Barbell', ''],
    ['db-shoulder-press', 'Shoulder Press (Dumbbell)', 'Shoulders', 'Dumbbell', ''],
    ['arnold-press', 'Arnold Press', 'Shoulders', 'Dumbbell', ''],
    ['machine-shoulder-press', 'Shoulder Press (Machine)', 'Shoulders', 'Machine', ''],
    ['lateral-raise', 'Lateral Raise (Dumbbell)', 'Shoulders', 'Dumbbell', ''],
    ['cable-lateral-raise', 'Single-Arm Cable Lateral Raise', 'Shoulders', 'Cable', 'arm'],
    ['front-raise', 'Front Raise (Dumbbell)', 'Shoulders', 'Dumbbell', ''],
    ['rear-delt-fly', 'Rear Delt Fly (Dumbbell)', 'Shoulders', 'Dumbbell', ''],
    ['reverse-pec-deck', 'Reverse Pec Deck', 'Shoulders', 'Machine', ''],
    ['face-pull', 'Face Pull', 'Shoulders', 'Cable', ''],
    ['upright-row', 'Upright Row', 'Shoulders', 'Barbell', ''],
    ['landmine-press', 'Single-Arm Landmine Press', 'Shoulders', 'Barbell', 'arm'],

    // Arms
    ['barbell-curl', 'Curl (Barbell)', 'Biceps', 'Barbell', ''],
    ['ez-bar-curl', 'Curl (EZ Bar)', 'Biceps', 'EZ bar', ''],
    ['db-curl', 'Curl (Dumbbell)', 'Biceps', 'Dumbbell', ''],
    ['hammer-curl', 'Hammer Curl', 'Biceps', 'Dumbbell', ''],
    ['incline-db-curl', 'Incline Curl (Dumbbell)', 'Biceps', 'Dumbbell', ''],
    ['concentration-curl', 'Concentration Curl', 'Biceps', 'Dumbbell', 'arm'],
    ['preacher-curl', 'Preacher Curl', 'Biceps', 'EZ bar', ''],
    ['cable-curl', 'Curl (Cable)', 'Biceps', 'Cable', ''],
    ['triceps-pushdown', 'Triceps Pushdown', 'Triceps', 'Cable', ''],
    ['rope-pushdown', 'Rope Pushdown', 'Triceps', 'Cable', ''],
    ['overhead-triceps-ext', 'Overhead Triceps Extension (Cable)', 'Triceps', 'Cable', ''],
    ['db-overhead-ext', 'Overhead Triceps Extension (Dumbbell)', 'Triceps', 'Dumbbell', ''],
    ['skull-crusher', 'Skull Crusher', 'Triceps', 'EZ bar', ''],
    ['single-arm-pushdown', 'Single-Arm Pushdown', 'Triceps', 'Cable', 'arm'],
    ['wrist-curl', 'Wrist Curl', 'Forearms', 'Dumbbell', ''],
    ['farmers-carry', "Farmer's Carry", 'Forearms', 'Dumbbell', ''],

    // Legs
    ['back-squat', 'Back Squat (Barbell)', 'Quads', 'Barbell', ''],
    ['front-squat', 'Front Squat (Barbell)', 'Quads', 'Barbell', ''],
    ['goblet-squat', 'Goblet Squat', 'Quads', 'Dumbbell', ''],
    ['hack-squat', 'Hack Squat', 'Quads', 'Machine', ''],
    ['smith-squat', 'Squat (Smith Machine)', 'Quads', 'Smith machine', ''],
    ['leg-press', 'Leg Press', 'Quads', 'Machine', ''],
    ['single-leg-press', 'Single-Leg Press', 'Quads', 'Machine', 'leg'],
    ['leg-extension', 'Leg Extension', 'Quads', 'Machine', ''],
    ['bulgarian-split-squat', 'Bulgarian Split Squat', 'Quads', 'Dumbbell', 'leg'],
    ['walking-lunge', 'Walking Lunge (Dumbbell)', 'Quads', 'Dumbbell', 'leg'],
    ['reverse-lunge', 'Reverse Lunge (Dumbbell)', 'Quads', 'Dumbbell', 'leg'],
    ['step-up', 'Step-Up (Dumbbell)', 'Quads', 'Dumbbell', 'leg'],
    ['romanian-deadlift', 'Romanian Deadlift (Barbell)', 'Hamstrings', 'Barbell', ''],
    ['db-romanian-deadlift', 'Romanian Deadlift (Dumbbell)', 'Hamstrings', 'Dumbbell', ''],
    ['single-leg-rdl', 'Single-Leg Romanian Deadlift', 'Hamstrings', 'Dumbbell', 'leg'],
    ['lying-leg-curl', 'Lying Leg Curl', 'Hamstrings', 'Machine', ''],
    ['seated-leg-curl', 'Seated Leg Curl', 'Hamstrings', 'Machine', ''],
    ['good-morning', 'Good Morning', 'Hamstrings', 'Barbell', ''],
    ['nordic-curl', 'Nordic Curl', 'Hamstrings', 'Bodyweight', ''],
    ['hip-thrust', 'Hip Thrust (Barbell)', 'Glutes', 'Barbell', ''],
    ['glute-bridge', 'Glute Bridge', 'Glutes', 'Bodyweight', ''],
    ['cable-kickback', 'Cable Glute Kickback', 'Glutes', 'Cable', 'leg'],
    ['hip-abduction', 'Hip Abduction (Machine)', 'Glutes', 'Machine', ''],
    ['hip-adduction', 'Hip Adduction (Machine)', 'Quads', 'Machine', ''],
    ['kb-swing', 'Kettlebell Swing', 'Glutes', 'Kettlebell', ''],
    ['standing-calf-raise', 'Standing Calf Raise', 'Calves', 'Machine', ''],
    ['seated-calf-raise', 'Seated Calf Raise', 'Calves', 'Machine', ''],
    ['single-leg-calf-raise', 'Single-Leg Calf Raise', 'Calves', 'Dumbbell', 'leg'],

    // Core / full body
    ['plank', 'Plank', 'Core', 'Bodyweight', '', 'timed'],
    ['hanging-leg-raise', 'Hanging Leg Raise', 'Core', 'Bodyweight', ''],
    ['cable-crunch', 'Cable Crunch', 'Core', 'Cable', ''],
    ['ab-wheel', 'Ab Wheel Rollout', 'Core', 'Bodyweight', ''],
    ['russian-twist', 'Russian Twist', 'Core', 'Bodyweight', ''],
    ['pallof-press', 'Pallof Press', 'Core', 'Cable', ''],
    ['decline-sit-up', 'Decline Sit-Up', 'Core', 'Bodyweight', ''],
    ['power-clean', 'Power Clean', 'Full body', 'Barbell', ''],
    ['clean-and-jerk', 'Clean and Jerk', 'Full body', 'Barbell', ''],
    ['snatch', 'Snatch', 'Full body', 'Barbell', ''],
    ['thruster', 'Thruster (Barbell)', 'Full body', 'Barbell', '']
  ];

  var MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
    'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full body'];

  var EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight',
    'Kettlebell', 'Smith machine', 'EZ bar', 'Trap bar', 'Band', 'Other'];

  // Generated from free-exercise-db (see tools/build-exercises.js). Curated rows stay first and keep
  // their IDs, because saved workouts refer to exercises by ID.
  var LIBRARY = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? (function () { try { return require('./exercise-library.js'); } catch (e) { return { rows: [], aliases: {} }; } })()
    : root.PRF.exerciseLibrary;

  var BUILT_IN = ROWS.map(function (r) {
    return { id: r[0], name: r[1], muscle: r[2], equipment: r[3], side: r[4], custom: false, alias: LIBRARY.aliases[r[0]] || '', tracking: r[5] || '' };
  }).concat(LIBRARY.rows.map(function (r) {
    return { id: r[0], name: r[1], muscle: r[2], equipment: r[3], side: r[4], custom: false, library: true, tracking: r[5] || '' };
  }));

  // How a lift is logged. Stored on each workout entry and set when it's logged.
  var TRACKING = [
    { id: 'weight', label: 'Weight × reps', hint: 'Most lifts' },
    { id: 'bodyweight', label: 'Reps only', hint: 'Body weight, nothing added' },
    { id: 'weighted', label: 'Added weight × reps', hint: 'Body weight plus a belt or vest' },
    { id: 'assisted', label: 'Assistance × reps', hint: 'Machine or band help; less is harder' },
    { id: 'timed', label: 'Seconds', hint: 'Holds like a plank' }
  ];
  function defaultTracking(ex) {
    return ex.tracking || (ex.equipment === 'Bodyweight' ? 'bodyweight' : 'weight');
  }

  var api = { BUILT_IN: BUILT_IN, MUSCLES: MUSCLES, EQUIPMENT: EQUIPMENT, TRACKING: TRACKING, defaultTracking: defaultTracking };

  root.PRF = root.PRF || {};
  root.PRF.exercises = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
