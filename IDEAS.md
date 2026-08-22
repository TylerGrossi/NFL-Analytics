# Ideas — market research and a ranked backlog

*Compiled 2026-08-16. Written for an agent picking this up cold.*

Read `README.md` for what exists, `docs/` for how it works, and `HANDOFF.md` for what
changed most recently.
`BLUEPRINT.md` is the original research; this file is the **second** research pass,
done after the build reached ~20 routes, and it deliberately does not repeat it.

Every idea below is scored against three things:

- **Data on hand** — can it be built from parquet already in `data/parquet`, or does
  it need a new source?
- **Gap** — does anyone free already do it well?
- **Effort** — S (a day), M (a few days), L (a week+), XL (needs a new data source).

---

## 1. What changed in the market since BLUEPRINT.md

The original blueprint's competitor table is still broadly right, but three things
moved.

### 1.1 A direct competitor appeared: StickToTheModel

`sticktothemodel.com` is now the closest thing to what this project set out to be:
free, no signup, and broad. It ships a 2026 draft hub with prospect big boards and
scouting reports, a **mock draft simulator**, a **GM simulator** (cap, cuts, trades,
franchise tags, draft), a trade analyzer, a fantasy draft simulator with VORP
rankings, a playoff machine, a betting analytics section, a 435k-play stats
database, and — notably — **daily games, puzzles and trivia**.

What they do **not** have, and what Gridiron Analytics does:

- A real WAR/PAR model with published backtests and a methodology page.
- Opponent-adjusted efficiency computed from play-by-play rather than box scores.
- A play-level query layer (`/lab`) over the charted store.
- Measured constants instead of assumed ones — the fitted matchup coefficient
  (§6 of `HANDOFF.md`), measured injury play-probability, empirically-derived
  replacement level.

What they have that Gridiron Analytics does not, and that matters:

- **Simulation and play.** GM mode, mock drafts, puzzles. This is a *retention*
  mechanic, not an analytics one, and it is why they get repeat traffic.
- **Draft prospect coverage.** Gridiron Analytics' `/draft` is retrospective (pick value
  curve, club returns, steals and misses). It has nothing about the *next* class.
- **A betting section.**

**Read:** the analytical high ground is already held. The exposed flank is
engagement — reasons to come back on a Tuesday in June — and distribution.

### 1.2 Tracking data went public in a new way

Big Data Bowl 2026 changed shape: for the first time it ran a **public leaderboard**
prediction competition — predict where players move *while the ball is in the air*,
using pre-throw tracking, on 2023–24 season data evaluated against Weeks 14–18. That
means (a) there is now a well-defined public benchmark task with published methods,
and (b) the pre-snap→pass-arrival data slice is the most heavily documented one.

Still gated behind a Kaggle token — see `HANDOFF.md` §4 item 5. Still the single
biggest unlock available.

### 1.3 Natural-language query became table stakes elsewhere

NLQ over sports data is now a shipped product category (the Statcast NLQ work is the
clearest analogue). Nobody has done it for NFL play-by-play. Gridiron Analytics is unusually
well positioned because `/lab` already runs **DuckDB over parquet in-process** — the
only missing piece is text→SQL, and the schema is small enough to fit in a prompt.

### 1.4 Rules moved, which creates a timely analytics beat

2026 is a light rules year centered on two things: **kickoffs** (touchback moved to
the 35 after the dynamic kickoff produced a 43% concussion reduction; nine players
required in the setup zone) and officiating assistance. The **tush push survives** —
no proposal was tabled at the 2026 annual meeting.

Both are directly measurable from play-by-play and **nobody free has a page for
either**. Kickoff return rate, starting field position, and the expected-points value
of the touchback decision are a season-long story with a natural weekly update.

---

## 2. The strategic read

Gridiron Analytics' problem is no longer capability. It is that the site is **a set of
answers with no reasons to return and no way to travel.**

Three deficits, in priority order:

1. **Distribution.** Nothing here is shareable. No image export, no embeds, no OG
   cards, no API. An NFL analytics site grows through screenshots in group chats and
   quote-tweets. Right now a good chart on this site cannot leave it.
2. **Recurrence.** Almost everything is a leaderboard — you look once, you're done.
   The habit-forming surfaces (a weekly digest, a daily puzzle, alerts, a league you
   sync) don't exist.
3. **Forward-looking coverage.** The site is excellent at *what happened* and thin on
   *what happens next*: no prospect coverage, no contract projection, no trade value,
   no in-season injury impact.

The ideas below are ordered against those three.

---

## 3. Tier 1 — build these next

### 3.1 `/market` — model versus the betting market
**Data on hand: yes.** `games.parquet` already carries spread, total, roof and
surface; `game_previews.parquet` already produces projected margin, total and win
probability for unplayed games. The two have never been put side by side.

Ship:
- Weekly table: our projected margin vs the closing spread, with the gap called out.
- **A published ATS/total backtest** across every stored season — hit rate, and hit
  rate bucketed by the size of the disagreement. This is the whole point, and it is
  the thing every betting site refuses to publish honestly.
- Closing-line movement where the schedule file carries open and close.
- Team-level "market bias" — clubs the market persistently over- or under-rates.

**Gap: large.** Betting tools are a $99/month category (OddsJam, Outlier, Unabated)
selling CLV tracking and +EV screens. Nobody publishes a free, backtested,
methodology-open model line. This is exactly the WAR play run again on a bigger
audience.

**Effort: M.** **Risk:** frame it as model evaluation, not picks. State the backtest
honestly even if the edge is near zero — a null result published is still the most
credible page on any betting-adjacent site, and it protects the project's tone.

### 3.2 Shareable graphics and OG cards
**Data on hand: yes.** Everything.

Ship:
- Next.js `opengraph-image` routes for `/players/[id]`, `/teams/[abbr]`,
  `/games/[id]`, `/war` — so any link pasted into Slack, iMessage, Bluesky or X
  renders a real data card rather than a blank rectangle.
- A "copy image" / "download PNG" button on every signature chart (efficiency
  quadrant, WP chart, drive chart, player percentile bars).
- A small "Gridiron Analytics" mark plus the season and data-freshness stamp baked into the
  export, so the image carries attribution wherever it lands.

**Gap: total.** No free NFL analytics site does this well. It is the cheapest growth
mechanism available and it compounds.

**Effort: S–M.** **Note:** watch the licensing line in `BLUEPRINT.md` §2.6 — export
team *colors* and abbreviations, not logos or headshots.

### 3.3 Ask the Lab — natural-language query over the play store
**Data on hand: yes.** `/lab` and `charted/season=YYYY.parquet` already exist.

Ship a text box above `/lab`: *"third down, trailing by 4–8, in the fourth quarter,
shotgun, since 2022"* → generated SQL → the existing Lab result table.

Non-negotiables that make it trustworthy rather than a gimmick:
- **Show the generated SQL, always, before the result.** The user can edit and rerun
  it. This turns the LLM from an oracle into a query assistant.
- Read-only DuckDB connection, a hard row/scan cap, statement timeout, and a
  whitelist of tables. Never interpolate model output into a string that touches
  anything but a sandboxed reader.
- Cache generated SQL by normalized question text — most questions repeat.

**Gap: total for NFL.** And the architecture already carries it: DuckDB over parquet
means an arbitrary filter costs nothing.

**Effort: M.** **Risk:** hallucinated columns. Mitigate by putting the actual schema
(column names, types, a one-line meaning for each) in the prompt, and by validating
the SQL against the catalog before execution.

### 3.4 Trade value calculator — **attempted, blocked, do not retry as specified**

*Attempted 2026-08-16. The fits were built, the output failed the eye test, and the
dollar half was removed. Recording why, because the entry above was wrong.*

The claim was "data on hand: yes, and this is the standout." It is not. Pricing a
player's contract surplus needs a dollars-per-win constant, and **WAR on this site is
not a cross-position dollar currency.**

Over the 2025 season the 10th-to-90th percentile WAR spread is:

| QB | LB | CB | EDGE | OL | DL | RB |
|---|---|---|---|---|---|---|
| 2.91 | 0.80 | 0.74 | 0.47 | 0.30 | 0.25 | 0.13 |

A single $/win is therefore calibrated almost entirely on quarterbacks ($9.8M, r = 0.51;
$10.6M and r = 0.29 once quarterbacks are removed). Applying it to a receiver values an
elite season at about $1M against a $30M cap hit. Built that way the tool returned
**Ja'Marr Chase at −$154M and Amon-Ra St. Brown at −$198M as the worst contracts in
football**, with Mac Jones and a 38-year-old Kirk Cousins topping the surplus list.

Fitting $/win *within* each position does not rescue it: WAR-to-pay correlation inside a
group runs 0.17 for backs, 0.18 for the line and 0.24 for interior defenders. There is no
honest slope at those correlations.

**What would unblock it:** more spread in non-QB WAR — which is a WAR-model problem, not
a calculator problem, and is the same root cause as the standing "running back WAR is
genuinely small" limitation. Until then, any surplus-in-dollars product on this data is
arithmetic dressed as analysis.

**What was salvaged** (`pipeline/nflx/build/trade.py`, wired into the build):

- `trade_aging.parquet` — aging curves by the **delta method**, comparing the same player
  in consecutive seasons. The naive mean-WAR-by-age curve is pure survivorship and put the
  running back peak at 21. Delta-method curves peak where the literature expects:
  quarterbacks ~28, backs declining from 22, corners falling away after 26. This unblocks
  §4.3 directly.
- `trade_picks.parquet` — expected career value by pick in **both** currencies, smoothed
  and isotonic-fitted. The headline: a top-five pick is worth **1.8x** a late first in AV
  and **11.5x** in WAR, and the entire gap is quarterbacks. Among top-ten picks 2012–2021
  a quarterback returned 12.1 career WAR and every other position under 1.6, while AV
  rated them nearly equal. A pick's value in WAR terms is mostly an option on a
  quarterback.
- `trade_pick_mix.parquet` — the position mix behind each draft band, which is the table
  that explains the divergence.
- `trade_war_spread.parquet` — the blocker itself, published.

**All of it now has a page (2026-08-16).** The pick-curve divergence ships on `/draft` as
"Two currencies, two answers" — both curves scaled to pick 1 = 100, the four headline
ratios, and the top-ten position breakdown. The aging curves ship on every player card
with the player's own age marked and the next three years quantified, which closes §4.3's
aging-curve half.

### 3.5 The weekly digest — **shipped 2026-08-16**

Live at `/week` (redirects to the newest completed week) and `/week/[season]/[week]`. Five
panels, no new pipeline module — everything reads tables that already existed.

Two of the five sections proposed below could not be built and are called out on the page
rather than faked: **playoff-odds swings** and **weekly waiver movement** both need a
per-week snapshot, and `playoff_odds` / `fantasy_waivers` each store a single row per
season. Substituted "what the market missed" (from the new `market_games`) and "best
individual weeks", which are better anyway.

Gotcha found while building: `wpa` in `player_week` is only populated for passers — 32 of
34 quarterbacks and one receiver out of 128 in a sample week — so ranking individual
performances on it returns ten quarterbacks by construction. Ranked on PPR instead, with
WPA carried as a secondary column.

*Original entry:*


**Data on hand: yes.**

An auto-generated Tuesday page — `/week/[season]/[week]` — and the same content as an
email/RSS: biggest WPA plays of the week, largest movers in opponent-adjusted EPA,
the worst 4th down decisions by cumulative win probability surrendered, the
playoff-odds swings, the fantasy waiver adds.

Every number is already computed. This is assembly, not modeling — and it is the
recurrence mechanic the site lacks.

**Effort: M.** **Note:** write it as data with sentences around it, not as prose. The
site's text discipline (`HANDOFF.md` §2) applies — `<Deck>` and `<Notes>`.

---

## 4. Tier 2 — strong, slightly more work

### 4.1 `/coaches` — **shipped 2026-08-16**

Built as `build/coaches.py` → `coach_seasons` / `coach_careers`, page at `/coaches` with nine
sorts. Play-call entropy is in and behaves: Dan Campbell is the most aggressive fourth-down
coach on record at 51% go-when-optimal, Belichick and Reid sit at 23%, which is the eye-test
check. Coach-vs-coach comparison and the per-coach card are still open.

*Original entry:*
`BLUEPRINT.md` §3.4 laid out coaching analytics and it never shipped.
`fourth_down_teams.parquet` already holds aggressiveness and win probability
surrendered; `team_season.parquet` holds PROE and tendencies;
`formation_splits.parquet` holds personnel and shell usage.

Ship: a coach card. 4th-down aggressiveness vs optimal, PROE, early-down pass rate,
**play-call entropy** (how predictable are they, by down/distance/personnel), motion
and play-action rates with their EPA lift, timeout efficiency, and a
coach-vs-coach comparison. Carry it across the coach's career, not just this club.

**Gap: large.** Coaching analytics is discussed constantly and tabulated nowhere.
**Effort: M** — mostly a new page over existing tables, plus an entropy metric.

### 4.2 Special teams under the new kickoff rules
Touchback at the 35, nine in the setup zone. Measure it: return rate, average
starting field position, the expected-points break-even on kicking it through, which
clubs adapted and which didn't. Refresh weekly.

**Gap: total, and time-sensitive.** This is a launch-week story with a season-long
tail. **Effort: S–M.** **Caveat:** the rule changed for 2026, so the pre-2026
comparison must be labeled as a different regime, the same way the 2023 formation
vendor change is already handled.

### 4.3 Player comps and aging curves — *aging half shipped 2026-08-16*
`war_career`, `player_season` percentiles, `draft_picks` (with combine testing) and
`players` bios are all there.

Ship: on every player card, "most similar seasons" by a percentile-space distance,
and a career-arc projection with the position's aging curve overlaid. Feeds §3.4
directly.

**Gap: moderate** — comps exist elsewhere but are usually box-score based.
**Effort: M.**

### 4.4 Contract projection
Regress APY on PAR, age, position and market year from `contracts.parquet` → predict
what a player's next deal should be, and flag the league's most over- and
under-valued contracts. Slots straight into `/tools/armchair-gm`.

**Gap: moderate.** OverTheCap and Spotrac report contracts; almost nobody *models*
them from on-field value. **Effort: M.**

### 4.5 Officiating and crew analytics
`load_officials()` is in nflverse and unused here. Penalty rate by crew, home/road
penalty split, how crews call holding and DPI, and whether crew assignment moves
totals. It is a legitimate analytics beat *and* a betting angle, and it is close to
unoccupied.

**Gap: large.** **Effort: S–M.** **Care needed:** small samples per crew per season.
Shrink hard and say so — the site's existing discipline on shrinkage applies.

### 4.6 League sync — **Sleeper and ESPN shipped 2026-08-16**

`/fantasy/league` takes a league id and renders power rankings plus every roster valued on
rest-of-season projections. No account, no database — the id in the URL is the whole state.

**Sleeper's own player cross-references are far too sparse to sync on**, which the entry below
did not anticipate. Of 1,033 active skill players on their feed only **180 carry a gsis id**
and 239 an ESPN id, and the gsis values arrive with a leading space. Matching on those alone
bridges 23% of a league. `build/league_ids.py` therefore falls through four layers — gsis,
ESPN id, name+position+club, name+position — and reaches **93%** (179 / 54 / 728 / 28). The
residue is rookies and UDFAs with no nflverse row at all.

**ESPN private leagues are deliberately not supported.** Public leagues work from the id;
private ones need `SWID` and `espn_s2`, which are full account credentials rather than scoped
tokens. The page says so and points at Sleeper.

Verified end to end against Sleeper's own documented sample league.

*Original entry:*
Sleeper's API is free, open, keyless and does not require OAuth. `/fantasy/espn`
already exists, so there is precedent. Paste a league ID → the start/sit board,
waiver list and rest-of-season ranks filter to your actual roster.

**Gap: moderate** (RotoWire and others sync, behind a subscription).
**Effort: M.** This is the strongest recurrence hook on the list — a synced league is
a weekly return visit for seventeen weeks.

### 4.7 Injury impact on team strength
`injury_rates.parquet` and `depth_charts.parquet` exist and are already wired into
previews. Take the next step: when a starter is listed out, what does the projected
margin move by, given the PAR gap to the next man up? This closes the loop between
the depth chart, PAR and `game_previews`, and it addresses a known gap
(`docs/data.md`: "simulated seasons hold team ratings fixed").

**Gap: large.** **Effort: M–L.**

### 4.8 A public API and data downloads
Expose the parquet: `/api/v1/<table>?season=&team=` returning JSON or CSV, plus
direct parquet links, plus a documented schema page. Rate-limited, cached, no key.

**Gap: moderate.** nflverse serves the raw layer; nobody serves the *derived* layer
(opponent-adjusted EPA, PAR, fourth-down grid, separation scores). This is how a
project like this earns citations, backlinks and credibility from other analysts.

**Effort: S.** **Note:** it is also the cheapest hedge against the site's own UI —
the data outlives any page.

---

## 5. Tier 3 — worth doing, lower urgency

- **Game stories.** Auto-written recaps from play-by-play: the turning point by WPA,
  the drive chart, what the win probability said and when. **S–M.**
- **Daily puzzle / trivia.** StickToTheModel's retention play. "Guess the player from
  their percentile bars", "which season is this drive chart from". Cheap, generated
  from existing parquet, and the only thing here that brings someone back daily. **M.**
- **Mock draft / GM simulator.** Direct answer to their differentiator. The cap and
  depth machinery in `/tools/armchair-gm` is most of the engine already. **L**, and
  it needs prospect data the project doesn't have.
- **Weather and kicking.** Open-Meteo by stadium lat/lon → an FG model with wind,
  temperature and altitude. `BLUEPRINT.md` §3.1 specified it; it never shipped. **M.**
- **Stability leaderboard.** Rank every metric on the site by year-over-year `r` and
  by out-of-sample predictiveness — "which of these numbers should you actually
  believe". Deeply on-brand for a site whose credibility rests on published
  backtests, and nobody else would dare. **S–M.**
- **Rest, travel and schedule spots.** Miles traveled, time zones crossed, days of
  rest, and whether any of it survives a proper control. Likely a null result —
  publish it anyway. **S.**
- **Historical era pages.** The play-by-play goes to 1999. Era-adjusted leaderboards,
  rule-change inflection points. **M.**
- **PWA / offline / speed pass.** The mobile audit exists (`audit-mobile.mjs`); make
  the site installable and fast on a phone in a stadium. **S.**

---

## 6. Tier 4 — blocked or expensive

- **Big Data Bowl tracking layer.** Play animations, route trees, true separation vs
  coverage, pass-block win rate. Blocked on a Kaggle token — see `HANDOFF.md` §4 item
  5 for the exact unblock steps. Decide the redistribution question *before* building
  anything public. The 2026 competition's pre-snap→pass-arrival slice is now the
  best-documented one, with a public leaderboard's worth of published methods to
  learn from. **XL, highest ceiling on this document.**
- **Draft prospect coverage.** Needs college data (CFBD API is free and keyed) plus
  scouting inputs the project has no source for. Would unlock the mock draft
  simulator and pair with the existing pick value curve. **XL.**
- **Individual OL grading.** The standing known limitation. Genuinely needs tracking
  or proprietary charting. Do not fake it.

---

## 7. Things to deliberately not do

- **Don't add prediction confidence theater.** Intervals were removed from WAR at the
  user's request (`HANDOFF.md` §1). Don't reintroduce them anywhere as decoration.
- **Don't ship picks.** A model line with a published backtest is a credible product;
  a "best bet of the day" is a different site with a different reputation.
- **Don't embed ESPN media.** The current linking behavior is deliberate and
  documented — bandwidth, advertising, per-country licensing.
- **Don't put prose above data.** `web/audit-text.mjs` enforces it; under ~25 visible
  words and dataTop under 450px per route.
- **Don't ship any metric without checking it against recognizable reference
  rankings first.** This is the lesson the WAR rebuild came from and it is the single
  most important rule in the project.

---

## 7a. Shipped from this document

- **§3.2 — complete (2026-08-16).** Open Graph cards, plus the download-PNG button on the win
probability chart, aging curves, pick value curves and player weekly charts.

**§3.2 Open Graph cards — done (2026-08-16).** Home, `/war`, player, team and game routes, from a
  shared shell in `web/src/lib/og.tsx`. Team colors only, no club marks; stripe falls back to the
  secondary color when the primary is too dark to read against the navy footer. `metadataBase` is
  wired via `NEXT_PUBLIC_SITE_URL`. Download-PNG shipped alongside.
- **§3.1 `/market` — done (2026-08-16).** `build/market.py` walk-forwards the projection over
  5,199 games from 2006, grading against the closing line and writing `market_games.parquet`,
  `market_teams.parquet` and `market_validation.json`. It reproduces the README's previously
  hand-computed figures exactly (RMSE 13.59 model vs 13.21 market), and publishes the unflattering
  half: 50.5% ATS against a 52.4% breakeven, with the hit rate *falling* as the model's disagreement
  with the line grows. Framed as model evaluation, no picks — per §7.

## 7b. Fantasy tool research, 2026-08-16

Surveying FantasyPros and the user's own fantasy-basketball tool (FBBSim) for what an
in-season product actually needs. Ranked by what this store can already support.

**FantasyPros ships:** Start/Sit Assistant, Who Should I Start, Auto-Pilot (emailed lineup
changes), Waiver Central (team strengths/weaknesses plus top targets), Trade Analyzer, Trade
Finder, and a Coach AI chat layer.

**FBBSim ships** — the better model, being one person's tool rather than a subscription funnel:
Scoreboard, Matchup with **win probability and a score distribution**, Roster, Season Summary
with **all-play records and schedule luck**, League Stats, **Power Rankings** (all-play, current
form, weekly movement), Rosters with acquisition history, Recent Moves, Schedule, **Trade
Simulator**, Player Card, **Player Value** (rostered and free agents), **Streamer Finder** (free
agents who score well against *your* matchup), **Compare**, **Lineup Optimizer** with swap-cost
analysis, Cheat Sheets, and a natural-language Agent.

**Shipped 2026-08-16:** the Sleeper connect flow (username → league picker), matchup win
probability with a margin distribution, the lineup optimizer with swap costs, and the streamer
finder. All four live on `/fantasy/league`. The variance model they rest on is new —
`fantasy_variance.parquet`, `sd = a + b × projection` per position, fit on 38,758 player weeks.

**Also shipped:** all-play standings with schedule luck, trade targets, and the transaction log —
all three verified against a completed Sleeper season rather than waiting for 2026. All-play found
a team that went 11-3 on a 53.6% all-play record (+3.5 luck) beside one that went 5-9 on a better
54.2%, which is exactly what the table exists to surface.

**And shipped after that:** the two-sided trade simulator, weekly scoreboard and season summary.
The last two were expected to need a live season; they did not, because a completed Sleeper league
supplies the same matchup history, which is also how they were verified (17 weeks, high 199.5, low
0.0 from an abandoned team, closest game 0.90 points).

**Still open in fantasy:** general player compare. Note that "who should I start" is already
answered more completely by the lineup optimizer and its swap list, so a compare view would be a
research tool rather than a fantasy one — it belongs with the player pages, not here.

**Buildable here now, in value order:**

1. **Matchup win probability and score distribution.** Simulate both lineups from
   `fantasy_weekly` projections plus a per-position variance fit from `player_week`. Nothing
   free does this well and the data is entirely on hand. The best thing on this list.
2. **Lineup optimizer with swap cost.** Projections exist; needs roster rules from the sync.
   "Start X over Y, +2.3 points" is the highest-frequency question in fantasy.
3. **Power rankings with all-play and schedule luck.** All-play record — your score against
   every other team every week — separates a good team from a lucky one, and it is the most
   screenshotted table in any league chat. Needs weekly matchup history from the sync.
4. **Streamer finder.** `fantasy_weekly` already carries the fitted matchup coefficient, so
   "free agents with the best draw this week" is one join away once the sync knows who is
   rostered.
5. **Trade analyzer, fantasy flavour.** Note this is *not* §3.4 — fantasy value is projected
   points, which the store has, rather than dollar surplus, which it cannot support.
6. **Recent moves.** Sleeper exposes a transaction log directly.

**Deliberately not:** an AI chat layer. It is the fashionable feature and the least defensible
on a site whose whole claim is published method — see §3.3, where the same capability earns its
place only because it shows the SQL it generated.

## 7c. Draft tools — requested 2026-08-18, not yet built

Asked for directly; recorded here rather than built.

### Mock draft simulator

An NFL mock draft the user runs pick by pick: the other 31 teams pick on a
model, the user picks for theirs, and the board updates. What it needs:

- **Prospect board.** `load_draft_picks` gives every historical pick, so a
  finished draft can be replayed and the model backtested against what actually
  happened. It does **not** give a forward-looking board for an undrafted class —
  that is a consensus big board, which is somebody's product, not open data.
  Without one the simulator can only replay past drafts, which is still a real
  feature and is honest about what it is.
- **A pick model.** Team needs from the roster and depth charts, positional
  value from the existing trade/draft-value curves already in the pipeline
  (`draft.py`, `trade.py` fit these at build time), and the historical tendency
  of each team to reach or trade back.
- **Trade offers.** The pick-value curve is already fit, so an offer generator
  is a short step from it.

### Other draft work wanted

- Team needs by position, from depth charts and contracts expiring.
- Draft capital by team across years, valued on the fitted curve.
- Historical pick-by-pick value returned versus slot expectation — which teams
  actually beat their draft position, backtested rather than asserted.
- Combine data is available (`load_combine`), so athletic profiles against draft
  slot and against career outcome are all computable.

## 7d. Luck carry-over — requested 2026-08-18, not yet built

Asked for directly; recorded here rather than built.

**The idea.** Measure how lucky or unlucky each team was in a season, then ask
what that buys you about the *next* season. If a team is extremely lucky or
extremely unlucky, how much of that should be regressed away when projecting
them forward — and does the residual predict anything the base model misses?

**Why it is worth doing.** Luck is the most common thing a fan gets wrong about
a team's record, and it is the easiest thing this store can settle with a
backtest rather than an assertion. It also feeds two things already built:
`/playoffs` (preseason odds) and `/market` (where the model's disagreements
with the line have to come from somewhere).

**What luck could be measured as** — all of these are already derivable from
`data/parquet`:

- Record against Pythagorean expectation from points scored and allowed
  (`team_season`, `standings`).
- Record in one-score games, against the league's base rate.
- Turnover margin and, separately, fumble recovery rate — recovery is close to
  a coin flip and is the cleanest single luck signal in football.
- Opponent field goal percentage against expectation.
- Injury luck — games lost by starters, from `injury_reports` and the depth
  charts, against `injury_rates`.
- EPA-based record against actual record, now that EPA is the site's headline
  currency.

**What the analysis should answer**, in this order:

1. How much does each luck measure regress year over year? A measure that
   persists is not luck; it is a skill the model should be crediting.
2. Does year-N luck predict year-N+1 *change in wins*, after controlling for
   year-N EPA? This is the actual question.
3. Which luck measures add anything beyond Pythagorean, which is the standard
   baseline and already computable.

**Publish the null result if there is one.** The likely finding is that most of
this is already priced into Pythagorean and into the market, and the honest
version of this page says so — the same way `/market` does.

**Effort: M.** Data entirely on hand; the work is the backtest and the writing.

---

## 8. Suggested order

1. **Shareable graphics + OG cards** (§3.2) — smallest effort, compounding return,
   and it makes everything already built travel.
2. **`/market`** (§3.1) — biggest new audience, data entirely on hand.
3. **Trade value calculator** (§3.4) — the most defensible thing on this list.
4. **Weekly digest** (§3.5) — the recurrence fix.
5. **Ask the Lab** (§3.3) — the headline differentiator, once the above are steady.
6. Then `/coaches`, league sync, and the kickoff page as the season starts.

---

## Sources

- [StickToTheModel](https://sticktothemodel.com/) · [their stats database](https://sticktothemodel.com/data)
- [SumerSports](https://sumersports.com/) · [on Big Data Bowl 2026](https://sumersports.com/the-zone/sumersports-big-data-bowl-2026/) · [PFF tools](https://www.pff.com/tools) · [NFL Savant](https://nflsavant.com/) · [FTN stats](https://ftnfantasy.com/nfl/stats)
- [NFL Big Data Bowl](https://operations.nfl.com/the-game/big-data-bowl/index.html) · [2026 announcement](https://operations.nfl.com/updates/football-ops/nfl-announces-eighth-annual-big-data-bowl-powered-by-aws/) · [Kaggle 2026 prediction competition](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-prediction/data)
- [2026 rule changes — kickoffs](https://www.buccaneers.com/news/kickoffs-tweaked-again-in-nfl-short-list-2026-rules-changes) · [approved changes](https://www.buffalobills.com/news/nfl-announces-approved-rule-changes-for-2026-season) · [tush push status](https://www.foxsports.com/stories/nfl/2026-nfl-rule-changes-tush-push-stay-5-proposals-voted)
- [nflverse data update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) · [nflreadr changelog](https://nflreadr.nflverse.com/news/index.html)
- [Betting model tool categories](https://blog.sportscommand.ai/7-best-betting-model-tools-for-2026-match-the-right-tool-to-your-actual-edge) · [free CLV calculators](https://xclsvmedia.com/best-free-clv-calculators-2026-track-closing-line-value/) · [Unabated CLV calculator](https://unabated.com/betting-calculators/closing-line-value-calculator)
- [Dynasty trade tools roundup](https://www.fantasypros.com/2026/07/best-dynasty-fantasy-football-trade-tools/) · [KeepTradeCut](https://keeptradecut.com/trade-calculator) · [RotoWire dynasty calculator](https://www.rotowire.com/fantasy/football/dynasty-trade-calculator)
- [NLQ on Statcast data](https://medium.com/@deephavendatalabs/ai-powered-baseball-analytics-natural-language-queries-on-statcast-data-b7bee7f52cb0) · [NLQ analytics 2026](https://supaboard.ai/blog/natural-language-query-analytics)
