import Link from "next/link";
import { Deck, DivergingBar, Empty, Notes, Panel, PageHead, StatRow, StatTile } from "@/components/ui";
import { SeasonNav } from "@/components/SeasonNav";
import {
  getFantasyRegression,
  getFantasyReplacement,
  getFantasySeason,
  getFantasySeasons,
} from "@/lib/queries";
import { int, num, pct, signed } from "@/lib/format";

export const metadata = { title: "Fantasy" };
export const revalidate = 900;

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

export default async function FantasyPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; pos?: string }>;
}) {
  const sp = await searchParams;
  const seasons = await getFantasySeasons();
  const newest = seasons[0] ?? 2025;
  const season = seasons.includes(Number(sp.season)) ? Number(sp.season) : newest;
  const posParam = (sp.pos ?? "ALL").toUpperCase();
  const pos = (POSITIONS as readonly string[]).includes(posParam) ? posParam : "ALL";

  const [board, replacement, over, under] = await Promise.all([
    getFantasySeason(season, pos === "ALL" ? null : pos, 60),
    getFantasyReplacement(season),
    getFantasyRegression(season, true, 10),
    getFantasyRegression(season, false, 10),
  ]);

  const href = (patch: { season?: number; pos?: string }) => {
    const q = new URLSearchParams({
      season: String(patch.season ?? season),
      pos: patch.pos ?? pos,
    });
    return `/fantasy?${q.toString()}`;
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
      active
        ? "bg-navy border-navy text-white"
        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
    }`;

  const hasExpected = board.some((r) => r.expected_points !== null);

  return (
    <>
      <PageHead
        aside={
          <Link href="/fantasy/draft" className="text-accent">
            Draft board →
          </Link>
        }
      >
        Fantasy
      </PageHead>

      <Deck>
        Value over replacement, not raw points — each player priced against the freely available
        alternative at his own position.
      </Deck>

      <Link
        href="/fantasy/draft"
        className="panel px-4 py-3 mb-4 flex items-center gap-3 no-underline hover:border-rule-strong transition-colors"
      >
        <span className="flex-1">
          <span className="block font-semibold text-[13.5px] text-ink">Draft board</span>
          <span className="block text-[11.5px] text-ink-3">
            Projections for the coming season, re-ranked for your league — size, PPR or standard,
            superflex, TE premium — with tiers and where the model disagrees with consensus.
          </span>
        </span>
        <span className="text-accent text-[13px] shrink-0">Open →</span>
      </Link>

      <Link
        href="/fantasy/espn"
        className="panel px-4 py-3 mb-4 flex items-center gap-3 no-underline hover:border-rule-strong transition-colors"
      >
        <span className="flex-1">
          <span className="block font-semibold text-[13.5px] text-ink">ESPN league value</span>
          <span className="block text-[11.5px] text-ink-3">
            Where ESPN drafters take players later than the wider consensus rates them — the gap you
            can exploit if your league is on ESPN.
          </span>
        </span>
        <span className="text-accent text-[13px] shrink-0">Open →</span>
      </Link>

      <StatRow className="mb-5">
        {replacement.map((r) => (
          <StatTile
            key={r.position}
            label={`${r.position} replacement`}
            value={num(r.replacement_ppg, 1)}
            meta={`points per game · ${r.position}${r.replacement_rank}`}
          />
        ))}
      </StatRow>

      <SeasonNav seasons={seasons} active={season} href={(s) => href({ season: s })} />

      <div className="flex gap-1.5 items-center flex-wrap mb-4">
        <span className="label shrink-0">Position</span>
        {POSITIONS.map((p) => (
          <Link key={p} href={href({ pos: p })} className={chip(p === pos)}>
            {p === "ALL" ? "All" : p}
          </Link>
        ))}
      </div>

      <Panel
        title={`${pos === "ALL" ? "Overall" : pos} board`}
        meta="ranked by value over replacement"
        className="mb-4"
      >
        {board.length === 0 ? (
          <Empty>Nothing stored for this season.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">Player</th>
                  <th className="l">Pos</th>
                  <th>G</th>
                  <th>Pts</th>
                  <th>PPG</th>
                  <th>VOR</th>
                  <th className="w-[90px]">vs repl</th>
                  <th>xFP</th>
                  <th>+/−</th>
                  <th>Tgt</th>
                  <th>Tgt%</th>
                  <th>Best</th>
                  <th>SD</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.player_id}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="l">
                      <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                        {r.name}
                      </Link>
                    </td>
                    <td className="l text-ink-2">
                      {r.position}
                      <span className="text-ink-3 num ml-1 text-[11px]">{r.pos_rank}</span>
                    </td>
                    <td className="num text-ink-2">{int(r.games)}</td>
                    <td className="num text-ink-2">{num(r.points, 1)}</td>
                    <td className="num">{num(r.ppg, 1)}</td>
                    <td className="num font-semibold">{num(r.vor, 1)}</td>
                    <td>
                      <DivergingBar value={r.vor_per_game} max={12} />
                    </td>
                    <td className="num text-ink-3">
                      {r.expected_points === null ? "—" : num(r.expected_points, 0)}
                    </td>
                    <td
                      className={`num ${
                        (r.points_over_expected ?? 0) > 0 ? "text-pos" : "text-neg"
                      }`}
                    >
                      {r.points_over_expected === null ? "—" : signed(r.points_over_expected, 0)}
                    </td>
                    <td className="num text-ink-2">{int(r.targets)}</td>
                    <td className="num text-ink-2">
                      {r.target_share === null ? "—" : pct(r.target_share, 0)}
                    </td>
                    <td className="num text-ink-2">{num(r.best_week, 1)}</td>
                    <td className="num text-ink-3">{num(r.weekly_sd, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {hasExpected && (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Regression
            title="Outscored their usage"
            meta="candidates to come back down"
            rows={over}
            tone="bad"
          />
          <Regression
            title="Underscored their usage"
            meta="candidates to come back up"
            rows={under}
            tone="good"
          />
        </div>
      )}

      <div className="text-[11.5px] text-ink-3 mt-4 max-w-[92ch] leading-relaxed">
        Expected points (<span className="num">xFP</span>) come from nflverse&apos;s opportunity
        model, which prices every carry and target by down, distance, field position and air yards —
        what the usage was worth, before the ball bounced. That model scores on its own system,
        counting first downs, so its totals run above the PPR column beside them and the two should
        not be subtracted from one another; the <span className="num">+/−</span> is always computed
        inside the model&apos;s own scoring. A large positive gap usually means touchdown luck rather than skill, and
        touchdown rates regress hard. It is a prior, not a verdict: the model does not know that a
        receiver is the one his team throws to at the goal line by design. Expected points need air
        yards and so begin in 2006; before that the column is blank. VOR is scored in full PPR and
        multiplies the per-game edge by games played, so missed time costs rather than being ignored.
      </div>
      <Notes>
        <p>
          Raw fantasy points rank every quarterback above every running back and tell you nothing,
          because you never choose between them — a lineup takes one of the first and several of the
          second. Value over replacement prices each player against the freely available alternative
          at his own position, the same idea WAR applies to real football. Replacement is the last
          startable player in a twelve-team league: QB12, RB24, WR36, TE12. The flex is deliberately
          not spread across positions, since that would make the baseline depend on how each league
          fills it.
        </p>
        <p>
          Expected points come from nflverse&apos;s opportunity model, which prices every carry and
          target by down, distance, field position and air yards.{" "}
          <b>It scores on its own system — it counts first downs — so its totals run above the PPR
          figures beside them and the two must not be subtracted from one another.</b>{" "}
          Both its actual and its expected are carried through so the gap is always computed inside
          one scoring system. Expected points need air yards and so begin in 2006.
        </p>
      </Notes>

    </>
  );
}

function Regression({
  title,
  meta,
  rows,
  tone,
}: {
  title: string;
  meta: string;
  rows: Awaited<ReturnType<typeof getFantasyRegression>>;
  tone: "good" | "bad";
}) {
  return (
    <Panel title={title} meta={meta}>
      {rows.length === 0 ? (
        <Empty>Not enough data for this season.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th>G</th>
                <th>xFP act</th>
                <th>xFP exp</th>
                <th>+/−</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player_id}>
                  <td className="l">
                    <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                      {r.name}
                    </Link>
                  </td>
                  <td className="l text-ink-2">{r.position}</td>
                  <td className="num text-ink-2">{int(r.games)}</td>
                  <td className="num">{num(r.opportunity_points, 1)}</td>
                  <td className="num text-ink-3">{num(r.expected_points, 1)}</td>
                  <td className={`num font-semibold ${tone === "good" ? "text-pos" : "text-neg"}`}>
                    {signed(r.points_over_expected, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
