# How the numbers are made

Every model on the site, what it is fit on, and what it cannot see. The README has the orientation; this has the reasoning.

*Split out of `README.md`; that file is the front door.*

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

## Game projections

A scheduled game gets a projected score, win probability and model line. Team strength blends last
season's opponent-adjusted rating with this season's scoring margin, weighted `n / (n + 8)` in games
played — so week 1 rests entirely on the carried rating and the handover is gradual. The carryover
is measured, not assumed: net rating persists year to year at 0.47, offense at 0.49 and defense at
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
favored by, so a home favorite is positive. A posted betting line states the favorite as a
negative number. `line()` in `web/src/lib/format.ts` does the flip, because printing the stored
value directly labels every favorite as an underdog.

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

## The Lab

The Lab asks the play store directly rather than reading a precomputed page, so any combination of
filters is fair game: third and long from the red zone, 12 personnel against man coverage, trailing
in the fourth quarter. Group by team offense, team defense, quarterback, ball carrier or receiver.

Every filter is an entry in a fixed table in `web/src/lib/splits.ts` that owns its own SQL fragment.
Nothing a visitor types reaches the query — an unknown key does not match an entry and is dropped.
Filters needing charted data switch the source from the full 1.28M-play store to the 344k-play
charted store, which is why they carry a start season.

Results are compared against the league average **for the same split**, not the league overall. A
red zone leaderboard is judged against red zone offense, which is the comparison that means
something; measuring red zone plays against all-downs average would rank every team below average.

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
