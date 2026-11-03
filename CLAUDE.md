# PR Forge (web) — project context for Claude Code

A free, phone-first strength-training log that runs in the browser. Restarted from scratch on 1 Nov 2026 as a **web app** (no App Store, no native iOS). The older Expo app lives in `C:\PR FORGE` and must not be touched or deleted.

Philosophy: **Make logging effortless. Make progress obvious. Keep the lifter in control.**

## Where things are

- Code: this folder, `C:\PR FORGE 2`. Plain HTML/CSS/JS, no build step. Two dependencies, both bundled in `js/vendor/`: supabase-js and PDF.js (only loaded when a PDF workout is opened).
  - `index.html`, `css/app.css`
  - `js/units.js` (lb/kg), `js/metrics.js` (volume, e1RM, PRs, trends, hints), `js/store.js` (localStorage + backup; unknown fields are dropped on load, so new saved fields must be added there; settings, customs and templates also go through `sync.profileOf`), `js/sync.js` (cloud sync rules, pure), `js/cloud.js` (Google sign-in via Supabase, network, sync timing), `js/vendor/supabase.js` (supabase-js 2.118.0 UMD, MIT), `js/plates.js` (plate calculator), `js/importers.js` (Fitbod CSV), `js/exercises.js` (built-in list and logging types), `js/app.js` (all UI)
  - `sw.js` (offline cache; bump `CACHE` on every release, which is also what makes phones show "Update ready"), `manifest.webmanifest`. Since 1.6.2 the app checks for a new `sw.js` when it comes to the front and every 30 min; when a new one takes over, an "Update ready · Reload" bar shows at the top of the screen (never on the logging or edit-workout screens; the app never reloads by itself). The home-screen icon is copied by iOS when the app is added, so only an icon change needs a re-add.
  - `tests/logic.test.js`, `tests/sync.test.js`: run `node --test` in this folder (Node 20+). 40 tests, all passing as of 3 Nov 2026.
  - `supabase/schema.sql`: database tables, row level security and grants; run in Supabase → SQL Editor. Project URL `https://pvtcqdtqycihlontmirl.supabase.co`; the publishable key is in `js/cloud.js` (public by design). Never commit the secret key, database password or Google client secret.
- Requirements doc (PRD): https://claude.ai/artifact/BRwXUQBAEp5rhWqbmuTFsv
- Brand guide ("PR Forge Brand", 3 Nov 2026): https://claude.ai/artifact/Afwbg2BV4CiH7j4hCP2wCk. Logo versions and when to use each, colour tokens with contrast notes, type scale, layout, voice and tone. Clear-space and minimum-size rules in it were proposed by Claude, not yet confirmed by Kevin. Update it when colours, type or logo files change.
- Redesign canvas ("Forge Scoreboard"): https://claude.ai/artifact/AXMdMVNRanCEWaTCV2Czys
  - Copies of the screen designs are in `design/` (`*.dc.html`). They are design mockups, not app code: read them for layout, type, spacing, and colours.
  - `tools/serve.js`: local dev server (`node tools/serve.js` → http://localhost:8000/; `pr-forge` in `.claude/launch.json`).
- Repo: https://github.com/kevo00012/pr-forge (public, branch `main`). Commits use the GitHub no-reply email, set in this repo's git config. Never commit backups or Fitbod exports; `.gitignore` blocks them.
- Hosting: GitHub Pages, live at https://kevo00012.github.io/pr-forge/ since 1 Nov 2026. It deploys from `main` (root) on every push, so anything pushed goes live.
- Sign-in: Google Cloud project "PR Forge", Google Auth Platform, OAuth web client "PR Forge web". JavaScript origins `https://kevo00012.github.io` and `http://localhost:8000`; redirect URI `https://pvtcqdtqycihlontmirl.supabase.co/auth/v1/callback`. Branding has the home page and `privacy.html` links. Published ("In production") on 2 Nov 2026, so any Google account can sign in. Supabase URL Configuration: Site URL `https://kevo00012.github.io/pr-forge/`, redirect URLs that plus `http://localhost:8000/`.
- Sign-in flow: `js/cloud.js` uses Supabase's **implicit** flow (since 1.5.2), not PKCE. PKCE hung on iPhone (Safari and home-screen app) because the code verifier saved before leaving for Google was missing on return; implicit carries the session in `#access_token`. Don't switch back without testing on an iPhone. After a return from Google the app stops waiting within ~0.5 s of supabase-js finishing (20 s cap) and shows why on the sign-in screen.
- Sign-in handover (1.6.3): from the iPhone home-screen app, Google finishes in a browser sheet with separate storage, so the app forgot the sign-in on every close (Kevin, 3 Nov). The app now sends a one-time nonce in the return address (`?h=`, needs `https://kevo00012.github.io/pr-forge/**` in Supabase Redirect URLs); a page that returns with a nonce it didn't make (the sheet) stores the refresh token via `prf_handoff_put` and forgets its own copy *without* a server sign-out (that would end the session being handed over), then shows "You're signed in, tap Done". The app collects it with `prf_handoff_take` (anon, one use, 5 min) on focus/visibility and every 2 s while waiting, then `refreshSession`. Same-window sign-in (desktop, Android) skips the handover. Table and functions are at the end of `supabase/schema.sql`. Verified only against a mocked Supabase in two browser contexts, not yet on an iPhone.
- Privacy page: `privacy.html` (linked from the sign-in screen and Google Branding). Update it, and its date, if what's stored or where changes.

## Decisions (from the PRD, answered by Kevin)

- Friends will use it too; each person's data is private to their own Google account. Setup must explain itself.
- The current build is the starting point; trim and extend it, don't rebuild.
- Keep the branded splash (≥ 3 s). Exception (1.5.2): it's skipped when Google sends someone back after sign-in, since they saw it seconds earlier. The logo is Kevin's artwork (original at `C:\PR FORGE\assets\pr-forge-logo.png`; sized copies in `icons/`). Never invent or redraw one. The splash uses `icons/splash-logo.png`: the badge's mark and lettering with the dark badge background made transparent (pixels unchanged, made from `icons/logo.png`), so no square shows on the launch screen. The app icons (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) are the P mark only, no lettering, on the badge's background.
- Exercise library: much bigger. Uses free-exercise-db (800+), factual fields only (name, muscles, equipment), no images or instructions.
- Notes / RPE: probably yes, optional (off until enabled). Not confirmed.
- Old workouts: from **Fitbod**. The CSV import is built from the column layout in a public converter, not yet checked against a real export from Kevin. The `multiplier` column is ignored because its meaning is unconfirmed.
- Changed 2 Nov 2026 (Kevin): **Google sign-in is required**, and data is backed up to the cloud per person (Supabase Postgres + Supabase Auth with Google; site stays on GitHub Pages). The phone's copy stays the working copy so logging works offline; sync runs when online. Backup files still work.
- The joke question ("Are you a sexy ass bitch?", both buttons say yes) is Kevin's choice; keep it. Since 1.6.1 it shows at most once a day: the first open of each day on that phone (signed in or not), never during a workout in progress or while Google is sending someone back. The day is stored on the phone (`pr-forge:web:v1:greeted-on`), not synced. No logo on that screen, nor on Sign in or "Loading your workouts…" (Kevin, 3 Nov; the Welcome/setup screen still has it); the two buttons are two different random picks from `GREET_YES` in `js/app.js` (all mean yes, some slang), chosen once each time it shows. Before 1.6.1 it showed only before sign-in and could flash again after returning from Google.
- Feature priorities (Must): log sets, saved workouts, last-time hints, history, lb/kg, offline, backup/restore, edit past workouts, custom exercises, per-arm/per-leg, PR banner, lift trends, personal records, plate calculator. Should: warm-ups, rest timer (make it optional), Today home, splash. Later: imports, notes/RPE, body weight, themes. Cut: PR share card.

## Product rules that must hold

- Per-arm / per-leg exercises show "Per arm"/"Per leg" and never double-count volume.
- Faded hints from last session only count once a set is confirmed; working-set hints come from working sets, warm-ups from warm-ups.
- No PR on a lift's first-ever session, on warm-ups, on assisted sets, or on imported/edited past data. Imported/edited numbers still raise the bar for later sessions.
- Weekly comparison never shows -100%.
- Trends are explained in plain words (Progressing / Holding / Stalled / Down / Paused / Building data), never a fake-scientific score.
- Layout must work at 375 px and 390 px widths.

## Design direction ("Forge Scoreboard")

- Ground `#0D0C0B`, surface `#171513`, raised `#211E1B`, lines `#2E2A26`, text `#F6F3EF`, secondary `#A8A098`, accent `#FF7A32`, text on accent `#1A0B03`, stalled amber `#F5B94A` on `#2A2213`.
- Type: Barlow Condensed (700–800, uppercase) for headings and all numbers; Barlow for body. Tabular numerals.
- Orange only for "act" or "win" (primary button, confirmed set, current set, PRs).
- Logging screen: active set outlined in orange, ghost hints in empty inputs, plate calculator under the active set, rest timer dock above the tab bar.
- PR moment: full-width orange panel, huge weight × reps, e1RM and gain, last-8-sessions bars.
- Touch targets ≥ 44 px.

## Next work (in order)

0. Done (2 Nov 2026, app 1.5.0, PR #2): Google sign-in + cloud sync. Confirmed by Kevin on an iPhone: sign-in from the home-screen app, workouts uploading to Supabase, and restore on a second device. 3 Nov (1.5.2, PR #5): sign-in hung on "Signing you in…" on iPhone after re-adding the home-screen app; fixed by the implicit flow, confirmed working by Kevin. Also 1.5.1 (PR #4): splash and app icons from the logo without the badge square / lettering, confirmed on iPhone.
   - To do: replace the Google client secret (it was shared in chat on 2 Nov); add a new secret in Google, paste it into Supabase → Google provider, then delete the old one.
   - Left as is (Kevin's choice): Google's sign-in page says "to continue to pvtcqdtqycihlontmirl.supabase.co". Free fix if wanted later: Google's own sign-in button + `signInWithIdToken`, which should show `kevo00012.github.io`, but it needs re-testing in the iPhone home-screen app.
1. Done (1 Nov 2026, app 1.1.0): Forge Scoreboard applied to all screens. Not built from the mockups: Progress time-range toggle (8 wk/6 mo/All), "usual 3 sessions" goal line. Barlow is bundled in `fonts/` (latin subset, Fontsource 5.3.0, OFL) and precached by `sw.js`.
2. Done (1 Nov 2026, app 1.4.0): plate calculator on the active set, barbell lifts only (lb plates 45/35/25/10/5/2.5, kg 25/20/15/10/5/2.5/1.25; bar weight in settings; fewest plates, so 205 lb is 45 + 35 per side).
3. Done (1 Nov 2026, app 1.4.0): edit a past workout from History or the summary.
4. Done (1 Nov 2026, app 1.2.0): free-exercise-db bundled as `js/exercise-library.js` (generated by `tools/build-exercises.js`). 98 curated + 797 added = 895. 79 duplicates merged into curated IDs, whose IDs must never change. Library IDs are `fedb:<source id>`.
5. Done (1 Nov 2026, app 1.4.0): Fitbod CSV import with undo. Next: check it against a real export. 1.5.3: re-importing a file whose days are already imported offers "Add the new days" or "Replace and add" (replaces only imported workouts with the same day, never logged ones), instead of refusing; a friend had to undo the old import to load a newer export.
6. Done (1 Nov 2026, app 1.4.0): first-open setup, plus exercise types (reps only, added weight, assistance, seconds) and Progress extras (Down/Paused, lift detail, weekly chart).
7. Done (1 Nov 2026): published to GitHub Pages. Home-screen app confirmed working on an iPhone (2 Nov). Still to confirm: airplane-mode test (log offline, then check it uploads once back online).

App organisation (1.6.0, from Kevin's 3 Nov audit request; he approved all 8 ideas):
- Saved workouts are called **Routines** in the UI (tab, buttons, toasts); code still says `templates`. "Workout" means one in progress or finished.
- Routines' **New** button opens a menu: Build from scratch / Paste or import a plan / Start an empty workout. Nothing sits below the routine list.
- **Exercises** screen (`V.screen = 'exercises'`, from Progress "All exercises" and Settings → Logging): every exercise logged, in a routine, or custom, with search. Each opens the exercise page (`viewLift`), which now works with no sessions and shows the record, how it's logged (changes `settings.exerciseTypes` for next time) and, for custom exercises, Rename and Delete (delete only when unused).
- **Progress** has Trends | Records tabs (`V.progressView`); records and trends open the exercise page. The leftover Settings button is gone.
- **Settings** groups: Account & backup, Logging (incl. Exercises), Import (Fitbod history; routines from a plan), Erase.
- First-time setup no longer offers Restore backup (sign-in restores data); it keeps "Import past workouts from Fitbod".

Settings (1.5.4): a gear (sliders icon) in the top-right of every tab opens a Settings screen (`V.screen = 'settings'`, `viewSettings` in `js/app.js`) with account, logging settings, Fitbod import, backup file and erase; Progress no longer holds settings. Saving a finished workout as a routine is done from History ("Save as routine"; warm-ups aren't counted as sets). Kevin removed a separate "Copy a past workout" picker on Workouts (3 Nov); don't add it back. Workouts also has "Paste a workout": paste a plan (e.g. one Claude wrote) and `importers.parseWorkoutText` turns each exercise line ("Bench press 4x8", "3 sets of 10", markdown tables, several days at once) into saved workouts, matching names to the exercise list (abbreviations like DB/RDL, plain "bench press" = barbell) and adding unknown ones as custom exercises. Rep targets are shown in the preview but not saved yet (saved workouts only store sets). It also takes a file: PDF (text read with PDF.js, `js/vendor/pdfjs/`, pdfjs-dist 6.4.299 legacy build, Apache-2.0, renamed `.mjs` → `.js` so any server sends the right type; loaded only when a PDF is opened, not precached; first 20 pages; table columns rebuilt from text gaps by `importers.pdfItemsToText`), .txt/.md, or CSV (`importers.csvToPlanText`: with a header, columns found by name in any order — Exercise/Name, Sets, Reps, and Workout/Day/Session to split workouts; without one (1.5.5), text columns are the workout (if its values repeat) and the exercise, then sets and reps; CSV text pasted into the box is detected (`importers.looksLikeCsv`) and read the same way; a Fitbod history CSV is refused and pointed to Settings). Photos/scans and Word files aren't read.

Not built yet from the old Expo app: lifetime milestones, weekly recap card, pinned lifts, duplicate saved workout, target reps, exercise info/cues, equipment filter in the picker, custom plate sets, rest-done notification, Strong/Hevy import, CSV export, themes.

## How Kevin wants code work done

- Never claim code was installed, run, or tested unless it was; say what's unverified.
- Deliver complete updated files or a reliable patch, not snippets.
- Audit before rewriting, keep existing features working, make the smallest coherent change, explain tradeoffs, and ask only when a missing decision affects correctness.
- End each delivery with: summary of changes, files changed, dependency changes, migrations, test results and known limitations, exact run instructions, prioritized remaining work.
