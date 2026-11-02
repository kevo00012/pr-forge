# PR Forge (web)

A phone-first strength-training log that runs in the browser. No app store, no account, no server: workouts are saved in the browser on your phone.

> Make logging effortless. Make progress obvious. Keep the lifter in control.

Live at: **https://kevo00012.github.io/pr-forge/**

## What's in it

- **Today:** this week's day strip, an "Up next" workout (the saved workout you've gone longest without doing), and highlights (this week's volume, vs last week, PRs this week). It never shows -100%.
- **Workouts:** saved workouts (exercises + number of sets). Starting one fills in last session's numbers as faded hints. Hints only count once you confirm the set.
- **Active workout:** one exercise open at a time with its current set outlined in orange; tap any other exercise to open it. Weight / reps / ✓ for each set. Tap a set number to mark it as a warm-up. Per-arm and per-leg exercises show "Per arm"/"Per leg" and are never double-counted. You get a rest timer, a full-screen PR panel when a working set beats your previous best estimated 1RM (never on the first session of a lift or on warm-ups), and you can switch tabs while a workout is running. Finishing shows a "Workout saved" summary.
- **Progress:** per-lift trend rows (Progressing / Holding / Stalled / Building data) with a plain explanation of how they're worked out, personal records, lb/kg, rest timer length, backup export/restore, and erase.
- **History:** finished workouts by month, with details, "Save as a workout", and delete.
- About 100 built-in exercises plus your own custom ones. Works offline once it has loaded over the internet.

## Try it on your PC

Double-click `index.html`. It opens in your browser and works. (Offline caching only switches on once it's hosted.)

## Publish it with GitHub Pages (one time)

1. Sign in at github.com as **kevo00012**.
2. Top-right **+** → **New repository**. Name it `pr-forge`, set it to **Public** (free Pages needs public), and click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Open `C:\PR FORGE 2` in File Explorer, select **everything inside it** (the `css`, `js`, `icons`, `tests` folders and all the files), and drag it onto the upload area. Wait for the list to finish, then click **Commit changes**.
5. Open the repo's **Settings** → **Pages**. Under "Build and deployment", set Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)**, and click **Save**.
6. After a minute or two the app is live at **https://kevo00012.github.io/pr-forge/**.

### Put it on your iPhone

1. Open the address in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. **Always open PR Forge from the home-screen icon.** The home-screen app keeps its own data, separate from the Safari tab, and iOS can clear website data that hasn't been used for a while, but not home-screen apps.

### Updating later

Upload the changed files to the repo again (same "Add file → Upload files" button, then commit). Before uploading, bump the version in `sw.js` (`CACHE = 'pr-forge-web-1.1.2'`) so phones fetch the new files.

## Your data

- Everything is stored on the device, in the browser (`localStorage`, key `pr-forge:web:v1`). Nothing is sent anywhere, and the fonts are bundled in `fonts/` (Barlow, SIL Open Font License; see `fonts/OFL.txt`), so the app makes no outside requests.
- **Export a backup regularly** (Progress → Settings & data → Export backup) and keep it in Files/iCloud. Restoring a backup replaces the data on that device. A safety copy of what was there is kept under `pr-forge:web:v1:before-restore`.

## Logo

The splash screen shows `icons/logo.png` if it exists, otherwise just the text "PR FORGE". To use your logo, add these files to the `icons` folder:

- `logo.png`: the splash logo (square, transparent or black background)
- `apple-touch-icon.png`: 180×180, the iPhone home-screen icon
- `icon-192.png` and `icon-512.png`: Android/desktop install icons

## For developers

- Plain HTML/CSS/JavaScript, no build step, no dependencies.
- `js/units.js`, `js/metrics.js`, `js/store.js`, and `js/exercises.js` are pure logic. `js/app.js` is the UI.
- Tests: open a terminal in this folder and run `node --test` (needs Node 20+).
- Local server: run `node tools/serve.js`, then open http://localhost:8000/. The offline cache stays off on localhost, so a refresh always shows your latest edits.
- Never commit backups or Fitbod exports: they hold personal training data and this repo is public. `.gitignore` blocks `pr-forge-backup-*.json` and `*.csv`.
