# PR Forge (web) — project context for Claude Code

A free, phone-first strength-training log that runs in the browser. Restarted from scratch on 1 Nov 2026 as a **web app** (no App Store, no native iOS). The older Expo app lives in `C:\PR FORGE` and must not be touched or deleted.

Philosophy: **Make logging effortless. Make progress obvious. Keep the lifter in control.**

## Where things are

- Code: this folder, `C:\PR FORGE 2`. Plain HTML/CSS/JS, no build step. One dependency: supabase-js, bundled in `js/vendor/`.
  - `index.html`, `css/app.css`
  - `js/units.js` (lb/kg), `js/metrics.js` (volume, e1RM, PRs, trends, hints), `js/store.js` (localStorage + backup; unknown fields are dropped on load, so new saved fields must be added there; settings, customs and templates also go through `sync.profileOf`), `js/sync.js` (cloud sync rules, pure), `js/cloud.js` (Google sign-in via Supabase, network, sync timing), `js/vendor/supabase.js` (supabase-js 2.118.0 UMD, MIT), `js/plates.js` (plate calculator), `js/importers.js` (Fitbod CSV), `js/exercises.js` (built-in list and logging types), `js/app.js` (all UI)
  - `sw.js` (offline cache; bump `CACHE` on every release), `manifest.webmanifest`
  - `tests/logic.test.js`, `tests/sync.test.js`: run `node --test` in this folder (Node 20+). 35 tests, all passing as of 2 Nov 2026.
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
- Privacy page: `privacy.html` (linked from the sign-in screen and Google Branding). Update it, and its date, if what's stored or where changes.

## Decisions (from the PRD, answered by Kevin)

- Friends will use it too; each person's data is private to their own Google account. Setup must explain itself.
- The current build is the starting point; trim and extend it, don't rebuild.
- Keep the branded splash (≥ 3 s). Exception (1.5.2): it's skipped when Google sends someone back after sign-in, since they saw it seconds earlier. The logo is Kevin's artwork (original at `C:\PR FORGE\assets\pr-forge-logo.png`; sized copies in `icons/`). Never invent or redraw one. The splash uses `icons/splash-logo.png`: the badge's mark and lettering with the dark badge background made transparent (pixels unchanged, made from `icons/logo.png`), so no square shows on the launch screen. The app icons (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) are the P mark only, no lettering, on the badge's background.
- Exercise library: much bigger. Uses free-exercise-db (800+), factual fields only (name, muscles, equipment), no images or instructions.
- Notes / RPE: probably yes, optional (off until enabled). Not confirmed.
- Old workouts: from **Fitbod**. The CSV import is built from the column layout in a public converter, not yet checked against a real export from Kevin. The `multiplier` column is ignored because its meaning is unconfirmed.
- Changed 2 Nov 2026 (Kevin): **Google sign-in is required**, and data is backed up to the cloud per person (Supabase Postgres + Supabase Auth with Google; site stays on GitHub Pages). The phone's copy stays the working copy so logging works offline; sync runs when online. Backup files still work.
- First open shows a one-time joke question ("Are you a sexy ass bitch?", both buttons say yes), then sign-in, then setup. Kevin's choice; keep it.
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

Not built yet from the old Expo app: lifetime milestones, weekly recap card, pinned lifts, duplicate saved workout, target reps, load a past workout as new, exercise info/cues, equipment filter in the picker, custom plate sets, rest-done notification, Strong/Hevy import, CSV export, themes.

## How Kevin wants code work done

- Never claim code was installed, run, or tested unless it was; say what's unverified.
- Deliver complete updated files or a reliable patch, not snippets.
- Audit before rewriting, keep existing features working, make the smallest coherent change, explain tradeoffs, and ask only when a missing decision affects correctness.
- End each delivery with: summary of changes, files changed, dependency changes, migrations, test results and known limitations, exact run instructions, prioritized remaining work.
