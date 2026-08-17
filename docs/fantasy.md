# Fantasy

The draft board, the in-season tools, and connecting a real league.

*Split out of `README.md`; that file is the front door.*

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
