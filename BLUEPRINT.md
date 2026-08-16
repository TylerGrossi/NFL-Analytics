# NFL Analytics Platform — Research & Build Blueprint

*Compiled 2026-08-13. Everything below is buildable on free/open data.*

---

## 1. The market gap

| Site | What it does | What it doesn't |
|---|---|---|
| **PFF** | WAR, grades, every position incl. OL | $$$ paywall, closed methodology, no reproducibility |
| **SumerSports** | Good free EPA/team pages, contract tools | No player WAR exposed, limited depth, no in-game tools |
| **rbsdm.com** (Ben Baldwin) | The reference for team EPA + 4th down calc | Deliberately minimal — tables, no player pages, no cards |
| **NFL Next Gen Stats** | Tracking-derived stats (separation, time to throw) | Siloed by stat type, no synthesis, no historical depth in UI |
| **Pro Football Reference** | Encyclopedic box score history | Almost no modern advanced metrics, dated UX |
| **Football Outsiders/FTN** | DVOA lineage | Mostly paywalled now, opaque |
| **ESPN/CBS/Yahoo** | Scores, standings | No real analytics |

**The gap:** nobody offers a *free, transparent, single-surface* NFL product that combines
(a) scores/standings/box scores, (b) modern advanced metrics, (c) a real player card,
(d) a public WAR with published methodology and uncertainty, and (e) cap/contract value tooling.
MLB has this in three places for free (FanGraphs, Baseball Savant, Baseball Reference). The NFL has none.

**Why the gap exists (be honest about it):** football WAR is genuinely harder — 11 interdependent players
per snap, no discrete "plate appearance" for a guard, and the charting data that solves it (pressures,
blocks, coverage assignments) is proprietary. The public-data answer is *mixed-effects credit allocation
plus published uncertainty*, not a fake precision score.

**Differentiators to build toward:**
1. Open, reproducible WAR with credible intervals — the only free one.
2. WAR ÷ cap dollars (surplus value), fused with real Over The Cap contracts.
3. A live game companion: in-game win probability + 4th down bot + drive EPA, live.
4. A genuine player card, not a table dump.
5. Every model's method page published, with backtests.

---

## 2. Data sources (all free unless noted)

### 2.1 Primary backbone — nflverse
The de facto open data layer. Parquet/CSV/RDS files published to GitHub Releases — **no API key, no rate limit,
CDN-served**. Access via `nflreadpy` (Python, modern), `nfl_data_py` (Python, older), or `nflreadr` (R).

| Dataset | Coverage | Notes |
|---|---|---|
| `load_pbp()` | 1999–present | ~380 cols incl. built-in `ep`, `epa`, `wp`, `wpa`, `cpoe`, `xyac_epa`, `air_yards`, `qb_dropback` |
| `load_player_stats()` / `load_team_stats()` | 1999– | weekly + season aggregates |
| `load_participation()` | 2023– (FTN) | **who was on the field per play** — critical for defensive WAR. Only released after the postseason ends |
| `load_players()` / `load_rosters()` / `load_rosters_weekly()` | 1920s– | bios, IDs, heights/weights |
| `load_teams()` | — | colors, logos, wordmarks |
| `load_schedules()` | 1999– | **updates every 5 min in season**, includes Vegas spread/total, roof, surface, temp |
| `load_nextgen_stats()` | 2016– | passing / rushing / receiving: `avg_separation`, `avg_cushion`, `avg_time_to_throw`, `avg_yac_above_expectation`, `expected_rush_yards`, aggressiveness |
| `load_pfr_advstats()` | 2018– | `pass`/`rush`/`rec`/`def` — incl. **defensive coverage**: targets, yards allowed, passer rating allowed, missed tackles |
| `load_snap_counts()` | 2012– | offense/defense/ST snap % — the denominator for WAR |
| `load_ftn_charting()` | 2022– | `is_play_action`, `is_screen_pass`, `is_motion`, `is_no_huddle`, `n_blitzers`, `n_pass_rushers`, `is_qb_out_of_pocket` |
| `load_contracts()` | — | **Over The Cap contract history** — APY, guarantees, cap hits by year |
| `load_depth_charts()`, `load_injuries()`, `load_officials()`, `load_trades()` | varies | |
| `load_draft_picks()`, `load_combine()` | 1980s– / 2000– | PFR-sourced |
| `load_espn_qbr()` | 2006– | ESPN's QBR for comparison |
| `load_ff_opportunity()` | 2006– | expected fantasy points models |

**Freshness:** raw play-by-play lands **~15 min after a game ends**; cleaned version rebuilds nightly;
Thursday's pull is the cleanest (post stat-correction). Rosters/depth charts 07:00 UTC daily. NGS nightly 3–5am ET.

### 2.2 Live in-game
**ESPN's unofficial API** — no key, no docs, no SLA. Poll server-side, cache 20–30s, degrade gracefully.
- `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- `.../summary?event={id}` — drives, plays, box score, win prob, odds
- `.../teams`, `.../standings`, `.../news`
Use it **only** for live/in-progress state; reconcile to nflverse once the game finalizes.

### 2.3 Player tracking (the unlock)
**NFL Big Data Bowl on Kaggle** — full 10Hz x/y/speed/acceleration/orientation tracking, free with a Kaggle
account. Cumulative releases cover 2017–2024 seasons across the 2019–2026 competitions (each year exposes
different weeks/situations: passing, rushing, ST, tackling, pre-snap→pass-arrival).
This is the only public route to *true* separation-vs-coverage, pressure charting, route trees, and
pass-block win rate. It is **not live** — treat tracking features as a historical/research layer.

### 2.4 Supporting
- **Lee Sharpe's `nfldata`** — games, standings, draft picks, rosters (GitHub, CSV).
- **DynastyProcess** — cross-site player ID mapping (ESPN ↔ PFR ↔ GSIS ↔ Sleeper).
- **nflseedR** — playoff seeding/tiebreaker simulation engine for playoff odds.
- **nfl4th** — Baldwin's 4th down model, open source; port or re-fit it.
- **The Odds API** — free tier (~500 req/mo) for live lines; or use `load_schedules()` closing lines.
- **Open-Meteo / Meteostat** — free historical + forecast weather by stadium lat/lon (kicking models).
- **Wikidata** — player bios, college, birthplaces (CC0).

### 2.5 Paid, only if you scale
Sportradar / SportsDataIO / Stats Perform (official feeds, $$$), PFF (grades), Spotrac API (cap), FTN (charting).

### 2.6 Legal / licensing notes
- nflverse is MIT/CC-BY-SA — **credit FTN Data for participation & charting data**, it's CC-BY-SA 4.0.
- **Team logos, wordmarks, and player headshots are licensed IP.** Fine for a personal project;
  for anything monetized, use team *colors* + abbreviations and your own marks, or license imagery.
- Don't scrape PFR directly (ToS + rate limits) — use the nflverse mirrors.
- Don't present ESPN's unofficial API as a partnership; it can vanish without notice.

---

## 3. Metric catalog

### 3.1 Foundation models (re-fit these yourself; don't just consume nflverse's columns)
| Model | Target | Method | Inputs |
|---|---|---|---|
| **Expected Points (EP)** | next scoring event (7 classes: TD/FG/Safety ±, none) | multinomial logistic or LightGBM softmax | down, ydstogo, yardline, half seconds, timeouts, roof |
| **EPA** | EP(after) − EP(before) | derived | |
| **Win Probability (WP)** | win/loss | GBM, two flavors: with & without Vegas spread | EP state + score diff, time, timeouts, spread |
| **Completion % over expected (CPOE)** | completion | GBM | air yards, pass location, pressure, receiver separation |
| **xYAC** | yards after catch | GBM | catch location, defenders nearby, air yards |
| **xPass / PROE** | P(pass) | GBM | game state → pass rate over expected = tendency fingerprint |
| **Expected rush yards** | rush yards | NGS provides; re-fit w/ tracking | box count, gap, blockers |
| **FG probability** | make/miss | logistic w/ splines | distance, altitude, wind, temp, surface |
| **4th down decision** | ΔWP by choice | compose EP/WP + FG + punt models | full game state |

### 3.2 Team metrics
EPA/play (off & def, pass & rush) · success rate · opponent-adjusted EPA (ridge regression w/ opponent fixed
effects — your DVOA analogue) · early-down EPA · PROE · explosive play rate (≥20 pass / ≥10 rush) ·
drive stats (pts/drive, available yards %, drive success rate, 3-and-out rate) · red zone TD% over expected ·
third down conversion over expected · adjusted line yards · adjusted sack rate · pressure rate ± ·
turnover-worthy play rate · time-of-possession-neutral pace (sec/play) · Elo & SRS & Massey power ratings ·
Pythagorean wins · strength of schedule (forward + played) · Monte Carlo playoff odds & seeding.

### 3.3 Player metrics by position
- **QB** — EPA/dropback, CPOE, EPA+CPOE composite, ANY/A, sack rate over expected, time to throw,
  aggressiveness, air yards/att, pressure-to-sack rate, deep ball EPA, clean-pocket vs pressured splits, QBR.
- **RB** — rush EPA over expected (partialing out the OL), RYOE/att, success rate, stuff rate,
  explosive rate, receiving EPA, snap share, fumble rate, "gap-neutral" efficiency.
- **WR/TE** — target share, air yards share, **WOPR**, RACR, aDOT, YPRR (needs routes → tracking/charting),
  **avg separation & cushion (NGS)**, YAC over expected, contested catch rate, EPA/target, drop rate,
  first-read share, alignment splits (slot/wide/inline).
- **OL** — unit-level pass-block & run-block random effects, adjusted sack rate allowed, pressure rate
  allowed (FTN), snaps, penalty rate. *(Individual OL grading is the honest weak point without PFF/tracking.)*
- **EDGE/DL** — pressure rate over expected, sack rate, run stop rate, TFL, double-team rate (tracking),
  on-field EPA differential (needs participation data).
- **LB/S/CB** — coverage targets, yards/coverage snap, **passer rating allowed** (PFR), catch rate allowed,
  EPA allowed per target, missed tackle rate, tackle depth, blitz productivity, **separation allowed**
  (tracking) → your CB "sticky score".
- **K/P/ST** — FG% over expected (kicker EPA), net punt EPA over expected, return EPA, coverage EPA.

### 3.4 Coaching / strategy
4th down aggressiveness index (actual vs nfl4th-optimal, cumulative WP left on the field) ·
PROE and early-down pass rate · timeout efficiency · challenge success · penalty rate ·
play-call entropy (predictability) · situational tendency heatmaps · personnel package usage (11/12/21) ·
motion & play-action rates and their EPA lift.

---

## 4. The WAR model

**The problem:** WAR needs (1) an isolated player contribution and (2) a replacement baseline. Football gives
you neither for free — every play's outcome is jointly produced by up to 22 players.

**The framework (extends nflWAR — Yurko/Ventura/Horowitz, 2019 — to defense and special teams):**

**Step 1 — Establish the wins currency.** Regress season wins on point differential → points per win
(historically ≈ 35–38 points per win). Convert EPA to points to wins with a fitted constant, not folklore.

**Step 2 — Allocate credit per play with a multilevel model.** For each play family (pass, rush, ST),
fit a mixed-effects model:
```
EPA_play ~ situation covariates + (1 | QB) + (1 | ball_carrier) + (1 | receiver)
         + (1 | offense_OL_unit) + (1 | defense_unit) + (1 | opponent)
```
The random-effect BLUPs are per-play player contributions, **automatically shrunk toward zero for small
samples** — which is exactly the behavior you want and what a raw leaderboard lacks.

**Step 3 — Position-specific value streams**, each converted to points:
| Position | Streams |
|---|---|
| QB | pass EPA above expected, rush EPA, sack avoidance, fumble/INT cost |
| RB | rush EPA above expected (OL-adjusted), receiving EPA, fumbles |
| WR/TE | receiving EPA above expected given air yards & situation, YAC OE, drops |
| OL | unit run/pass-block effect → allocated by snaps × charting-based adjustments |
| DL/EDGE | pressure over expected, sacks, run stops, on-field EPA differential |
| LB/DB | coverage EPA allowed per target/snap, missed tackles, run support |
| K/P/RET | FG/punt/return EPA over expected |

**Step 4 — Replacement level, empirically.** For each position, take the pooled per-snap value of players
outside the top *N* by snaps (N ≈ 32 QB, 64 RB, 96 WR, 160 OL…) or of minimum-salary/practice-squad
signings. That pooled mean is the zero point — do not assume it equals league average (it's typically
~0.7–0.8 wins below average over a full season for a QB).

**Step 5 — Compose.**
```
WAR = (value_per_snap − replacement_value_per_snap) × snaps × wins_per_point
```

**Step 6 — Quantify uncertainty.** Bootstrap-resample plays (block bootstrap by drive/game) → 500+ reps →
report the **80% credible interval alongside every WAR value**. Publishing the interval is the single most
credible thing the site can do; PFF does not.

**Step 7 — Validate publicly.** Year-over-year stability (r), out-of-sample prediction of next-season team
wins vs. simple EPA baselines, sum of team WAR vs. actual wins, and a correlation with cap dollars.
Ship a "Model" page with these backtests. Every metric gets one.

**Downstream products:** WAR/$ (surplus value), positional value curves for the draft, contract efficiency
leaderboards, trade value calculator, aging curves by position.

**Known limitations to state on the page:** individual OL and interior DL attribution is weak without
proprietary charting; defensive WAR before 2023 is limited by participation data availability; tracking-based
metrics are historical only.

---

## 5. Site map

```
/                      Today — live scores, WP tickers, 4th down alerts, movers
/scores/[week]         Scoreboard → /game/[id]  (win prob chart, drive chart, play EPA, box, 4th downs)
/standings             Division/conf tables + Pythagorean, SoS, playoff odds, seeding sim
/teams/[team]          Team hub: EPA splits, tendencies, drive stats, roster w/ WAR, cap, schedule
/players/[id]          Player card: WAR + interval, percentile bars, game log, splits, contract, comps
/stats                 Query builder over any table, any filter, exportable
/war                   WAR leaderboard: position filters, components, intervals, WAR/$
/lab                   split explorer: any filter combination against the play store, live
                       (the efficiency quadrant shipped on /teams instead)
/tools/fourth-down     4th down calculator (live + hypothetical)
/tools/armchair-gm     Cap manager: cuts, restructures, extensions, FA signings, draft
/tools/playoff-odds    Interactive seeding simulator
/models                Methodology + backtests for every model
```

---

## 6. Architecture (Vercel-native, ~$0–25/mo)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Charts: **visx or Recharts**
  for standard, hand-rolled **D3 + SVG** for the signature ones (WP chart, drive chart, field map).
- **Pipeline:** Python (`nflreadpy` + **Polars**) in **GitHub Actions**:
  - nightly 06:00 UTC full rebuild (pbp → features → models → aggregates)
  - every 5 min during game windows: schedules + ESPN live poll
  - weekly: WAR re-fit + bootstrap
- **Models:** trained offline (LightGBM for EP/WP/CP/xYAC/xPass; `statsmodels`/`pymer4` for mixed models).
  Serialize artifacts; score in the pipeline. **Never train in a request.**
- **Storage — two tiers:**
  1. **Postgres (Neon/Supabase free tier)** for relational reads: players, games, season aggregates, cards.
  2. **Parquet on Vercel Blob / Cloudflare R2 + DuckDB-WASM in the browser** for `/lab` and `/stats` —
     users run arbitrary filters over millions of plays with **zero backend cost**. This is the trick that
     makes a free heavy-analytics site viable.
- **Caching:** ISR + `revalidateTag`; live routes on Edge with a 20s `s-maxage`.
- **Search:** static player index + Fuse.js (client) or Postgres `pg_trgm`.
- **Monitoring:** pipeline failure alerts; a public "data freshness" badge in the header.

**Build order:** 1) pipeline + Postgres + scores/standings → 2) team pages + EPA metrics → 3) player cards →
4) `/lab` + DuckDB → 5) 4th down + live game view → 6) **WAR v1** → 7) Armchair GM → 8) tracking-derived
separation/coverage layer.

---

## Sources
- [nflfastR](https://www.nflfastr.com/) · [nflverse](https://nflverse.nflverse.com/) · [nflreadr reference](https://nflreadr.nflverse.com/reference/index.html) · [update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
- [nflreadpy](https://nflreadpy.nflverse.com/) · [nfl_data_py](https://github.com/nflverse/nfl_data_py) · [nflverse ngs-data](https://github.com/nflverse/ngs-data)
- [nflWAR paper (arXiv)](https://arxiv.org/abs/1802.00998) · [PFF WAR (Sloan)](https://www.sloansportsconference.com/research-papers/pff-war-modeling-player-value-in-american-football) · [SIS WAR primer](https://www.sportsinfosolutions.com/2021/05/04/a-primer-for-siss-nfl-wins-above-replacement-war-metric/)
- [nfl4th](https://nflverse.r-universe.dev/nfl4th) · [4th down calculator](https://rbsdm.com/stats/fourth_calculator/) · [RBSDM stats](https://rbsdm.com/stats/stats/)
- [NFL Big Data Bowl](https://operations.nfl.com/gameday/analytics/big-data-bowl) · [Kaggle BDB 2026](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-analytics)
- [Next Gen Stats](https://nextgenstats.nfl.com/) · [Over The Cap](https://overthecap.com/) · [Spotrac](https://www.spotrac.com/nfl/cap) · [ESPN hidden API guide](https://dev.to/zuplo/unlocking-espns-hidden-api-a-developers-guide-1pp7)
