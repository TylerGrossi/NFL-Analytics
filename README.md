# Gridiron Analytics

A full-stack NFL analytics site: opponent-adjusted team efficiency, player cards with positional
percentiles, leaderboards and a play-by-play query layer — all built on free, open data.

```
pipeline/   Python ingestion (nflverse → parquet)
web/        Next.js app (DuckDB reads the parquet directly)
docs/       how each model works, and why
data/       generated; not in version control
```

### Where to read next

| | |
|---|---|
| [docs/methodology.md](docs/methodology.md) | every model, what it is fit on, and what it cannot see |
| [docs/fantasy.md](docs/fantasy.md) | the draft board, in-season tools, connecting a league |
| [docs/data.md](docs/data.md) | what exists from when, and the known gaps |
| [docs/design.md](docs/design.md) | interface rules and the scripts that enforce them |
| [CLOUDFLARE.md](CLOUDFLARE.md) | the deployment plan — read before deploying anywhere |
| [IDEAS.md](IDEAS.md) | market research and the ranked backlog |
| [HANDOFF.md](HANDOFF.md) | what changed most recently, and why |
| [BLUEPRINT.md](BLUEPRINT.md) | the original research; superseded in places, kept for provenance |

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
| `fantasy_defense.parquet` | fantasy points allowed per game by each defense to each position |
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

The target is **Vercel**, with the data store on a **GitHub Release**. See
[docs/deploy.md](docs/deploy.md) for the setup steps and what is still unverified.

The short version: the app deploys unchanged — Vercel runs Node, so DuckDB's native binding works
and every route keeps rendering server-side exactly as it does locally. The data does *not* ship
with it. The store is ~150 MB and changes nightly, which is wrong for both git history and a
serverless bundle (Vercel caps a function at 250 MB uncompressed). Instead the nightly Action
publishes parquet to a Release and the site reads it over HTTPS through DuckDB's `httpfs`, which
fetches only the byte ranges a query touches.

Set `NFLX_DATA_URL` to the Release download base to turn remote reads on. Leave it unset locally and
the app reads `../data` off disk at full speed, so the dev loop is unchanged.
