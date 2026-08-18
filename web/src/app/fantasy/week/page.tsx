import Link from "next/link";
import { Deck, Empty, PageHead, Panel, StatRow, StatTile, TeamMark } from "@/components/ui";
import {
  getFantasyWeek,
  getFantasyWeeks,
  getManifest,
  getRestOfSeason,
  getTeamMap,
  getWaiverTargets,
  type RosRow,
  type WeeklyRow,
} from "@/lib/queries";
import { num } from "@/lib/format";

export const metadata = { title: "Start / sit" };
export const revalidate = 900;

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"];

/** Rank 1 is the most generous defence, so a low rank is a good draw. */
function matchupTone(rank: number | null): string | undefined {
  if (rank === null) return undefined;
  if (rank <= 8) return "var(--pos)";
  if (rank >= 25) return "var(--neg)";
  return undefined;
}

function matchupLabel(rank: number | null): string {
  if (rank === null) return "—";
  if (rank <= 8) return "good";
  if (rank >= 25) return "tough";
  return "neutral";
}

export default async function FantasyWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; pos?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const weeks = await getFantasyWeeks();

  if (weeks.length === 0) {
    return (
      <>
        <PageHead>Start / sit</PageHead>
        <Empty>
          The in-season tables have not been built yet. Run the pipeline once the schedule and
          draft board exist.
        </Empty>
      </>
    );
  }

  // Default to the week the league is actually on, falling back to the first
  // one on the board before the season starts.
  const played = manifest.season_state?.current_week ?? 0;
  const defaultWeek = weeks.includes(played) ? played : weeks[0];
  const week = weeks.includes(Number(sp.week)) ? Number(sp.week) : defaultWeek;
  const position = POSITIONS.includes(sp.pos ?? "") ? (sp.pos as string) : "ALL";
  const view = ["week", "ros", "wire"].includes(sp.view ?? "") ? sp.view! : "week";

  const [weekRows, ros, wire, teams] = await Promise.all([
    view === "week" ? getFantasyWeek(week, position, 60) : Promise.resolve([]),
    view === "ros" ? getRestOfSeason(position, 60) : Promise.resolve([]),
    view === "wire" ? getWaiverTargets(position, 40) : Promise.resolve([]),
    getTeamMap(),
  ]);

  const anyPlayed = (weekRows[0]?.games_ytd ?? ros[0]?.games_ytd ?? 0) > 0;

  const qs = (patch: Record<string, string | number>) => {
    const base: Record<string, string> = { view, pos: position, week: String(week) };
    for (const [k, v] of Object.entries(patch)) base[k] = String(v);
    return `/fantasy/week?${new URLSearchParams(base).toString()}`;
  };

  const VIEWS = [
    { key: "week", label: `Week ${week}` },
    { key: "ros", label: "Rest of season" },
    { key: "wire", label: "Waiver wire" },
  ];

  return (
    <>
      <PageHead
        aside={
          <Link href="/fantasy/draft" className="text-accent">
            Draft board
          </Link>
        }
      >
        Start / sit · {manifest.scheduled_season}
      </PageHead>

      <Deck>A scoring rate times the draw — and the draw is worth less than the industry sells.</Deck>

      <StatRow className="mb-5">
        <StatTile
          label="Matchup, quarterbacks"
          value="0.26"
        />
        <StatTile label="Running backs" value="0.13" />
        <StatTile label="Receivers" value="0.10" />
        <StatTile
          label="Rates"
          value={anyPlayed ? "blended" : "projected"}
        />
      </StatRow>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={qs({ view: v.key })}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              v.key === view
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {POSITIONS.map((p) => (
          <Link
            key={p}
            href={qs({ pos: p })}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              p === position
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {p === "ALL" ? "All" : p}
          </Link>
        ))}
      </div>

      {view === "week" && (
        <div className="flex gap-1 flex-wrap mb-4">
          {weeks.map((w) => (
            <Link
              key={w}
              href={qs({ week: w })}
              className={`num px-2 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[11.5px] no-underline ${
                w === week
                  ? "bg-navy border-navy text-white"
                  : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
              }`}
            >
              {w}
            </Link>
          ))}
        </div>
      )}

      {view === "week" && (
        <Panel
          title={`Week ${week} board`}
        >
          {weekRows.length === 0 ? (
            <Empty>Nobody on a bye-free schedule at this position that week.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="l">Player</th>
                    <th className="l">Pos</th>
                    <th className="l">Tm</th>
                    <th className="l">Opp</th>
                    <th title="Opponent's rank in fantasy points allowed to this position — 1 is the most generous">
                      Def rk
                    </th>
                    <th className="l">Draw</th>
                    <th title="The scoring rate before the matchup is applied">Rate</th>
                    <th title="Rate multiplied by the measured matchup adjustment">Proj</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((r: WeeklyRow, i) => (
                    <tr key={r.player_id}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td className="l">
                        <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                          {r.name}
                        </Link>
                      </td>
                      <td className="l text-ink-3 text-[11.5px]">{r.position}</td>
                      <td className="l">
                        <TeamMark
                          team={r.team}
                          logo={teams[r.team]?.logo}
                          size={16}
                          showAbbr={false}
                          href={`/teams/${r.team}`}
                        />
                      </td>
                      <td className="l text-[11.5px] text-ink-2">
                        {r.home ? "vs " : "at "}
                        {r.opponent}
                      </td>
                      <td className="num text-ink-2">{r.fpa_rank ?? "—"}</td>
                      <td
                        className="l text-[11.5px]"
                        style={{ color: matchupTone(r.fpa_rank) }}
                      >
                        {matchupLabel(r.fpa_rank)}
                        <span className="text-ink-3 ml-1 num">
                          {r.matchup_mult >= 1 ? "+" : "−"}
                          {(Math.abs(r.matchup_mult - 1) * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="num text-ink-2">{num(r.rate, 1)}</td>
                      <td className="num font-semibold">{num(r.proj_week, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {view === "ros" && (
        <Panel title="Rest of season">
          {ros.length === 0 ? (
            <Empty>No rest-of-season projection built.</Empty>
          ) : (
            <RosTable rows={ros} teams={teams} />
          )}
        </Panel>
      )}

      {view === "wire" && (
        <Panel title="Waiver targets">
          {wire.length === 0 ? (
            <Empty>No ownership data to compare against.</Empty>
          ) : (
            <RosTable rows={wire} teams={teams} showGap />
          )}
        </Panel>
      )}

    </>
  );
}

function RosTable({
  rows,
  teams,
  showGap = false,
}: {
  rows: RosRow[];
  teams: Record<string, { logo?: string; nick?: string }>;
  showGap?: boolean;
}) {
  return (
    <div className="scroll-x">
      <table className="grid-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="l">Player</th>
            <th className="l">Pos</th>
            <th className="l">Tm</th>
            <th>Games</th>
            <th title="Average projected points per remaining game">PPG</th>
            <th>Total</th>
            <th title="Average matchup adjustment across the remaining schedule">Sched</th>
            {showGap ? <th title="ESPN rostered percentage">Owned</th> : <th>Pos rk</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.player_id}>
              <td className="num text-ink-3">{i + 1}</td>
              <td className="l">
                <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                  {r.name}
                </Link>
              </td>
              <td className="l text-ink-3 text-[11.5px]">{r.position}</td>
              <td className="l">
                <TeamMark
                  team={r.team}
                  logo={teams[r.team]?.logo}
                  size={16}
                  showAbbr={false}
                  href={`/teams/${r.team}`}
                />
              </td>
              <td className="num text-ink-2">{r.games_left}</td>
              <td className="num text-ink-2">{num(r.ros_ppg, 1)}</td>
              <td className="num font-semibold">{num(r.ros_points, 0)}</td>
              <td
                className="num text-ink-2"
                style={{
                  color:
                    r.ros_matchup >= 1.01
                      ? "var(--pos)"
                      : r.ros_matchup <= 0.99
                        ? "var(--neg)"
                        : undefined,
                }}
              >
                {r.ros_matchup >= 1 ? "+" : "−"}
                {(Math.abs(r.ros_matchup - 1) * 100).toFixed(1)}%
              </td>
              {showGap ? (
                <td className="num text-ink-2">
                  {r.espn_pct_owned === null ? "—" : `${num(r.espn_pct_owned, 0)}%`}
                </td>
              ) : (
                <td className="num text-ink-2">
                  {r.position}
                  {r.pos_rank}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
