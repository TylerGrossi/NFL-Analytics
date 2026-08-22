import { Panel, SectionRule } from "@/components/ui";
import { getManifest, getMarketValidation, getWarValidation } from "@/lib/queries";
import { num, pct } from "@/lib/format";
import type { ReactNode } from "react";

export const metadata = { title: "Glossary" };
export const revalidate = 300;

/**
 * One page holding every definition, formula and fitted constant.
 *
 * The methodology used to live in a collapsed `Notes` block at the foot of
 * fourteen pages, which meant the same shrinkage rule was written out three
 * times and a reader comparing two metrics had to open two pages to find out
 * they were computed differently. Here it is one document, and the numbers
 * that are fit at build time are read from the store rather than typed in, so
 * a published constant cannot drift away from the one the pipeline used.
 */

/** A term, its expansion, and what it actually means. */
type Entry = { abbr: string; term: string; where: string; def: ReactNode };

const ABBREVIATIONS: Entry[] = [
  {
    abbr: "EPA",
    term: "Expected points added",
    where: "everywhere",
    def: "Points the play changed the drive's expected value by. A first-down conversion is worth more than the yards say; a sack on second and long is worth less.",
  },
  {
    abbr: "Total EPA",
    term: "Season expected points added",
    where: "players, draft, cap",
    def: "A player's own EPA, summed over his passing, rushing and receiving plays. This is the site's headline figure for an individual — it is charged to whoever touched the ball, so linemen and defenders score none of it and are read on charted production instead.",
  },
  {
    abbr: "Career EPA",
    term: "Career expected points added",
    where: "players, draft",
    def: "The same figure summed across every regular season on record. EPA adds up in a way a rate stat does not, so there is nothing fitted here — a career number means what a season number means over a longer window.",
  },
  {
    abbr: "Net",
    term: "Net rating",
    where: "standings, teams",
    def: "Opponent-adjusted offensive EPA per play minus the same on defense. The single number the site ranks clubs by.",
  },
  {
    abbr: "Off / Def",
    term: "Offense and defense rank",
    where: "standings, teams",
    def: "Rank of 32 on opponent-adjusted EPA per play. Rank 1 is the best offense and the best defense respectively — a defensive rank is already signed so that low is good.",
  },
  {
    abbr: "xWins",
    term: "Expected wins",
    where: "standings",
    def: "Wins implied by points scored and allowed alone, through the Pythagorean formula below.",
  },
  {
    abbr: "Luck",
    term: "Wins above expectation",
    where: "standings",
    def: "Actual wins minus xWins. Positive means a club is winning more than its scoring says it should — mostly close-game and turnover variance, which does not carry to next season.",
  },
  {
    abbr: "SoS",
    term: "Strength of schedule",
    where: "standings, teams",
    def: "Average net rating of the opponents faced. Positive is a harder schedule than average.",
  },
  {
    abbr: "Diff",
    term: "Point differential",
    where: "standings",
    def: "Points scored minus points allowed.",
  },
  {
    abbr: "Sd",
    term: "Seed",
    where: "standings, playoffs",
    def: "Conference seeding, 1–16, from the full NFL tiebreaker tree. Seeds 1–4 are division winners; 5–7 are wild cards, and were 5–6 before 2020.",
  },
  {
    abbr: "Strk",
    term: "Streak",
    where: "standings",
    def: "Consecutive wins or losses, most recent first. Sorts by direction first, so W1 outranks L2.",
  },
  {
    abbr: "WAR",
    term: "Wins above replacement",
    where: "war",
    def: "Value in wins over a freely available player at the same position. It covers every role including blocking and coverage, which EPA cannot, and it lives on its own page — the rest of the site leads with EPA.",
  },
  {
    abbr: "PAR",
    term: "Points above replacement",
    where: "war",
    def: "The same figure before conversion to wins. PAR is what the model computes; WAR is PAR divided by the cost of a win.",
  },
  {
    abbr: "DB",
    term: "Dropbacks",
    where: "passing tables",
    def: "Pass attempts, sacks and scrambles. A scramble is a dropback, so its value belongs to passing rather than rushing.",
  },
  {
    abbr: "EPA/DB",
    term: "EPA per dropback",
    where: "passing tables",
    def: "The quarterback rate statistic that repeats best year to year.",
  },
  {
    abbr: "CPOE",
    term: "Completion percentage over expected",
    where: "passing tables",
    def: "Completion rate against what the throw's depth, direction and pressure predict. Needs air yards, so it starts in 2006.",
  },
  {
    abbr: "YOE",
    term: "Yards over expected",
    where: "stats, separation",
    def: "Yards gained against what tracking data predicts for the same carry or catch. Next Gen Stats, from 2016.",
  },
  {
    abbr: "PROE",
    term: "Pass rate over expected",
    where: "teams, coaches",
    def: "How much more often a club passes than the situation predicts. A tendency measure, not a quality one.",
  },
  {
    abbr: "Success",
    term: "Success rate",
    where: "stats, teams",
    def: "Share of plays with positive EPA.",
  },
  {
    abbr: "Pts/Dr",
    term: "Points per drive",
    where: "teams",
    def: "Scoring rate per possession, which removes pace from the comparison.",
  },
  {
    abbr: "WP / WPA",
    term: "Win probability, and added",
    where: "games, fourth down",
    def: "Chance of winning from the current state, and the change one play caused.",
  },
  {
    abbr: "VOR",
    term: "Value over replacement",
    where: "fantasy",
    def: "Fantasy points above the last startable player at the position — QB12, RB24, WR36, TE12 in a twelve-team league.",
  },
  {
    abbr: "AV",
    term: "Approximate value",
    where: "draft",
    def: "Pro Football Reference's cross-position career value. Cruder than WAR, but it exists for every position in every year, which a question spanning 27 drafts needs.",
  },
  {
    abbr: "ATS",
    term: "Against the spread",
    where: "market",
    def: "Whether a side beat the closing line. Pushes are excluded rather than counted as half a win.",
  },
  {
    abbr: "RMSE / MAE",
    term: "Root mean squared and mean absolute error",
    where: "market",
    def: "Average miss of a projected margin, in points. RMSE punishes large misses harder.",
  },
];

/** A formula, set apart from the prose that explains it. */
function Formula({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="formula">
      <code>{children}</code>
      {note && <span className="formula-note">{note}</span>}
    </div>
  );
}


export default async function GlossaryPage() {
  const [manifest, war, market] = await Promise.all([
    getManifest(),
    getWarValidation(),
    getMarketValidation(),
  ]);

  const ppw = war?.points_per_win ?? 36;
  const first = manifest.seasons[0];
  const last = manifest.seasons[manifest.seasons.length - 1];

  return (
    <>
      <SectionRule>Glossary</SectionRule>


      <Panel title="Abbreviations">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Short</th>
                <th className="l">Term</th>
                <th className="l">Where</th>
                <th className="l">Definition</th>
              </tr>
            </thead>
            <tbody>
              {ABBREVIATIONS.map((e) => (
                <tr key={e.abbr}>
                  <td className="num font-semibold whitespace-nowrap">{e.abbr}</td>
                  <td className="l whitespace-nowrap">{e.term}</td>
                  <td className="l text-ink-3 text-[11.5px] whitespace-nowrap">{e.where}</td>
                  <td className="l text-ink-2 !whitespace-normal min-w-[320px]">{e.def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <SectionRule>Efficiency</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Opponent-adjusted EPA">
          <div className="notes-body one-col">
            <p>
              Raw EPA per play rewards a club for the schedule it drew. The adjustment subtracts
              how much better or worse than league average each opponent was, then recomputes both
              sides with the new estimates and repeats — {8} iterations, which is past the point
              where the ratings stop moving.
            </p>
            <Formula note="repeated until stable; league is the mean EPA per play that season">
              off_adj = mean( epa − (opponent_def_adj − league) )
            </Formula>
            <p>
              <b>Net</b> is <code>off_adj − def_adj</code>, and <b>SoS</b> is the mean net rating of
              the opponents a club actually faced. Scrimmage plays only: no kneels, spikes or
              special teams.
            </p>
          </div>
        </Panel>

        <Panel title="What EPA does and does not carry">
          <div className="notes-body one-col">
            <p>
              EPA prices a play by the drive state it creates, so it already accounts for down,
              distance and field position. It does not separate the players involved — an
              offense&apos;s number contains its line, its quarterback and its receivers together.
              That separation is what WAR attempts, and why WAR is a harder problem than team
              efficiency.
            </p>
            <p>
              Rate statistics repeat year to year better than volume ones. Over {first}–{last},
              EPA per dropback repeats at{" "}
              <b>{num(war?.stability_benchmarks?.epa_per_dropback, 2)}</b>, CPOE at{" "}
              <b>{num(war?.stability_benchmarks?.cpoe, 2)}</b> and passing yards — a volume
              statistic — at <b>{num(war?.stability_benchmarks?.passing_yards, 2)}</b>.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Standings and seeding</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Expected wins and luck">
          <div className="notes-body one-col">
            <Formula note="exponent 2.37, the fitted NFL value">
              xWins = games × PF^2.37 / (PF^2.37 + PA^2.37)
            </Formula>
            <Formula>Luck = actual wins − xWins</Formula>
            <p>
              Point differential is a better guide to the next game than record is, which is what
              makes the gap worth publishing. It is not a claim that a club is bad — it is a claim
              that this particular part of its record does not repeat. Expected wins correlate with
              actual single-season records at{" "}
              <b>{num(war?.pythagorean_vs_wins_r, 2)}</b>, and that is with every score known.
            </p>
          </div>
        </Panel>

        <Panel title="The tiebreaker tree">
          <div className="notes-body one-col">
            <p>
              Seeding is not a sort by record. Clubs level on win percentage walk a fixed ladder,
              and the ladder differs for a division title and a wild card.
            </p>
            <p>
              <b>Division ties:</b> head to head, division record, common games, conference record,
              strength of victory, strength of schedule, net points.
              <br />
              <b>Wild card ties:</b> head to head, conference record, common games, then the same
              tail. Among three or more clubs head to head only counts as a clean sweep either way.
            </p>
            <p>
              Two rules decide real cases. A multi-club tie is resolved by finding the single top
              club and then <em>restarting the ladder</em> for whoever is left — eliminating from
              the bottom gives different, wrong answers. And in the wild card pool only one club per
              division is compared at a time; the others drop out and re-enter once that club is
              seeded. Steps below strength of schedule are approximated by net points; they decide a
              handful of cases a decade.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Wins above replacement</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="How the number is built">
          <div className="notes-body one-col">
            <Formula note={`points per win refit at build time from team wins on point differential`}>
              WAR = PAR / {num(ppw, 2)}
            </Formula>
            <ul>
              <li>
                <b>Price a win.</b> Team wins regressed on point differential fixes what a point is
                worth.
              </li>
              <li>
                <b>Attribute the play.</b> The quarterback owns the dropback, scrambles included, so
                a scramble is not also paid as a rush. A receiver is judged on the whole target
                against what a throw of that depth was worth. Defenders get charted production;
                linemen their unit&apos;s blocking split by snaps.
              </li>
              <li>
                <b>Shrink small samples.</b> Ridge with the opponent controlled, then each rate
                regressed again by its own sample. Rushing efficiency repeats at 0.16 year to year
                and return rate at 0.23, so both are pulled hard toward the mean.
              </li>
              <li>
                <b>Measure replacement.</b> Everyone outside the starter pool sets the bar, from
                what happened on their plays rather than from fitted coefficients.
              </li>
              <li>
                <b>Report points, then wins.</b> Both PAR and WAR are shown so the conversion stays
                visible.
              </li>
            </ul>
          </div>
        </Panel>

        <Panel title="What WAR does not cover">
          <div className="notes-body one-col">
            <ul>
              <li>
                <b>Linemen share one unit number</b>, split by snaps, so five starters with the same
                snaps get the same value. Separating them needs per-snap block charting, which is
                not public.
              </li>
              <li>
                A pressure is priced at what a pressure is worth on average, so beating a double
                team and running free unblocked pay the same.
              </li>
              <li>
                A quarterback&apos;s number still contains his supporting cast: he takes nearly
                every dropback for his club, so the two cannot be separated within a season.
              </li>
              <li>Receivers are not charged for drops. Long snappers are not rated.</li>
              <li>
                Roles need the data that supports them. Receiving value starts in 2006 with air
                yards, line value in 2012 with snap counts, defensive value in 2018 with charting.
                A role that cannot be computed is absent, not zero.
              </li>
            </ul>
            <p>
              Read the backtest against its ceiling rather than against 1.0. Team WAR tracks wins at{" "}
              <b>{num(war?.team_war_vs_wins_r, 2)}</b> across {war?.team_seasons} team seasons, and{" "}
              <b>{num(war?.team_war_vs_wins_r_full_coverage, 2)}</b> from{" "}
              {war?.full_coverage_from} on where every role can be computed. Complete MLB WAR lands
              between about 0.64 and 0.87.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Projection and market</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Game projections">
          <div className="notes-body one-col">
            <p>
              A margin is projected from the two clubs&apos; net ratings plus home field, with every
              coefficient fit on completed games from earlier seasons only — never the season being
              scored. Team ratings carry year to year at about <b>0.47</b>, so a season not yet
              played is rated as last year regressed toward the mean. Skipping that regression is
              what produces clubs at 99% and 0% before anyone has kicked off.
            </p>
            <p>
              Playoff odds simulate the remaining schedule {(10000).toLocaleString("en-US")} times
              and seed every simulated season through the same tiebreaker tree. Ratings are held
              fixed across a simulated season, so injuries, trades and in-season improvement are not
              modeled.
            </p>
          </div>
        </Panel>

        <Panel title="Against the closing line">
          <div className="notes-body one-col">
            <p>
              {market && (
                <>
                  Over {market.games.toLocaleString()} games from {market.first_season}, the model
                  projects margin to <b>{num(market.model.rmse, 2)}</b> RMSE against the closing
                  line&apos;s <b>{num(market.market.rmse, 2)}</b>. <b>The market is better.</b> ATS
                  hit rate is {pct(market.ats_hit_rate, 1)} against a {pct(market.breakeven, 1)}{" "}
                  breakeven at −110, which is not an edge.
                </>
              )}
            </p>
            <p>
              The model does not know who is starting at quarterback, injuries, weather, rest or
              travel. The closing line knows all of it. That is most of the gap, and it is why this
              is model evaluation rather than a betting product.
            </p>
            <p>
              <b>Sign convention.</b> nflverse stores <code>spread_line</code> as the points the
              home club is favored by, so a home favorite is positive. A posted line states the
              favorite as a negative number.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Charted and tracking metrics</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Separation and coverage">
          <div className="notes-body one-col">
            <p>
              Separation falls about <b>0.12 yards for every yard of target depth</b> — screens
              create space almost automatically, a contested ball twenty yards downfield does not.
              Sorting on the raw number produces a list of who runs shallow, not who gets open. So
              both sides are measured against what their depth predicts, scaled so 100 is average
              and 15 points is one standard deviation.
            </p>
            <Formula note="coverage is signed so that allowing less is better">
              score = 100 + 15 × (actual − expected at depth) / sd
            </Formula>
            <p>
              The two sides are not symmetric. Receiver separation is tracking-derived from Next Gen
              Stats. Coverage is not — the league does not publish separation allowed — so a
              defender is measured on what happened when he was thrown at, which carries the
              quarterback&apos;s accuracy and the receiver&apos;s hands along with the coverage.
            </p>
          </div>
        </Panel>

        <Panel title="Coaching measures">
          <div className="notes-body one-col">
            <p>
              <b>Play-call entropy</b> takes a coach&apos;s pass/run split in each down and distance
              bucket, computes its binary entropy in bits, and averages the cells weighted by how
              often each comes up. A coach who runs every first and ten and throws every third and
              long scores near 0; one splitting 50/50 everywhere scores 1.0. It measures{" "}
              <em>predictability, not quality</em> — a coach can be predictable because he is
              committed to something that works.
            </p>
            <p>
              <b>Neutral game states only.</b> Everything except the record is computed from snaps
              with win probability between 20% and 80%. A coach down twenty-one in the fourth is not
              calling the game he wants to.
            </p>
            <p>
              <b>WP lost</b> is win probability surrendered to fourth-down decisions the model
              disagreed with. The model does not know personnel, so a club with a backup
              quarterback is charged the league-average conversion rate.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Decisions and fantasy</SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Fourth down">
          <div className="notes-body one-col">
            <p>
              Going for it is the conversion rate times win probability with a fresh set of downs,
              plus the failure case where the defense takes over at the spot. Kicking and punting
              are valued the same way through their own outcomes. The conversion model is fit on
              third and fourth down snaps pooled, because fourth down attempts alone are a biased
              sample of situations coaches already liked.
            </p>
            <p>
              It does not know who is on the field, the kicker, or the weather; field goal
              probability is fit on distance alone. The calculator grid holds timeouts at 3/3.
            </p>
          </div>
        </Panel>

        <Panel title="Fantasy value">
          <div className="notes-body one-col">
            <p>
              Raw fantasy points rank every quarterback above every back and tell you nothing,
              because you never choose between them. Value over replacement prices each player
              against the freely available alternative at his own position — the last startable
              player in a twelve-team league: QB12, RB24, WR36, TE12. The flex is deliberately not
              spread across positions, since that would make the baseline depend on how each league
              fills it.
            </p>
            <Formula note="the same shrinkage the projection model is fit with">
              rate = (games × this season + 4 × preseason projection) / (games + 4)
            </Formula>
            <p>
              Expected points come from nflverse&apos;s opportunity model, which prices every carry
              and target by down, distance, field position and air yards. It counts first downs, so
              its totals run above the PPR figures beside them and the two must not be subtracted
              from one another.
            </p>
          </div>
        </Panel>
      </div>

      <SectionRule>Data eras</SectionRule>
      <Panel>
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>From</th>
                <th className="l">Source</th>
                <th className="l">What it makes possible</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["1999", "nflverse play-by-play", "Expected points, win probability, success rate"],
                ["2006", "Air yards", "Receiver value, CPOE, expected fantasy points"],
                ["2012", "Snap counts (PFR)", "Line value split across a unit"],
                ["2016", "Next Gen Stats", "Separation, cushion, time to throw, yards over expected"],
                ["2018", "PFR charting", "Defensive value from coverage and pressure"],
                ["2020", "Participation", "Formation, personnel and pressure splits"],
              ].map(([year, source, gives]) => (
                <tr key={year}>
                  <td className="num font-semibold">{year}</td>
                  <td className="l whitespace-nowrap">{source}</td>
                  <td className="l text-ink-2 !whitespace-normal">{gives}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
