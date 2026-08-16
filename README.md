# Hashmark — NFL analytics

A full-stack NFL analytics site: opponent-adjusted team efficiency, player cards with positional
percentiles, leaderboards and a play-by-play query layer — all built on free, open data.

```
pipeline/   Python ingestion (nflverse → parquet)
web/        Next.js app (DuckDB reads the parquet directly)
data/       generated; not in version control
BLUEPRINT.md   research: data sources, metric catalog, WAR design, architecture
IDEAS.md       market research and a ranked backlog of what to build next
CLOUDFLARE.md  the Cloudflare deployment plan — read before deploying anywhere
mockup.html    the original design mockup
```

## How it fits together

The pipeline pulls from nflverse, computes everything derived (opponent-adjusted EPA, drive stats,
per-play player rates, positional percentiles) and writes **parquet**. The web app queries those
files in-process with **DuckDB** — no database server, no ORM, no import step. A full-season scan of
~49,000 plays takes milliseconds, so the app can afford arbitrary filters instead of precomputed
aggregates.

Live game state is the one exception: it comes from ESPN's public API at request time and is
reconciled against nflverse once a game finalizes.

## Setup

```bash
# 1. data
cd pipeline
pip install -r requirements.txt
python -m nflx.cli build                 # full 1999+ history
python -m nflx.cli build --history 6     # shallow store for a fast dev loop
python -m nflx.cli build --seasons 2025  # or just one

# 2. app
cd ../web
npm install
npm run dev                              # http://localhost:3000
```

The app reads `../data` relative to `web/`. Override with `NFLX_DATA_DIR`.

## Pipeline commands

```bash
python -m nflx.cli build                  # full rebuild, all 27 seasons
python -m nflx.cli build --history 6      # shallower play-by-play store
python -m nflx.cli live                   # ESPN scoreboard snapshot
python -m nflx.cli inspect team_season    # print a built table
```

### What gets built

| Output | Contents |
|---|---|
| `teams.parquet` | 32 clubs: colors, logos, conference/division |
| `games.parquet` | schedules and results incl. spread, total, roof, coaches |
| `pbp/season=YYYY.parquet` | play-by-play, trimmed to ~75 columns the site uses |
| `team_season.parquet` | EPA splits, drive stats, tendencies, opponent adjustment, ranks |
| `standings.parquet` | records, Pythagorean wins, luck, seeds |
| `players.parquet` | player index: bios, IDs, headshots |
| `player_season.parquet` | season lines + per-play rates + NGS + positional percentiles |
| `player_week.parquet` | weekly game logs |
| `fourth_downs.parquet` | every 4th down scored against the decision model |
| `fourth_down_teams.parquet` | team/coach aggressiveness and win probability surrendered |
| `fourth_down_grid.parquet` | 1.3M precomputed situations for the calculator |
| `formation_splits.parquet` | formation, personnel, coverage shell and man/zone usage + EPA |
| `charted/season=YYYY.parquet` | play-level pbp joined to participation — what the Lab filters on |
| `participation_team.parquet` | pressure, blitz, box counts by team |
| `war_season.parquet` | WAR and PAR per player season, split by role |
| `war_career.parquet` | career WAR and PAR totals across every stored season |
| `war_role.parquet` | WAR split by role (passer / carrier / receiver / defender / line) |
| `playoff_seeds.parquet` | exact seeding from the NFL tiebreaker tree |
| `playoff_odds.parquet` | Monte Carlo playoff, division and seed odds |
| `game_previews.parquet` | projected margin, total, score and win probability for unplayed games |
| `market_games.parquet` | every played game scored walk-forward against the closing line |
| `market_teams.parquet` | clubs the market persistently over- or under-rates |
| `coach_seasons.parquet` | every coach-season: record, tendency, aggressiveness, predictability |
| `coach_careers.parquet` | the same, carried across every club a coach has led |
| `player_ids.parquet` | Sleeper player id → our gsis id, for league sync |
| `draft_picks.parquet` | every pick 1999+ with career value, combine testing and value over slot |
| `draft_curve.parquet` | expected career AV by pick number, monotone-fitted |
| `draft_teams.parquet` | club draft returns against what their slots were worth |
| `trade_picks.parquet` | expected career return by pick in both AV and WAR |
| `trade_pick_mix.parquet` | what each band of the draft returned, by position |
| `trade_aging.parquet` | aging curves by position, fit with the delta method |
| `trade_war_spread.parquet` | WAR spread by position — why dollar valuation is blocked |
| `fantasy_season.parquet` | fantasy points, value over replacement, expected points, weekly spread |
| `fantasy_replacement.parquet` | replacement level per position per season |
| `fantasy_draft.parquet` | next-season projections, consensus rank in six formats, schedule, bye, availability |
| `fantasy_defense.parquet` | fantasy points allowed per game by each defence to each position |
| `fantasy_sos.parquet` | schedule difficulty per club per position, full season and playoff weeks |
| `fantasy_byes.parquet` | bye week per club |
| `fantasy_availability.parquet` | share of games played over the last three seasons |
| `fantasy_weekly.parquet` | every projected player by week: opponent, matchup adjustment, projected points |
| `fantasy_ros.parquet` | rest-of-season points, per-game rate and positional rank |
| `fantasy_waivers.parquet` | wire candidates ranked on value against ownership |
| `fantasy_variance.parquet` | fitted weekly scoring spread per position, `sd = a + b x projection` |
| `depth_charts.parquet` | latest published depth chart per club, `depth_rank` 1 = starter |
| `injury_rates.parquet` | measured probability a listed player suits up, by designation and practice |
| `injury_reports.parquet` | current designations with the play probability attached |
| `contracts.parquet` | Over The Cap contract years with cut and restructure math |
| `cap_summary.parquet` | team cap commitment and space |
| `line_team.parquet` | adjusted line yards, pressure and sack rate allowed, stuff rates |
| `separation_receivers.parquet` | depth-adjusted separation score |
| `coverage_defenders.parquet` | depth-adjusted coverage score |

## Pages

| Route | What it is |
|---|---|
| `/` | live scores, league averages, efficiency and QB value |
| `/week` → `/week/[season]/[week]` | the week in review: biggest swings, worst fourth downs, what the market missed |
| `/scores` → `/games/[id]` | scoreboard; game pages resolve scheduled (projection), live (ESPN id) or completed (our id) |
| `/standings` | records with Pythagorean wins, luck, opponent-adjusted net, real tiebreaker seeds |
| `/teams` → `/teams/[abbr]` | efficiency quadrant and table; team hub with formations, coverage, pressure, 27-season franchise history |
| `/stats` | the full explorer — every stored column, sortable, filterable, CSV export |
| `/war` | WAR leaderboard with positional percentile, method and published backtests |
| `/playoffs` | exact seeding plus Monte Carlo playoff, division and seed odds |
| `/separation` | depth-adjusted separation and coverage scores |
| `/draft` | pick value curve, club draft returns, class explorer, steals and misses |
| `/fantasy` | value over replacement board, expected points, regression candidates |
| `/fantasy/draft` | draft board that re-ranks for your league: size, scoring, superflex, TE premium |
| `/fantasy/week` | start/sit for one week, rest-of-season ranks, waiver targets |
| `/fantasy/league` | connect Sleeper: power rankings, optimal lineup, matchup odds, free agents |
| `/tools/armchair-gm` | cap sheet with real cut and restructure math, PAR per dollar, live depth chart |
| `/coaches` | aggressiveness, pass tendency and play-call predictability, by career |
| `/market` | the projection against the closing line, with a walk-forward ATS backtest |
| `/lab` | split explorer: any filter combination against the play store, live |
| `/tools/fourth-down` | decision calculator plus how coaches actually decided |
| `/players/[id]` | player card: percentiles, WAR, splits, game log, career |

## Data sources

nflverse (play-by-play 1999–present, rosters, snap counts, contracts), NFL Next Gen Stats,
Pro Football Reference advanced stats, FTN charting, Over The Cap, ESPN. See `BLUEPRINT.md` for the
full catalog, update cadence and licensing notes.

## Deploying

The target is **Cloudflare**. See `CLOUDFLARE.md` for the architecture, the commands and what is
still outstanding — read it before deploying anywhere.

The short version: DuckDB's native binding cannot run in a Workers isolate, so it never runs in
production. The nightly GitHub Action prerenders every route against the parquet store at build time
(where the native binding works), pushes parquet and the DuckDB-WASM runtime to R2, and deploys
static assets plus a small Worker. The Worker handles only live ESPN state; the interactive
surfaces (`/lab`, `/stats`, season switching) query the same parquet from the browser over
DuckDB-WASM. Cost is $0/month on the free tier.

## Models

| Model | What it is | Fit on |
|---|---|---|
| Win probability | a distillation of nflfastR's per-play `wp` into a callable function, so hypothetical states can be priced | 247k plays, holdout MAE 0.029 |
| Conversion | P(convert) by distance and field position | 48k third/fourth down snaps |
| Field goal | P(make) by kick distance | 6.6k attempts |
| Punt | expected opponent field position, from where the next drive actually started | 12k punts |
| Fourth down | composes the four above into win probability for go / kick / punt | — |
| Tiebreakers | the real NFL ladder — head to head, common games, strength of victory | reproduces 2020–2025 fields exactly |
| Season simulation | margin from rating difference plus home field, seeded through the tree | 10,000 sims |
| WAR | ridge credit allocation per role, measured replacement, block bootstrap | 6 seasons, per season |

### WAR and PAR, and what the backtests say

The model computes **PAR — points above replacement** — and WAR is PAR divided by the fitted cost
of a win (35.2 points). Both are published so the conversion stays visible.

Offensive roles are fit separately against a target already attributed to them: the quarterback
owns the dropback (`qb_epa`, sacks included), the receiver is credited with yards after the catch
(`yac_epa`) rather than the throw, the carrier gets the run. Ridge shrinkage handles small samples;
replacement is the usage-weighted level of everyone outside each role's starter pool.

**Defenders are valued from individual charted production**, not plus-minus — pressures and sacks
generated, receptions and yards allowed in coverage, tackles missed — priced with EPA constants
measured from our own play-by-play (a sack is worth ≈1.9 EPA, a pressure ≈0.2).

**Every position is now covered.** Offensive linemen receive their unit's protection and run
blocking split by snaps. Kickers are credited with makes above the probability of the kicks they
were actually given, punters and returners with EPA against the average outcome from the same spot.
Long snappers have no public data and are not rated. Eight roles in total: passer, carrier,
receiver, defender, line, kicking, punting, returns.

Two rewrites got us here, both for the same reason: **unidentified credit**.

1. Passer and receiver in one regression against play EPA. Both are on every pass play, so ridge
   split their credit arbitrarily and slot receivers graded alongside franchise quarterbacks.
2. Defensive plus-minus over snaps. Starters take ~95% of a unit's snaps, leaving almost no on/off
   variation, so the leaderboard tracked team defensive rank (r = −0.35) and T.J. Watt graded
   negative.

| Check | Result | Read |
|---|---|---|
| Team WAR vs actual wins (2020+) | r = 0.76 | inside the band complete MLB WAR occupies |
| Team WAR vs actual wins (all 27 seasons) | r = 0.61 | the earliest years have no receiver, defensive or line value to sum |
| Team WAR vs Pythagorean wins (2020+) | r = 0.80 | against expected wins from point differential |
| **Ceiling: point differential vs wins** | **r = 0.90** | knows every score and still misses |
| QB year over year | r = 0.40 (n = 658) | matches passing yards (0.42); rate stats repeat higher |
| Points per win | 35.2 | fit on 192 team seasons |

Read the first against the third, not against 1.0 — a single NFL season carries enough luck that
point differential itself only reaches 0.90. Complete MLB WAR, covering every hitter and pitcher,
lands around r = 0.64–0.87 depending on the version. Adding defenders moved ours from 0.55 to 0.73;
adding the offensive line took it to 0.76.

The stability figure is a *volume* statistic and belongs beside other volume statistics. Over the
same seasons, passing yards repeat at r = 0.366 and our WAR at 0.370 — effectively identical. Rate
statistics repeat higher (EPA per dropback 0.501, CPOE 0.429) because they carry no playing-time
noise. Shrinking WAR toward a player's other seasons would raise that number without adding
information, so it is not done.

### Checked against ProFootballStatCards' PAR

Will Roberts publishes a metric of the same name at
[profootballstatcards.com](https://profootballstatcards.com/production-above-replacement), and the
two share only the name. His **Production Points** are a linear box-score model whose weights come
from each statistic's relative frequency to a touchdown, and his PAR is that total minus the
**median** at the position. Both halves differ from ours: the target is counting stats rather than
EPA, and the baseline is the average starter rather than a replacement pool.

Reimplementing his published v3 weights on our own weekly data over 2020–2025 puts numbers on the
difference across 8,845 shared player seasons:

| | His PAR | Ours |
|---|---|---|
| Team totals vs actual wins | r = 0.713 | **r = 0.769** |
| Team totals vs Pythagorean wins | r = 0.719 | **r = 0.791** |
| Year over year, same player | r = 0.615 | **r = 0.686** |
| Running back PAR vs touches | **r = 0.923** | r = −0.178 |

The two agree where a box score nearly is the value — quarterbacks r = 0.83, defensive linemen 0.81,
receivers 0.78 — and part company exactly where it is not: backs r = 0.12, defensive backs 0.22.
That last row is the reason. His running back PAR is a volume statistic wearing a value statistic's
name; ours is efficiency against a situation-adjusted expectation, so it is very nearly orthogonal
to touches. And a median baseline puts 65% of qualified quarterbacks "below replacement", which is
not what the phrase means anywhere else it is used.

So nothing was adopted from the model. **One thing was adopted from the presentation.** His own
documentation makes the point that PAR cannot be read across positions without a percentile, and
that is a real weakness of ours: the best running back season is worth about a fifth of a win, so
0.13 and 0.05 look like rounding noise until you know one led the league and the other was
fifteenth. The season leaderboard now carries a **percentile against everyone at that position who
cleared the usage qualifier**, computed over the qualified pool rather than the fifty rows on
screen.

## Known gaps

- Offensive line and interior defensive line value is unit-level; public data has no per-snap
  block or pressure charting.
- Simulated seasons hold team ratings fixed: no injuries, trades or in-season improvement.
- The cap sheet counts only contracts running into the league year, so teams whose deals expire
  first show more space than their real sheet has. Tenders, options and existing dead money are
  not carried, and cuts are treated as pre-June-1.
- Armchair GM's depth chart is the newest one nflverse has published for the league year, which in
  August is a camp projection rather than a week 1 lineup. Injury designations join only when the
  report season matches the league year being viewed, so they are absent in the offseason by
  design — carrying January's forward would show a playoff designation as current status.
- Offensive linemen share one unit number split by snaps — an allocation, not a measurement.
- Defensive PAR has no interval: the charting is season-level, so the game-resampling bootstrap
  that gives offensive roles their error bars has nothing to resample.
- The fourth down model does not know personnel: a backup quarterback gets the league-average
  conversion rate. The calculator grid also holds timeouts at 3/3.
- Formation vocabulary changed vendors in 2023 (7 buckets to 3), so cross-era formation
  comparisons are not like for like. Personnel groupings are consistent throughout.
- Participation data is published only after the postseason, so the current season lags.
- Game pages show ESPN highlight clips when ESPN has them, which is for a few days after a game and
  not afterwards: sampling fourteen 2025 regular-season games six months on returned zero clips,
  while games from the previous night returned four or five each. Clips are linked, never embedded —
  the feed hands over a direct CDN mp4, but playing it here would use their bandwidth, skip the
  advertising the clip carries, and ignore the per-country licensing the payload declares.
- Player tracking is still absent. Big Data Bowl is the only public route to it and the download is
  gated behind a Kaggle account and per-competition rules acceptance; the API returns 401 without a
  token, and none is configured.
- The Lab's charted filters (formation, personnel, coverage, pressure) start in 2016 because
  participation data does; selecting one narrows the season range rather than returning nothing.


## Separation and coverage

Raw separation mostly measures route depth, and the data is emphatic about the direction:
separation **falls about 0.12 yards for every yard of target depth**. Screens and flat routes
create space almost automatically; a contested ball twenty yards downfield does not. A leaderboard
sorted on the raw number is closer to a list of who runs shallow routes than who gets open.

Both sides are therefore measured against what their target depth predicts, on a scale where 100 is
average and 15 points is one standard deviation:

- **Separation score** — receiver separation against expectation at his average intended air yards
  (Next Gen Stats tracking).
- **Coverage score** — defender yards allowed per target against expectation at his average depth
  of target, which rise about 0.17 per yard (Pro Football Reference charting).

The asymmetry matters and is stated on the page: receiver separation is genuinely tracking-derived,
but the league does not publish separation *allowed*, so coverage score is an outcome measure —
what happened when a defender was thrown at, which carries the quarterback's accuracy and the
receiver's hands along with the coverage.


## Historical depth and what exists when

The store holds **1999–2025 — 27 seasons, 1.28 million plays**. Sources begin at different points,
and a metric built on a source that does not exist yet is *absent*, not zero. The boundary for
receiver value was verified directly against the feed: air and YAC EPA are 0% populated in 2005 and
100% in 2006, the year the league began recording air yards.

| From | Source | Unlocks |
|---|---|---|
| 1999 | play-by-play | EPA, win probability, passing and rushing WAR, kicking, punting, returns |
| 2006 | air yards | receiver WAR, CPOE |
| 2012 | snap counts | offensive line WAR |
| 2016 | Next Gen Stats | separation score |
| 2018 | PFR charting | defensive WAR, coverage score |
| 2020 | participation | formations, pressure, coverage shells |

`roles_available(season)` in `nflx/config.py` encodes this, and the WAR build skips a role rather
than producing a column of zeros for it. The backtests are reported twice for the same reason: a
single blended correlation across 27 seasons understates the model badly, because most of those
seasons are missing most of a roster.

Career and all-time leaderboards fall out of the depth. The top career figures — Brady 68.9, Brees
55.0, Manning 54.5 — and the best single seasons — Brady 2007 at 7.95, Manning 2004 at 7.89,
Mahomes 2018 at 7.35 — are the seasons the sport already regards as the best of the era, which is
the cheapest available sanity check on a historical build.


## Season navigation

Every page that shows one season at a time takes a `?season=` parameter and renders a picker:
standings, teams, the team hub, player cards, the Lab and the fourth down page. Recent years are
laid out in full and the rest collapse into a scrollable tail, because 27 equal chips swamps a page.

Deep history surfaces gaps that a six-season window hid, and those are labelled rather than papered
over. Snap counts begin in 2012, so a 2007 team page shows "—" for snap share instead of 0%, and
the defensive playing-time table explains that it cannot be built for that season rather than
rendering empty.


## Game projections

A scheduled game gets a projected score, win probability and model line. Team strength blends last
season's opponent-adjusted rating with this season's scoring margin, weighted `n / (n + 8)` in games
played — so week 1 rests entirely on the carried rating and the handover is gradual. The carryover
is measured, not assumed: net rating persists year to year at 0.47, offence at 0.49 and defence at
only 0.34, which is the familiar result that defensive performance is the less repeatable half.

Every coefficient is fit at build time against real results. Walk-forward across 5,455 games from
2005 on, fit only on seasons before each test year:

| | Model | Vegas closing line |
|---|---|---|
| RMSE | 13.59 | 13.20 |
| MAE | 10.58 | 10.25 |
| Straight-up | 64.2% | 66.8% |

Correlation with the closing line is 0.863, and the probabilities are calibrated — games given a
70-80% chance were won 75.5% of the time. The market is still better, which is the honest way to
present it. The model knows nothing about injuries, free agency or who is starting at quarterback.

**These figures are now built rather than quoted.** They used to be computed once by hand and pasted
into this file; `build/market.py` reproduces them at build time and writes `market_validation.json`,
so they move when the model moves. `/market` publishes the whole thing, including the part that does
not flatter it: against the spread the model picks the covering side **50.5%** of the time over
5,067 games, below the **52.4%** a −110 price needs to break even. And the hit rate *falls* as the
model's disagreement with the line grows — 51.6% when it is within a point, 49.0% at three to six —
which is the clearest evidence available that the closing line already knows what the model knows.

**One set of preseason ratings.** The season simulation and the game projections share them, via
`preseason_ratings()` in `models/preview.py`. They used not to: the simulator applied last season's
rating at full strength to a season nobody had played, which put the Rams at 99% to reach the 2026
playoffs and the Jets at 0.0% before week 1. Ratings carry over at 0.47, not 1.0. With the same
blend the previews use, expected wins run 5.5 to 10.9 and playoff odds 4.7% to 81.7% — and expected
wins sum to exactly 272, one per game, which is the arithmetic check that the simulation is sound.

**A sign convention worth stating**: nflverse stores `spread_line` as the points the *home* team is
favoured by, so a home favourite is positive. A posted betting line states the favourite as a
negative number. `line()` in `web/src/lib/format.ts` does the flip, because printing the stored
value directly labels every favourite as an underdog.

## The draft

Pick value is measured in Pro Football Reference's weighted career Approximate Value rather than
this site's WAR. That is a deliberate downgrade in precision to buy coverage: defensive WAR needs
charting that starts in 2018 and line WAR needs snap counts from 2012, so a defender drafted in 2004
has no WAR at all and would silently score as a bust. AV is cruder but exists for every position in
every year, which is what a question spanning twenty-seven drafts requires. Career WAR is joined on
anyway, for the modern classes where it is complete.

Two choices carry the result. A pick who never played counts as a zero rather than dropping out of
the sample — removing them is what makes late rounds look productive. And the last four classes are
excluded, because a 2024 pick has not had the chance to accumulate value and counting him as a bust
would bend the tail down.

The analysis spans every class on record rather than the play-by-play window the rest of the build
uses — it reads nflverse's draft table, not plays, and a pick value curve needs decades of classes
before it has anything to fit.

The published curve is a light rolling mean forced monotone by isotonic regression, weighted by how
many players stand behind each pick (R² 0.915 against the raw per-pick means). An exponential was
the obvious parametric choice and is the wrong one — no single decay rate holds both the very steep
fall across the first few picks and the long flat tail, so it either overshoots pick 1 or undershoots
it depending on which space it is fit in. Monotonicity is the one thing genuinely known in advance.

The headline: a top-five pick returns **1.7×** what a late first-rounder returns, while the standard
trade chart prices the top of the round several times higher. That gap is the surplus behind trading
down, and has been the finding since Massey and Thaler put numbers on it in 2005.

### The same picks, priced in wins, disagree

Run the identical curve in WAR instead of AV and a top-five pick is worth **11.5×** a late first,
not 1.7×. The entire gap is quarterbacks. Among top-ten picks from 2012–2021:

| Position | Career WAR | Career AV |
|---|---|---|
| **QB** | **12.14** | 60 |
| DE | 1.64 | 50 |
| DB | 1.22 | 34 |
| CB | 1.00 | 37 |
| LB | 0.60 | 54 |
| WR | 0.41 | 37 |
| T | 0.09 | 48 |
| RB | −0.06 | 55 |

AV rates a top-ten quarterback and a top-ten tackle as near-equals; WAR has the quarterback ahead by
two orders of magnitude. Both are the same players. AV compresses positional value by design and WAR
does not, so **a top pick's value in wins is mostly an option on a quarterback** — which is worth
knowing before reading the AV curve as though every slot were fungible. `/draft` publishes both
curves side by side with the position breakdown.

### Aging curves

`trade_aging.parquet` holds a curve per position, shown on every player card. It is fit by the
**delta method** — the same player compared in consecutive seasons — because the obvious
construction, mean WAR by age, is dominated by survivorship: weak players leave, so the average at
32 is an average over survivors and the curve peaks wherever attrition is harshest. Fit that way the
running back peak landed at 21. Delta-fit, the curves land where the literature expects:
quarterbacks climb to 28 and fall away hard after 32, backs decline from 22, corners hold to 26 and
then drop steeply.

## Fantasy

Raw fantasy points rank every quarterback above every running back and say nothing, because the two
are never chosen against each other. Value over replacement prices each player against the freely
available alternative at his own position — the same idea WAR applies to real football. Replacement
is the last startable player in a twelve-team league (QB12, RB24, WR36, TE12); the flex is
deliberately not spread across positions, since that would make the baseline depend on how each
league happens to fill it. VOR multiplies the per-game edge by games played, so missed time costs.

Expected points come from nflverse's opportunity model, which prices every carry and target by down,
distance, field position and air yards. **That model scores on its own system — it counts first
downs — so its totals run above the PPR figures beside them and the two must not be subtracted from
one another.** Both its actual and its expected are carried through so the gap is always computed
inside one scoring system. Expected points need air yards and so begin in 2006.

## Fantasy projections and the draft board

`/fantasy/draft` re-ranks for the league you are actually in. Scoring formats differ only in what a
catch is worth, so the whole board is re-derived from two projected quantities — PPR points and
receptions — rather than storing a separate list per format. Roster rules work the other way round:
superflex does not change what a quarterback scores, it changes how many are gone before the
position stops being scarce. Flipping it moves QB replacement from 269 projected points to 228 and
lifts quarterbacks roughly thirty places.

The projection is fit per position on 2006–2025. Four inputs, each measured before being trusted:

| Input | What the data says |
|---|---|
| Last season's PPG | Strongest single input, r ≈ 0.77 to the following year |
| Sample-size regression | Rates shrunk toward the positional mean by `games / (games + 4)`; k = 4 minimises error |
| A second prior season | The biggest addition — R² 0.588 → 0.632 |
| Expected points | Real but small — R² 0.588 → 0.595, so about a third of the weight of actual |

Two findings worth stating plainly. **Expected fantasy points are not more predictive of next season
than the points actually scored** — they are essentially tied, which is the opposite of the usual
claim; xFP earns its place as a small correction, not as a replacement. And **ageing is sharply
position-dependent**: backs start losing ground at 26 and shed more than two points per game a year
by 32, receivers hold to about 26, while tight ends and quarterbacks decline gently and late.

**Backtest.** 3,219 player seasons from 2014, fit only on prior years: RMSE 3.35. Against the naive
"repeat last season" baseline that is a 10.4% improvement — but that is the flattering comparison.
Give the baseline the same sample-size regression, which costs nothing, and it reaches 3.49, leaving
a **4.0%** edge. Four percent is the honest number; most of what is knowable is already in last
season's line.

### Draft kit

Surveying what the established tools carry (Draft Sharks, PlayerProfiler, FantasyPros, FFToolbox),
the same handful of features recur. Four of them are built here from data already in the store:

- **Auction values.** Any budget, recomputed with the league settings. Pricing deliberately uses a
  deeper baseline than the ranking does: value over the last *starter* is the right way to rank, but
  pricing against it concentrates the whole budget in about eighty players and prints a $107 top
  pick. Pricing against the worst player who still gets drafted — standard auction VBD — puts the
  top bid at $46 in a 12-team $200 league and $70 at $300, which is where they actually clear.
- **Strength of schedule**, by position, built the conventional way: fantasy points allowed per game
  by each defence, ranked 1–32, averaged across each club's opponents. Playoff weeks (15–17) are
  ranked separately, because a club can have an easy September and a brutal December.
- **Bye weeks**, derived from the schedule rather than a second source.
- **Availability**, the share of games played over three seasons, which flags the injury history the
  projection's per-game rate deliberately ignores.

### In season

`/fantasy/week` replaces the draft board once games start: a weekly start/sit board, rest-of-season
ranks, and a waiver list. A weekly projection is a scoring rate times the draw. The rate blends what
a player has done this season into his preseason projection at `games / (games + 4)`, the same
shrinkage the projection model is fit with, so before week 1 it is purely the projection and by
December it is almost purely this season.

**The matchup adjustment is fit rather than assumed, and it is small.** The standard construction
multiplies a projection by the opponent's fantasy-points-allowed index, which asserts the entire
spread between defences survives into this year and into this week. Regressing 48,103 player weeks
on the opponent's prior-season index — holding the week being predicted out of the player's own
rate, so the baseline cannot see the answer — gives a coefficient nowhere near 1:

| | QB | RB | WR | TE |
|---|---|---|---|---|
| Coefficient on the opponent index | 0.26 | 0.13 | 0.10 | 0.09 |
| Easiest-to-hardest swing at 12 ppg | 2.4 pts | 1.2 pts | 0.8 pts | 1.2 pts |

Those are tiebreakers between close starts, not reasons to bench a good player, and the page says so
rather than manufacturing confidence. Defensive generosity also only carries year to year at about
0.23, which the fitted coefficient already prices in.

Schedule difficulty is the one to be careful with, and the page says so. The gap between the easiest
and hardest schedule is 7.7% of league-average points for backs and about 15% for receivers and
quarterbacks — and it is built entirely on last season's defences, which carry year to year at only
0.34. Expect roughly a third of that spread to survive. It is a tiebreaker, not a reason to move
anyone up a round.

Consensus ranks come from FantasyPros, scraped fresh, and are selected by `page_type` rather than
`ecr_type` — the latter folds redraft-overall together with redraft-IDP and puts a linebacker at the
top of a board meant for skill players. The board reports its own systematic disagreement with
consensus by position, because it has one: it runs high on tight ends and low on backs relative to
the room, which is the usual VOR-against-ADP divergence and worth knowing before trusting any single
row. Rookies are shown separately with a consensus rank and no projection — there is no NFL season
to project from and this pipeline does not ingest college data.

## The Lab

The Lab asks the play store directly rather than reading a precomputed page, so any combination of
filters is fair game: third and long from the red zone, 12 personnel against man coverage, trailing
in the fourth quarter. Group by team offence, team defence, quarterback, ball carrier or receiver.

Every filter is an entry in a fixed table in `web/src/lib/splits.ts` that owns its own SQL fragment.
Nothing a visitor types reaches the query — an unknown key does not match an entry and is dropped.
Filters needing charted data switch the source from the full 1.28M-play store to the 344k-play
charted store, which is why they carry a start season.

Results are compared against the league average **for the same split**, not the league overall. A
red zone leaderboard is judged against red zone offence, which is the comparison that means
something; measuring red zone plays against all-downs average would rank every team below average.

## Your league

`/fantasy/league` connects a real league and re-points the tools at it. Ten views: power rankings by
projected rest-of-season points, all-play standings with schedule luck, an optimal lineup with the
swaps worth making, matchup odds, trade targets, a two-sided trade simulator, the free agents nobody
in *your* league has rostered, the transaction log, a weekly scoreboard and a season summary.

**All-play** is the one worth explaining. A fantasy record is mostly the schedule: beating the one
opponent you drew says less than how your score ranked against the whole league. Scoring every team
against every other team every week gives the record the schedule would have produced, and the gap
between that and the real record is **luck** — the number everybody in a league argues about and
nobody computes. Verified against a completed season: one team went 11–3 on a 53.6% all-play record
(+3.5 wins of luck) while another went 5–9 on a *better* 54.2%.

**The trade simulator** prices a proposal on *both* optimal lineups, so surplus depth is correctly
worth nothing and a swap can improve both sides at once — which is the only kind that ever gets
accepted. State lives entirely in the query string, so a proposal is a link you can paste into the
league chat.

**Trade targets** works the opposite way round from a blank trade calculator. Rather than asking you
to guess first, it prices every rostered player in the league against *your* optimal lineup and
reports what each would add. A star at a position you are already deep at scores near zero, which is
the whole point — it prices the fit, not the player.

**Sleeper connects from a username; ESPN cannot.** Sleeper's read API is public, so a username
resolves to a user id and a user id lists their leagues — a genuine connect flow with no password
and no permissions granted. ESPN publishes no equivalent sign-in for fantasy, and the tools that
appear to connect to it do so through a commercial partnership; the only do-it-yourself route is
copying `SWID` and `espn_s2` out of a logged-in browser, which are full account credentials rather
than scoped tokens. So ESPN takes a league id and works only for leagues set to public. Nothing is
stored either way — the league in the address bar is the whole of the state.

**Matching a roster to the store is the hard part.** Sleeper populates a gsis id for only about a
sixth of rostered players and an ESPN id for a quarter, so `build/league_ids.py` falls through four
layers — gsis, ESPN id, name with club, name alone — and reaches about 93%. The residue is rookies
and undrafted free agents with no NFL snap, who are listed by name rather than dropped.

### Matchup odds

A projection is a mean; a matchup is decided by the spread around it. That spread is strongly
heteroscedastic, so `fantasy_variance.parquet` fits `sd = a + b × projection` per position across
38,758 player weeks:

| | QB | RB | WR | TE |
|---|---|---|---|---|
| Base | 6.27 | 3.58 | 3.58 | 2.58 |
| Slope | **0.097** | 0.300 | 0.309 | **0.387** |
| Fit r | 0.84 | 0.95 | 0.96 | 0.98 |

The slopes change decisions: quarterback spread barely moves with the projection while tight end
spread scales steepest, so a projected fifteen-point quarterback is a much safer start than a
projected fifteen-point tight end.

Each lineup is then a sum of independent per-player normals, which makes the team total normal and
the margin normal too — so the win probability is closed-form and identical on every render, with
no simulation and no seed. Independence is the approximation and the page says so: a quarterback
stacked with his own receiver is correlated, and a real stacked lineup has a wider spread than this
computes. Odds are withheld entirely when either lineup has fewer than 60% of its slots projected,
because an empty slot contributes nothing and would otherwise let the model report a confident
100%.

## Coaching

`/coaches` follows a coach across every club he has led rather than treating him as an attribute of
a team-season — `games.parquet` carries `home_coach` and `away_coach`, which is the key that was
missing. Fourth-down aggressiveness comes from the decision model, pass tendency from PROE, and
tempo and discipline from the play store.

The measurement worth naming is **play-call entropy**, which nothing free publishes. For each down
and distance bucket, take the coach's pass/run split and compute its binary entropy in bits, then
average the cells weighted by how often each comes up. A coach who runs every first-and-ten and
throws every third-and-long scores near 0; one splitting 50/50 everywhere scores 1.0. It measures
*predictability, not quality*, and the two come apart — a coach can be predictable because he is
committed to something that works.

Everything except the win-loss record is computed from neutral game states (win probability between
20% and 80%). A coach down twenty-one in the fourth is not calling the game he wants to, and
including those snaps makes every trailing team look pass-happy and unpredictable. Rates are
weighted by snaps rather than averaged across seasons, so a seventeen-game year does not count the
same as a three-week interim spell.

## The week in review

`/week` always lands on the newest completed week; `/week/[season]/[week]` is the permalink. Five
panels, all assembled from tables that already exist: the biggest plays by win probability added,
the best individual weeks, which clubs played above and below *their own* season average, the
fourth downs that cost the most win probability, and the results the closing line missed by most.

Two sections IDEAS asked for are deliberately absent. Playoff-odds swings and weekly waiver
movement both need a per-week snapshot, and `playoff_odds` and `fantasy_waivers` each store one row
per season — there is no history to difference. Manufacturing the movement from a single snapshot
would be worse than leaving it out, so the page says so instead.

One measurement note worth carrying: individual weeks are ranked on PPR, not on win probability
added, because `wpa` in the weekly player table is only populated for passers. In a sample week it
covered 32 of 34 quarterbacks and one receiver out of 128, so ranking on it produced a "best
individual weeks" list that was ten quarterbacks by construction.

## Sharing

Every page emits a generated Open Graph card, so a link pasted into Slack, iMessage or Bluesky
renders the numbers rather than a blank rectangle: `opengraph-image` routes exist for the home page,
`/war`, `/players/[id]`, `/teams/[abbr]` and `/games/[id]`, all built from the same shell in
`web/src/lib/og.tsx`.

Two constraints shape them. **No club marks** — logos and headshots belong to the clubs and the NFL,
so a card carries only team colours, abbreviations and figures we computed; the accent stripe does
the work a crest would. And a club whose primary colour is navy would vanish into the card's navy
footer, so the stripe falls back to the secondary colour when the primary is too dark to separate.

Set `NEXT_PUBLIC_SITE_URL` in the deploy environment. Without it `metadataBase` falls back to
localhost and the cards resolve to nothing off your machine.

Signature charts also carry a **PNG button** on hover — the win probability chart, aging curves, the
pick value curves and the player weekly chart. The charts are server-rendered SVG, so the export
clones the node, resolves every CSS custom property to a literal (a serialised SVG has no document,
so `var(--c1)` renders black), paints the panel background, and draws to a 2× canvas with the
Hashmark mark and a caption baked in. The team efficiency quadrant is deliberately excluded: it
draws club logos with `<image href>` from a remote host, which taints the canvas.

## Text, and where it goes

Analytical pages here have a lot to say — the model choices are the interesting part, and the site
publishes what it does not know. That is worth keeping, but it had ended up in the reader's way:
eleven pages opened with a 65 to 130 word paragraph before any data, four had grown a bullet wall of
caveats under four different headings, and the WAR leaderboard sat 672px down the page behind six
methodology cards.

Two primitives fix it without deleting anything.

- **`<Deck>`** — one sentence under the page title, capped at a 68-character measure. It says what
  the page is, not how it works.
- **`<Notes>`** — a `<details>` at the foot of the page, shut by default, always titled
  *Method & limits*. Every caveat, derivation and backtest reading lives here. Columns are sized
  rather than counted (`columns: 21rem`), so the measure stays readable and collapses to one column
  on a phone with no media query.

Prose a reader meets before opening anything fell from 2,408 words to 360 across nineteen routes,
and the WAR board now starts at 298px. `web/audit-text.mjs` reports visible words, collapsed words
and first-data depth per route; run it alongside `audit-mobile.mjs` after touching a page.

The same pass fixed three layout defects worth naming, because they are the kind that read as
carelessness: two columns both headed "WAR"; a fourth-down calculator whose left track ended 260px
short of its right, leaving a hole in the middle of the page; and a 2.5px tick standing in for a
value bar, now a diverging bar filled from the zero line.

## Narrow screens

Every page is checked at 390px by `web/audit-mobile.mjs`, which loads each route and fails any whose
document scrolls wider than the viewport. Wide tables scroll inside their own panel via `.scroll-x`
rather than dragging the page sideways — which needs `min-width: 0` on grid and flex children,
since the `auto` default lets a wide table stretch its track instead of scrolling within it. Chip
rows set `shrink-0` so that same rule does not crush them below their text.
