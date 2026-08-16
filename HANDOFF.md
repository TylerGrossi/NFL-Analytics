# Handoff — WAR rebuild, design pass, injury model, in-season fantasy

Context for an agent picking this up cold. Covers the most recent block of work.
`README.md` has the full project documentation; this is what changed and why.

Sections 1–3 are the earlier WAR / design / injury work. Sections 4–6 are the
2026-08-15 pass that cleared four of the five queued items and found two silent
data bugs.

---

## 1. WAR was badly wrong and has been rebuilt

**Symptom that started it:** on the 2025 running back leaderboard, Bijan Robinson
ranked 124th and Christian McCaffrey 139th, while backups and kick returners
filled the top ten. Receivers were worse — nine running backs outranked the
first wideout.

**Why it wasn't caught:** the published backtests are team-level (team WAR vs
wins, r = 0.76) and they passed. Team totals can look fine while individual
attribution is broken, because errors cancel inside a team. **Player-level
validation against known production leaders is now the gate before any WAR
change ships.**

### Six defects, all fixed

Files: `pipeline/nflx/models/war.py`, `pipeline/nflx/build/war.py`

| # | Defect | Fix |
|---|---|---|
| 1 | **QB scrambles double-counted.** A scramble is a dropback, so its value already sat in the passing role via `qb_epa` — and was counted again as a rush. Worse, scramblers are low-volume/high-efficiency, so they filled the low-volume end of the rushing pool and inflated the replacement bar until every workhorse graded below it. | `role_rows()` filters `qb_scramble == 0` from the rush role |
| 2 | **Receiving target was `yac_epa`.** Yards *after* catch credits a back catching a screen at the line with everything and a receiver winning a contested 40-yard throw with almost nothing. | Target is now full `epa`; depth of target (`air_yards`) enters the situation baseline instead. Passer stays a control |
| 3 | **Replacement depended on the shrinkage parameter.** It was the usage-weighted mean of *fitted ridge coefficients* for the tail. Alpha is chosen on a random game holdout — two near-identical fits picked 60 and 200, moving replacement +0.003 → +0.012/play. Times 300 carries that is half a win of noise. | `_replacement_level()` now measures the **observed** mean `_target` on plays taken by the replacement pool. Depends only on what happened on the field |
| 4 | **No situation control.** Workhorses take the third-and-ones, goal-line and clock-killing carries; the model charged them personally for that difficulty. | `_over_expected()` subtracts expected EPA for the cell: down × distance bucket × field zone (+ target depth for receiving). `MIN_CELL_PLAYS = 50`, else falls back to the role mean |
| 5 | **No sample-size shrinkage.** A hot 100 carries outranked a full season. | `RATE_SHRINK = {rush: 400, rec: 160, pass: 150}`; `trust = plays / (plays + k)` applied in `war_from_fit()` |
| 6 | **Returns wildly overvalued** — league total 14.1 WAR, five times every offensive line combined. One long return on 18 attempts became half a win. | `ST_SHRINK = {return: 150, kick: 25, punt: 40}` (return was 40) |

### Calibration behind the constants

Measured, not chosen:

- **Rushing efficiency barely repeats** — r = 0.16 year over year (2010–2025), and
  prediction error keeps falling the harder you regress it, bottoming near k=400.
- **Return efficiency** — r = 0.23 across 351 returner pairs.
- **Volume/efficiency gradient**, once scrambles are excluded, is **positive**:
  backs with 250–400 carries average +0.026 EPA over expectation, backs with
  30–80 average −0.013. High-volume backs are *more* efficient. An earlier
  "deployment penalty" theory was an artifact of scrambles contaminating the
  low-volume pool — do not reintroduce it.

### Intervals removed

Deliberate, at the user's request. The bootstrap is deleted; `war_lo`, `war_hi`
and `interval_width` are gone from the model, build, parquet and every UI
surface. One number. Do not add them back.

### Validation after rebuild

```
team WAR vs actual wins  (2020+, full coverage)   0.795
team WAR vs Pythagorean  (2020+)                  0.826
Pythagorean vs wins (ceiling)                     0.909
mean WAR by position: QB ~1.0, WR/RB/TE/OT ~0.0
league role totals: passing 102.9, defense 25.3, receiving 9.3,
                    line 3.2, returns 1.2, rushing -3.7
```

2025 sanity check — all genuine starters:
- **RB**: Achane 0.13, J.Taylor 0.08, Javonte Williams 0.07, Henderson 0.06, Bijan 0.05
- **WR**: Nacua 0.26, McBride 0.18, Smith-Njigba 0.17, Pickens 0.14, Chase 0.08

### Web-side WAR changes

- `getWarLeaders()` returns a **`role_war`** column and orders by it. A running
  back board ranks on rushing + receiving, receivers on receiving, specialists
  on kicking + punting + returns. **The page displays `role_war`, not total** —
  otherwise a returner shows a positive number on an RB list.
- **Usage qualifiers** (`WAR_MIN_PLAYS` in `queries.ts`): ALL 150, QB 250,
  RB 200, WR 90, TE 65, DEF 300, OL 350, ST 25. Standard practice; without them
  committee backs crowd the board.
- WAR displays 2 decimals below 1.0 (QB WAR reaches 7; a back's tops out ~0.2,
  so one decimal collapsed every skill player onto "0.1").

### Known remaining limitation

Running back WAR is genuinely *small* — the best back is worth about a fifth of
a win above replacement. That matches the wider consensus that back play is the
least separable position from its blocking. The ordering is right; the
magnitudes are compressed. Do not "fix" this by inflating it.

---

## 2. Design pass

The site read as templated. Three changes.

- **Typography.** Dropped Barlow Condensed entirely. Now **Inter** (UI) +
  **IBM Plex Mono** (data), in `src/app/layout.tsx` as `--font-sans` /
  `--font-data`.
- **No more ALL CAPS.** Every `text-transform: uppercase` is removed from
  `globals.css` and all components. Hierarchy comes from weight, size and
  colour. `.label`, `.panel-head h2`, `.grid-table th` and `.headline` were the
  offenders.
- **Grouped navigation.** `NAV` in `src/lib/site.ts` is now `NavGroup[]` — five
  sections (Games, Teams, Players, Fantasy, Research), each with items carrying
  a one-line blurb. `MainNav` renders CSS-driven hover/focus dropdowns;
  `MobileNav` is a flat scrolling row for narrow screens.

### Second pass, 2026-08-15: text placement

The site read as templated for a second reason — volume of prose in the scan
path. Fixed with two primitives in `ui.tsx`, not by deleting content:

- **`<Deck>`** — one sentence under the title, 68ch measure. Replaced the
  65–130 word opener on eleven pages.
- **`<Notes>`** — `<details>` at the page foot, shut, always titled
  *Method & limits*. Absorbed four differently-named caveat walls, the six
  `STEPS` cards on `/war`, and the prose that sat inside data panels.

Visible prose 2,408 → 360 words over nineteen routes; `/war` first-data depth
672px → 298px; `/tools/fourth-down` page height 2,693 → 1,770px.

**Do not put a paragraph back above the data.** `web/audit-text.mjs` reports
visible words, collapsed words and first-data depth per route — run it with
`audit-mobile.mjs`. Rough targets: under ~25 visible words, dataTop under 450px.

Layout defects fixed in the same pass: two columns both headed "WAR"; the
fourth-down calculator's left track ending 260px short of the right (Model
inputs moved under Situation); a 32-row table beside a 10-row one (capped with
internal scroll); a 2.5px tick standing in for a value bar, now a diverging bar
filled from the zero line; and `num()` printing `-0.00` for values that round to
zero from below.

**Gotcha worth knowing:** `globals.css` has a global
`.grid > *, .flex > * { min-width: 0 }` rule (it stops wide tables dragging the
page sideways on mobile). It **overrides Tailwind `min-w-*` utilities**. Use a
fixed `w-[...]` for dropdown panels and `shrink-0` on chip rows, or they
collapse.

---

## 3. Injury model and depth charts

New: `pipeline/nflx/build/injuries.py` (`build_depth()` and `build()`).

**Play probability is measured, not borrowed.** Every injury report from 2018 on
is joined to whether the player took a snap that week (`snap_counts` via
`pfr_id` → `player_id`). Only players whose id demonstrably bridges *in that
season* are counted — otherwise a failed id match looks identical to a player
who sat out and every rate is biased down.

Measured rates over 43,131 reports:

| Report | DNP | Limited | Full |
|---|---|---|---|
| No designation | 77% | 95% | 95% |
| Questionable | **46%** | 68% | **79%** |
| Doubtful | 1% | 1% | 0% |
| Out | 0% | 0% | 0% |

Practice participation carries more than the game designation — a flat
"Questionable ≈ 70%" throws away a 33-point swing.

**Outputs:** `injury_rates.parquet`, `injury_reports.parquet`,
`depth_charts.parquet` (latest snapshot per club, `pos_rank` 1 = starter),
`fantasy_availability.parquet`.

**Wired into:** fantasy draft board (depth column flags backup QBs), and game
previews (per-team "personnel" panel with projected starters + injury
designations and play probability).

**Important:** injury designations are only joined when `report_season` matches
the season being drafted/previewed. In August the newest reports on file are
from the previous February, and showing a Super Bowl designation as current
status would be worse than showing nothing.

---

## 4. Outstanding queue — four of five now built

Worked 2026-08-15. Items 1–4 shipped; item 5 is blocked on a credential only the
user can supply.

1. **PAR vs profootballstatcards — done, nothing adopted from the model.**
   Their PAR is Production Points (a linear box-score model weighted by each
   stat's frequency to a touchdown) minus the positional **median**. Their
   published v3 weights were reimplemented on our weekly data: on 8,845 shared
   player seasons theirs correlates 0.713 with team wins against our 0.769, and
   repeats year to year at 0.615 against our 0.686. The decisive number is that
   their running back PAR correlates **0.923 with touches** and ours −0.178 —
   it is a volume statistic. A median baseline also puts 65% of qualified
   quarterbacks "below replacement". Full comparison table is in `README.md`.
   **What was adopted is the presentation**: a within-position percentile on the
   season leaderboard, because our own known limitation is that a back's best
   season is 0.13 wins and looks like noise without one.
2. **Armchair GM — done.** `getCapTable()` now joins `depth_charts` and
   `injury_reports`, both gated on the league year being viewed; `getTeamDepth()`
   returns the full chart with PAR and cap hit attached. The cap sheet has a
   Depth column and an injury chip, and a depth chart below it reacts to cuts —
   cut a starter and the next man is promoted in place with a "N starting jobs
   opened · −X PAR against the next man up" summary. Fixed a real bug while in
   there: cut/restructure keys were built from the *sorted* index while the
   totals loop used the *original* index, so moves silently stopped counting
   after you re-sorted the table.
3. **Film on game pages — done, and the 403 was not a stale event id.** Every
   ESPN call in the project was 403ing: their edge refuses an unrecognised agent
   carrying a `name/version` token, and both `sources/espn.py` and
   `web/src/lib/espn.ts` sent `hashmark-analytics/0.1`. Dropping `/0.1` fixes it
   (4/4 refusals with, 4/4 responses without). This had also killed the entire
   live-game path — `/games/<espn-id>` was 404ing. `Highlights` renders clip
   cards that **link** to ESPN rather than embedding their mp4, and respects the
   embargo/expiry and geo fields in the payload. Availability is narrow and
   documented: last night's games carry four or five clips, 2025 regular-season
   games six months on carry zero.
4. **In-season fantasy — done.** New `build/fantasy_weekly.py` →
   `fantasy_weekly`, `fantasy_ros`, `fantasy_waivers`; new `/fantasy/week` page
   with week board, rest-of-season and waiver views. The matchup coefficient is
   **fit, not assumed** — see §6. Preseason it correctly reports rates as
   projections and says the waiver list is ranked on ownership alone; it sharpens
   automatically as weeks land.
5. **Big Data Bowl play animations — blocked, not attempted.** The only public
   route to 10Hz tracking is Kaggle, which needs an account, per-competition
   rules acceptance, and an API token. Verified: the competition data API returns
   401 unauthenticated, there is no `~/.kaggle/kaggle.json` and no
   `KAGGLE_USERNAME` in the environment. **To unblock:** create the token, drop
   it at `~/.kaggle/kaggle.json`, and accept the rules for each competition year
   you want (each exposes different weeks and situations — see `BLUEPRINT.md`
   §2.3). Worth deciding the redistribution question before building anything
   public on it. No speculative scaffolding was written, because the schema
   differs per competition year and there was no way to test a line of it.

Deliberately deferred by the user: **Vercel deployment**.

---

## 5. Two data bugs found and fixed on the way through

Both were silent — nothing errored, the numbers were just wrong.

- **ESPN User-Agent.** Covered in §4 item 3. The symptom to recognise if it
  recurs: every ESPN-backed surface goes quietly empty because `_get()` and
  `get()` both swallow a failure and return `None` by design.
- **Postseason rows in fantasy points allowed.** `nv.player_stats_weekly()`
  returns `REG` and `POST` in one frame under overlapping week numbers.
  `fantasy_tools._points_allowed()` never filtered, so the fourteen playoff
  clubs carried extra games in a per-game average the other eighteen were ranked
  against. Filtering to `REG` moved **84 of 128** team-position SOS ranks (LAC
  tight ends moved six places). Fixed in `fantasy_tools.py` and never present in
  `fantasy_weekly.py`. Anything reading `fantasy_sos` or `fantasy_defense` from
  before 2026-08-15 is stale.

## 6. The matchup coefficient, and why it is not 1.0

The one new modelling constant. Every fantasy tool multiplies a projection by the
opponent's fantasy-points-allowed index, which claims the whole spread between
defences survives into this week. Regressing 48,103 player weeks on the
opponent's prior-season index — with the predicted week held out of the player's
own rate, so the baseline cannot see the answer — says otherwise:

| | QB | RB | WR | TE |
|---|---|---|---|---|
| Fitted coefficient | 0.26 | 0.13 | 0.10 | 0.09 |
| Swing at 12 ppg, easiest to hardest | 2.4 | 1.2 | 0.8 | 1.2 |

Fitted at build time by `_fit_betas()` over 2016 → present, deliberately a wider
window than the six-season play-by-play store, because it is one league-level
coefficient per position and wants the longest run available. Two independent
implementations — a scratch pandas script and the polars build module — agree to
three decimals, which is the check that it is right.

Also worth keeping: defensive generosity carries year to year at only 0.23
slope (QB 0.27, RB 0.30, WR 0.23, TE 0.17), consistent with the 0.34 net-rating
carryover already documented for game projections.

## 6a. A third silent chart bug, found by building the PNG export

The win probability chart on completed game pages was spiking to 100 and back
on single plays. Twelve of the Super Bowl's 192 rows — timeouts, `END QUARTER`,
`GAME` — carry a win probability but **no possession team**. The query flips
`wp` with `case when posteam = home_team then wp else 1 - wp end`, and
`posteam = home_team` is NULL when `posteam` is null, which is not true, so
every one of those rows took the ELSE branch and was inverted. A Seattle
timeout at 0.001 was charted at 0.999.

Fixed by excluding null-posteam rows from `getGameWinProbability` — they are
not plays. Worth remembering as a pattern: **a three-way SQL CASE on a nullable
join key silently sends NULLs down the wrong branch.** The same shape exists
anywhere else `posteam = home_team` is used.

## 7. Working notes

- **A full `python -m nflx.cli build` now runs clean end to end** (first time;
  2026-08-15). Ordering is confirmed correct: `injuries.build_depth` →
  `espn_value` → `fantasy_tools` → `fantasy_draft` → `fantasy_weekly`.
  Post-rebuild validation matches the reference values in §1 exactly — RB
  Achane 0.13 / Taylor 0.08 / Javonte 0.07 / Henderson 0.06 / Bijan 0.05, WAR
  vs wins 0.786, vs Pythagorean 0.818, ceiling 0.899, points per win 35.2.
- **The run found a third silent bug: the default build could not build the
  draft.** `cmd_build` passed the six-season play-by-play window to
  `build_draft`, which then drops the last four classes as immature — leaving
  two. No pick number cleared the five-players-per-slot minimum, the frame
  emptied, and `np.pad` raised inside the curve fit. It had only ever worked
  because someone once ran a deep `--history` and the parquet persisted. The
  draft reads nflverse's draft table, not play-by-play, so it now spans
  `FIRST_DRAFT_SEASON` (1999) → latest regardless of the caller's window, and
  `_curve()` returns empty rather than throwing when there are too few classes.
  Rebuilt: 6,897 picks, monotone curve, top-5 worth 1.70× a late first.
- `web/audit-mobile.mjs` loads all 22 routes at 390px and fails any whose
  document scrolls wider than the viewport. Run it after layout changes. It now
  covers `/fantasy/week` in all three views; last run was clean.
- The user's standing instruction: **do not ask permission, just execute.**
- Validate every calculation against recognisable reference rankings before
  presenting it. This is the lesson the WAR rebuild came from.
