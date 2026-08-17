# The data

What exists, from when, and where it runs out.

*Split out of `README.md`; that file is the front door.*

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
