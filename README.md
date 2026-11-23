# PR Forge (web)

A phone-first strength-training log that runs in the browser. No app store. Sign in with Google; workouts are saved on your phone and backed up to your own account (Supabase), so they come back on a new phone.

> Make logging effortless. Make progress obvious. Keep the lifter in control.

Live at: **https://kevo00012.github.io/pr-forge/**

## What's in it

- **Today:** this week's day strip, an "Up next" routine (the one you've gone longest without doing), and highlights (this week's volume, vs last week, PRs this week). It never shows -100%.
- **Routines:** your saved routines (exercises + number of sets). Starting one fills in last session's numbers as faded hints; hints only count once you confirm the set. **New** offers: build from scratch, paste or import a plan (text, PDF, CSV), or start an empty workout. **Share** on a routine sends it as plain text (Messages, AirDrop…); a friend pastes it into Paste or import a plan to get the same routine.
- **First open:** a joke question (at most once a day), then Google sign-in (required), then a welcome screen that explains the backup, how to add it to the home screen, and sets units and rest timer. It also offers Fitbod import.
- **Active workout:** one exercise open at a time with its current set outlined in orange; tap any other exercise to open it. An open exercise can be swapped for another or moved up or down. Barbell lifts show the plates per side under the current set (bar weight is in Settings). Each lift can be logged as weight × reps, reps only, added weight, assistance or seconds, and the choice is remembered. Weight / reps / ✓ for each set. Tap a set number to mark it as a warm-up. Per-arm and per-leg exercises show "Per arm"/"Per leg" and are never double-counted. You get a rest timer, a full-screen PR panel when a working set beats your previous best estimated 1RM (never on the first session of a lift or on warm-ups), and you can switch tabs while a workout is running. Finishing shows a "Workout saved" summary.
- **Progress:** two views. **Trends**: weekly volume chart and training frequency, per-lift trends (Progressing / Holding / Stalled / Down / Paused / Building data) grouped by what needs attention, with a plain explanation of how they're worked out. **Records**: personal records per lift (main lifts first, the rest behind Show all). Trends shows big cards only for your main lifts (pinned, or your 5 most-trained), then a short Needs attention list, then All lifts. Tapping a trend or a record opens that exercise's page (chart, record, sessions, ideas to try, how it's logged; rename/delete for your own exercises). **All exercises** lists every exercise you've logged, put in a routine or created.
- **Settings** (sliders button, top-right of every tab): Account & backup (sign-in, backup status, backup file), Logging (units, rest timer, bar weight, Exercises), Import (Fitbod history with undo; routines from a pasted plan or file), Erase.
- **History:** finished workouts by month, with details, editing (name, date, sets, exercises), "Save as routine", and delete. Edited and imported workouts never count as PRs, but later sessions still have to beat them.
- 895 built-in exercises (common ones listed first) plus your own custom ones. Works offline once it has loaded over the internet.

## Try it on your PC

Run `node tools/serve.js` and open http://localhost:8000/. Google sign-in needs a real web address, so opening `index.html` by double-clicking no longer works past the sign-in screen. (Offline caching only switches on once it's hosted.)

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

Upload the changed files to the repo again (same "Add file → Upload files" button, then commit). Before uploading, bump the version in `sw.js` (`CACHE = 'pr-forge-web-2.0.1'`) so phones fetch the new files.

## Your data

- The working copy is on the phone, in the browser (`localStorage`, key `pr-forge:web:v1`), so logging works offline. When online, finished workouts, settings, saved workouts and custom exercises are copied to the person's own rows in Supabase (project `pvtcqdtqycihlontmirl`). Row level security means each signed-in person can only read and write their own rows. The workout in progress stays on the phone until it's finished.
- Sync rules are in `js/sync.js`; sign-in and network calls in `js/cloud.js`; the database setup in `supabase/schema.sql` (paste into Supabase → SQL Editor and run). If the same workout is changed on two phones before either syncs, the phone that syncs last wins.
- Signing out removes the phone's copy (the cloud copy stays). If a different account signs in on the same phone, the old data is kept aside under `pr-forge:web:v1:other-account:<id>`.
- Backup files still work (Progress → Settings & data). Restoring one replaces everything, on the phone and in the account. A safety copy of what was there is kept under `pr-forge:web:v1:before-restore`.
- Outside requests: only to Supabase (sign-in and backup) and Google (sign-in). Fonts are bundled in `fonts/` (Barlow, SIL Open Font License; see `fonts/OFL.txt`).

## Logo

The `icons` folder holds the logo, cropped to its badge and resized from the original artwork:

- `logo.png`: the full badge, used on the first-open and sign-in screens
- `splash-logo.png`: the badge's P mark and "PR FORGE" lettering lifted off its dark background (same pixels, background made transparent), used on the splash; if it can't load, the splash shows the text "PR FORGE"
- `wordmark.png`: the logo's "PR FORGE" lettering on a transparent background, used in the Today header
- `apple-touch-icon.png`: 180×180, the iPhone home-screen icon. The icons show only the P mark (no lettering, which is unreadable at icon size) on the badge's own dark background, full-bleed so the phone rounds the corners
- `icon-192.png` and `icon-512.png`: Android/desktop install icons and the browser tab icon

## For developers

- Plain HTML/CSS/JavaScript, no build step. One dependency: supabase-js 2.118.0 (MIT), bundled as `js/vendor/supabase.js` (the package's UMD build; licence in `js/vendor/supabase.LICENSE`) so it works offline. PDF.js (pdfjs-dist 6.4.299 legacy build, Apache-2.0, licence in `js/vendor/pdfjs/LICENSE`) is in `js/vendor/pdfjs/`, loaded only when someone opens a PDF in Paste a workout.
- `js/units.js`, `js/metrics.js`, `js/store.js`, `js/plates.js`, `js/importers.js`, `js/sync.js` and `js/exercises.js` are pure logic. `js/cloud.js` handles Google sign-in and talks to Supabase. `js/app.js` is the UI.
- Tests: open a terminal in this folder and run `node --test` (needs Node 20+).
- Exercise list: `js/exercise-library.js` is generated from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense) by `node tools/build-exercises.js path/to/exercises.json`. Only names, muscles and equipment are kept. Per-arm and per-leg labels are worked out from exercise names.
- Local server: run `node tools/serve.js`, then open http://localhost:8000/. The offline cache stays off on localhost, so a refresh always shows your latest edits.
- Never commit backups or Fitbod exports: they hold personal training data and this repo is public. `.gitignore` blocks `pr-forge-backup-*.json` and `*.csv`.
