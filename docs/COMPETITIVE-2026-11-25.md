# PR Forge — Competitive intelligence & product gap analysis

Audit #2 of the "Claude Product Audit & Improvement Prompt Pack". Researched 25 November 2026 against PR Forge 2.5.0.

**How this was researched.** Web searches on 25 Nov 2026 covered official pages (JEFIT Elite, Alpha Progression's glossary, Boostcamp Pro), App Store listings (Strong) and 2026 third-party reviews. Most third-party sources are review or affiliate blogs, and several are written by competing apps, so prices and features were only accepted where two or more sources agreed or an official page said so. Nothing was installed or tried hands-on.

**Labels used:**

| Label | Meaning |
|---|---|
| **Full** | Fully supported |
| **Part** | Partially supported, or paid-only |
| **No** | Not supported |
| **?** | Unknown / unverified |

Prices are US App Store, USD, and vary by country.

## 1. Competitor comparison matrix

| Feature | Hevy | Strong | Fitbod | JEFIT | Alpha Progression | Boostcamp | **PR Forge now** | **PR Forge recommendation** |
|---|---|---|---|---|---|---|---|---|
| Price | Free + Pro $2.99/mo, $23.99/yr, $74.99 lifetime | Free + PRO $4.99/mo, $29.99/yr, $99.99 once | $15.99/mo, $95.99/yr; 7-day trial, no free tier | Free (ads) + Elite $12.99/mo, $69.99/yr | Free + Pro $12.99/mo, $79.99/yr | Free + Pro $14.99/mo or $59.99/yr | **Free, no ads, no limits** | Keep free with no paywalls; it's a real differentiator |
| Free-tier limits | Part: 4 routines, 7 custom exercises, 3 months of graphs | Part: 3 routines | No free tier | Part: ads; one source says a 2-plan limit | Full logging; progression is Pro | Full tracking and programs; analytics are Pro | Full | Say so on the sign-in and welcome screens |
| Fast set logging with last time's numbers | Full | Full | Full (generated sets) | Full | Full | Full | Full: ghost hints, one tap per set, hints follow today's weight | Keep; it's the core |
| Routines / templates | Full | Full | Part (it writes the workouts) | Full | Full | Full | Full: unlimited, rep targets, share as text, duplicate, starters | Add routine rotation (A/B/C order) |
| Ready-made programs | Part: Hevy Trainer generator (Pro) | No (you bring your plan) | Full: generated every session | Part: adaptive plan (Elite) | Part: generator (Pro) | Full: 14,000+ programs free (official) | Part: 3 starter plans, paste any plan (text/PDF/CSV) | Don't build a marketplace; keep "paste any plan" |
| Progression suggestions | Part: Trainer (Pro) | No (reviews: no weight suggestions) | Full | Part: suggested weights (Elite) | Part: set-by-set targets incl. RIR (Pro) | Part: Auto Progression (Pro) | Full, free: double progression with a plain reason | Keep it transparent; optionally use RPE |
| Rest timer | Full | ? | ? | ? | Full (free) | Full (free) | Full: survives a restart | Add a "rest over" alert when the app is open |
| Warm-up sets / warm-up calculator | Full warm-up sets; calculator ? | Full: warm-up calculator (listing) | ? | ? | Part: warm-up calculator (Pro) | ? | Part: warm-up button, no calculator | **Add a warm-up calculator** |
| Plate calculator | ? | Full (listing) | ? | ? | Part (Pro) | ? | Full, free | Add custom plate sets |
| Supersets | ? | ? | ? | ? | ? | ? | Full | — |
| PRs and estimated 1RM | ? | Part: charts are PRO | ? | Part: "Progress Index" (Elite) | Full: records free | Part: Strength Score, Max views (Pro) | Full: e1RM, heaviest, reps at a weight; each explained | Keep "explained, never a score" |
| Progress analytics | Part: 3 months free | Part: PRO | Full | Part (Elite) | Part: charts Pro | Part: analytics Pro | Full, free: trends in words, ranges, strength total, what changed | Add a weekly recap card |
| Muscle volume / recovery | ? | ? | Full: recovery % heat map | ? | ? | Part: Muscle Tracker heat map (Pro) | Full, factual: Push · Pull · Legs sets and last trained | Keep facts, no recovery % (rule) |
| Exercise library | ? | ? | ? | Full: 1,400+, many with video | Full: 795 with videos | ? | Part: 895, names only, no instructions | Short cues for the ~100 common lifts; no video |
| Apple Watch | Full (and Wear OS) | Full (listing) | ? | Part (third-party claims) | No (planned) | ? | No: web apps can't run on the Watch | Not possible without a native app |
| Apple Health / integrations | Part: Strava; Health ? | Part: body measurements | Full: Health activity feeds recovery | ? | ? | ? | No: web apps can't write to Health | Not possible without a native app |
| Offline | Part: offline on the watch | ? | ? | ? | ? | ? | Full: works offline, syncs later | Say so in onboarding (done) |
| Social | Full: feed, public by default | ? | ? | ? | ? | Part: community | No | Avoid a feed; maybe private friend sharing later |
| Web access | Full: hevy.com | ? | ? | ? | No | ? | Full: it is a web app | — |
| Import / export | ? | Part: CSV (migration threads) | ? | ? | ? | ? | Part: Fitbod import, CSV export, backup file | **Add Strong and Hevy CSV import** |

## 2. Competitor by competitor

- **Hevy.** The fastest-growing logger: a generous free tier, social, watch apps and a web app. Users who leave Strong tend to land here.
  - Weaknesses for PR Forge's audience: accounts are public by default, the free tier caps routines (4) and graphs (3 months), and one independent review scored its training guidance 2.5/5.
  - Lesson: free logging wins users. PR Forge is free without the caps.
- **Strong.** The classic minimalist logger, with fast logging, warm-up and plate calculators and a full Apple Watch app.
  - Weaknesses: no plan writing or weight suggestions, and charts and measurements are behind PRO. Users mostly ask it for "more advanced programming".
  - Lesson: speed and calculators matter. PR Forge already matches on speed and gives progression and charts free.
- **Fitbod.** AI-generated workouts plus a muscle recovery percentage (0–100% heat map). It's the most expensive, with no free tier.
  - Criticism: the AI isn't always smart, and the recovery figure is a model estimate with no sleep or HRV input.
  - Lesson: PR Forge shouldn't chase generated workouts or recovery percentages. Its factual "last trained" view covers the useful part honestly.
- **JEFIT.** The biggest library (1,400+ exercises, many with video), but ads in the free tier, and the adaptive plan and suggested weights are in Elite.
  - Lesson: library depth and media are its moat. PR Forge shouldn't compete on video; short text cues for common lifts are enough.
- **Alpha Progression.** Hypertrophy-focused, with set-by-set targets that use RIR (reps in reserve), periodization and deloads, all in Pro. No web app, and no watch app yet.
  - Lesson: progression recommendations are valued enough to charge for. PR Forge gives a transparent version free. Optional RPE-aware progression could close the gap later.
- **Boostcamp.** A program library (14,000+, 130+ from coaches) and a program builder, free. Pro adds a strength score, a muscle heat map, auto progression and analytics.
  - Lesson: "follow a known program" is a big use case. PR Forge's "paste any plan" (text, PDF, CSV) covers it without a catalogue to maintain.

## 3. Top 15 opportunities for PR Forge

1. **Import from Strong and Hevy (CSV).** Removes the switching cost for the biggest audiences. *High impact, M effort.*
2. **Warm-up calculator** on the active barbell set (e.g. bar, 50%, 70%, 85%), using the plate calculator. *S.*
3. **Weekly recap card** on Today on Mondays: sessions, sets, PRs, what moved, in words. *S–M.*
4. **Routine rotation:** "Push → Pull → Legs" order so Up Next always follows the plan. *S.*
5. **Exercise cues** for the ~100 common lifts: 2–3 short form points each, written fresh (no video). *M, content.*
6. **"Rest over" alert:** sound or vibration when the app is open. Web push on iPhone is limited. *S.*
7. **Custom plate sets** (e.g. no 35s, add 1.25s). *S.*
8. **Notes** per workout and per exercise ("seat 4, wide grip"). *S–M.*
9. **Share routines by short code or link**, beyond pasting text. *M (needs a small table).*
10. **RPE-aware progression** (optional): only suggest going up when the top set was ≤ RPE 8. *S, after RPE has use.*
11. **Body measurements** beyond weight (waist and so on), optional. *S.*
12. **Deload hint** after a long stall, as a suggestion with its reason, never automatic. *M.*
13. **Private friends:** see a friend's PRs only if both opt in. No public feed. *L.*
14. **Clear "free, no limits, works offline" message** on sign-in and in the share text. *S.*
15. **Home-screen install prompt and help** for friends, since the app lives on the home screen. *S.*

## 4. Prioritise, improve, replicate selectively, avoid

- **Prioritise:**
  - logging speed and reliability
  - plain-word progress and PRs
  - free with no caps
  - "paste any plan"
  - Strong and Hevy import
- **Improve:**
  - weekly recap
  - warm-up calculator
  - routine rotation
  - notes
  - exercise cues
- **Replicate selectively:**
  - custom plates
  - measurements
  - an RPE-aware progression option
  - private friend sharing
- **Avoid on purpose:**
  - AI-generated workouts
  - recovery percentages and invented scores
  - a public social feed
  - a program marketplace
  - a video library
  - subscriptions or paywalls
- **Can't do as a web app:** Apple Watch, Apple Health, widgets. Revisit only if PR Forge ever ships a native app.

## 5. Recommended positioning

**"The honest strength log: fast to use, free with no limits, and clear about whether you're getting stronger."**

Primary: an **exceptionally fast logger with progress-first insight**, for lifters who follow their own or a shared plan. Not an AI coach and not a program marketplace.

Tradeoffs:
- No Watch or Health, because it's a web app. That will cost some users. It's offset by zero install friction, a web app on every device, and no paywalls.
- No generated workouts. Beginners get starter plans and paste-a-plan instead.

## 6. 90-day roadmap

| Month | Work | Why |
|---|---|---|
| 1 (Dec) | Strong and Hevy CSV import; warm-up calculator; "free, no limits, offline" message | Lower the cost of switching, and match Strong's calculators |
| 2 (Jan) | Weekly recap card; routine rotation; notes; rest-over alert | Retention (January is the busiest month in gyms) and calmer workouts |
| 3 (Feb) | Exercise cues for common lifts; custom plates; share routine by code | Help beginners; make sharing with friends easier |

## 7. A feature set that could be a real advantage

- **Free with no caps:** unlimited routines, history and charts (Hevy caps graphs at 3 months, Strong puts charts behind PRO).
- **Progress you can read:** trends in words, every PR explained ("+1 rep at 225 lb"), what changed after each workout, Push · Pull · Legs "last trained". All facts, no scores.
- **Any plan in, in seconds:** paste text, a PDF or a CSV, or share a routine as text with a friend.
- **Works anywhere:** offline, on any phone or computer, backed up per person.

Every one of these already exists or is a small step from what exists.

## Sources (accessed 25 Nov 2026)

- **Hevy:**
  - [GhostFit](https://ghostfit.ai/blog/app-comparisons/hevy-workout-tracker-2026-is-hevy-free-is-pro-worth-it)
  - [Sensai, Hevy review](https://www.sensai.fit/blog/hevy-review-2026)
  - [Sensai, Hevy vs Strong](https://www.sensai.fit/blog/hevy-vs-strong-2026)
  - [RepReturn](https://repreturn.com/hevy-app-review/) (its prices disagree with the others)
  - [Push/Pull](https://push-pull.app/blog/push-pull-vs-hevy)
  - [AI Tools Bakery](https://aitoolsbakery.com/blog/hevy-review/)
  - [Hevy on Google Play](https://play.google.com/store/apps/details?id=com.hevy)
  - [hevyapp.com](https://www.hevyapp.com/best-workout-tracker-app/)
- **Strong:**
  - [App Store listing](https://apps.apple.com/app/strong/id464254577)
  - [Sensai, Strong review](https://www.sensai.fit/blog/strong-app-review-2026)
  - [JEFIT comparison](https://www.jefit.com/blog/10-best-workout-tracker-apps-in-2026-complete-comparison-guide) (written by a competitor)
  - [RepReturn](https://repreturn.com/strong-app-review/)
  - [Push/Pull](https://push-pull.app/blog/push-pull-vs-strong)
- **Fitbod:**
  - [Sensai](https://www.sensai.fit/blog/fitbod-review-2026)
  - [Trainera](https://trainera.fit/blogs/fitbod-pricing)
  - [Lasta](https://lasta.app/blog/fitbod-review/)
  - [AI Tools Bakery](https://aitoolsbakery.com/blog/fitbod-review/)
- **JEFIT:**
  - [Official Elite page](https://www.jefit.com/elite)
  - [Gainr](https://www.gainr.fit/blog/best-workout-app-comparison-2026)
  - [Ellim](https://www.ellim.app/blog/fitness/best-jefit-alternatives)
  - [HerDailyFit](https://www.herdailyfit.com/programs/jefit/)
- **Alpha Progression:**
  - [Official glossary](https://alphaprogression.com/en/glossary/alpha-progression)
  - [Official home-gym guide](https://alphaprogression.com/en/blog/best-home-gym-strength-training-apps)
  - [AI Tools Bakery](https://aitoolsbakery.com/blog/alpha-progression-review/)
  - [Healthy N Exercise](https://www.healthynexercise.com/alphaprogression/)
  - [Respect My Region](https://respectmyregion.com/alpha-progression-review-2026/)
- **Boostcamp:**
  - [Official Pro page](https://www.boostcamp.app/pro)
  - [Is Boostcamp free?](https://www.boostcamp.app/is-boostcamp-free)
  - [BarBend](https://barbend.com/boostcamp-review/)
  - [Fortune](https://fortune.com/article/boostcamp-review/)
- **User sentiment** (mostly vendor-written roundups; directional only):
  - [Setgraph](https://setgraph.app/ai-blog/best-workout-tracker-app-reddit)
  - [GummySearch](https://gummysearch.com/tools/best-products/workout-app/)
