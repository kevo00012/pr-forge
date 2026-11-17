# PR Forge — product, UX and engineering review

17 November 2026, against app 1.6.9 (fixes shipped in 1.7.0). Every finding below was checked against the code, and the confirmed bugs were reproduced with data before fixing. "Potential problem" means the code allows it but I didn't see it happen.

## Summary

The foundation is solid. Unit conversion, volume (per-arm/per-leg not doubled, assisted sets excluded), weekly totals, PR eligibility, escaping of user text, sync deletions (tombstones) and double-tap protection on Finish all checked out. Performance is fine: with 300 workouts the slowest calculation (lift trends) takes about 30 ms.

The real problems were in **what the numbers say**, not in saving them: an old imported peak made a lifter who is clearly getting stronger read "Stalled", light high-rep sets could beat heavy ones on estimated 1RM, and set hints ignored a weight change made earlier in the same workout. Those are fixed in 1.7.0.

## Imported Fitbod data

Imported durations and dates are **display-only problems**. No calculation uses a workout's duration; trends, records, weekly volume and PRs use the date and the sets. So the odd durations don't compromise any number. Nothing was deleted or changed in imported records.

What changed: History marks imported workouts "Imported" and hides a duration outside 10 min–5 h (Fitbod exports give one timestamp per day, so durations are 0 or meaningless). Records say "Best is from an import (date)" when the all-time best came from Fitbod.

Two limits worth knowing, both low risk: Fitbod sessions on the same day are merged into one workout, and kg exports are converted to the app's unit at import with 0.5 rounding, so the original value isn't kept. Neither affects trends noticeably.

## 1. Confirmed bugs (fixed in 1.7.0)

| # | Problem | Evidence | Fix |
|---|---|---|---|
| B1 | A comeback lifter shows **Stalled** | +5 lb/week for 6 weeks after an old 225×5 Fitbod peak → "No new best in 8 sessions" | Trend status and the big number use the last 90 days; the all-time best is shown beside it when higher |
| B2 | Estimated 1RM rewards very high reps | 135×20 → 225.0, the same as 205×3 → 225.5 | Reps above 12 count as 12 |
| B3 | Set hints ignore today's weight change | Sets 1–2 logged at 205, sets 3–4 hinted 203 from last time; an empty ✓ saved 203 | Hints carry today's weight forward when it differs from last session's plan |
| B4 | Clearing reps after confirming saves a broken set | A confirmed set with blank reps was kept on Finish | Finish drops those and says so; tap Cancel to fill them in |

Tests: 5 new (46 total), covering each fix and that genuine stalls, pyramids and the old behaviour without history still work.

## 2. Potential problems (not fixed, ranked)

1. **Workout in progress isn't synced.** If the phone's storage is cleared mid-workout (iOS can do this to home-screen apps), that workout is lost. Finished workouts are safe. Fix: save the active workout to the profile row every minute or so.
2. **Supabase free tier pauses after a week without use and has no automatic backups.** Phones keep their own copy, so nothing is lost, but sign-in fails until the project is resumed. Fix: a weekly scheduled export, or a reminder to download a backup file.
3. **Google client secret still to rotate** (shared in chat on 2 Nov).
4. **Rest timer** lives only in memory; reloading the app mid-rest loses it. Minor.
5. **Old workout left open**: nothing tells you a workout started yesterday is still running. Fix: a "Still going? Finish or discard" banner after 6 h.
6. **Offline logging then sync** has never been tested on a phone in airplane mode.

## 3. UX improvements

- **Warm-ups are hard to find** (tap the set number). A small "Add warm-up" button next to "Add set" would fix it.
- **Rep targets** from pasted plans are shown in the preview and then thrown away. Saving them would make hints much better for new routines.
- **Chart ranges**: trends show the last 8 sessions only; 3 months / 1 year / all would answer "am I stronger than last year?".
- **Duplicate routine** is missing (common when making week B from week A).
- **Strength total** (new, on trial): please judge after a couple of weeks whether it motivates or just adds noise.

## 4. Features, compared with other apps

| | Hevy | Strong | Fitbod | JEFIT | Alpha Progression | PR Forge |
|---|---|---|---|---|---|---|
| Fast set logging | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hints from last time | ✓ | ✓ | n/a (generates) | ✓ | ✓ | ✓ (now follows today) |
| Progression suggestions | partial | – | ✓ | partial | ✓ | – |
| Sets per muscle per week | ✓ | – | muscle recovery | ✓ | ✓ | – |
| Supersets | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| RPE / RIR | ✓ | ✓ | – | – | ✓ | – |
| Free, no ads, no account wall beyond Google | – | – | – | – | – | ✓ |
| Plain-word trends | – | – | – | – | – | ✓ |

(From my general knowledge of these apps, not checked against their current versions.)

Where PR Forge can win without becoming a clone: honest, plain-language progress ("Progressing / Stalled", strength total in real pounds), zero setup friction, and sharing routines as text with friends. The biggest gaps that users notice day to day are **progression suggestions** and **weekly sets per muscle**.

## 5. Roadmap

Difficulty: S = an hour or two, M = a day, L = several days.

| Pri | Item | Problem | Why it matters | Recommendation | Diff. | DB change | Regression risk |
|---|---|---|---|---|---|---|---|
| P0 | B1–B4 | See above | Wrong numbers erode trust | Done in 1.7.0 | S | No | Low (tested) |
| P0 | Rotate Google secret | Secret was shared in chat | Account security | New secret in Google → Supabase → delete old | S | No | Low |
| P1 | Sync the active workout | Lost if storage clears mid-workout | Data loss | Store `active` in the profile row, restore if newer | M | No (profile JSON) | Medium (sync rules) |
| P1 | Stale workout banner | Forgotten workouts distort dates | Data quality | Banner after 6 h | S | No | Low |
| P1 | Airplane-mode test | Unverified core promise | Offline is a Must | Manual test on iPhone | S | No | None |
| P1 | Backups beyond Supabase free tier | Pausing and no backups | Recovery | Weekly reminder or scheduled export | S–M | No | Low |
| P2 | Rep targets in routines | Pasted targets thrown away | Better hints for new plans | Save `reps` per routine set, use as hint when no history | M | No (JSON) | Medium |
| P2 | Progression suggestion | Users decide every increase themselves | Top competitor feature | "Hit all reps last time → +5 lb" hint, never automatic | M | No | Medium |
| P2 | Weekly sets per muscle | Can't see balance | Common request | Count working sets by primary muscle on Progress | M | No | Low |
| P2 | Warm-up button, duplicate routine | Discoverability | Friction | Small buttons | S | No | Low |
| P2 | Chart ranges | Only 8 sessions | Long-term view | 3 mo / 1 yr / All on the exercise page | M | No | Low |
| P3 | Supersets, RPE, body weight, per-exercise rest, CSV export, themes | Nice to have | Parity | One at a time, on request | M–L each | No | Medium |

## 6. Implementation plan

- **Phase 1 (done, 1.7.0):** B1–B4, imported labels, strength total trial.
- **Phase 2 (done, 1.7.1):** rep targets in routines, progression suggestions, stale-workout banner. Syncing the workout in progress was moved to later (losing one needs the phone's storage wiped mid-workout).
- **Phase 3:** sets per muscle, backup reminder, warm-up button, duplicate routine, chart ranges.
- **Phase 4:** the P3 list, as you want them.
