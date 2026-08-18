import Link from "next/link";
import { Empty, Panel, TeamMark } from "@/components/ui";
import type { League, LeagueTeam } from "@/lib/leagues";
import type { Team, WeekProj } from "@/lib/queries";
import {
  matchupOdds,
  marginBuckets,
  optimiseLineup,
  playerSd,
  swapCost,
  type Candidate,
  type VarianceFit,
} from "@/lib/fantasyMath";
import { num, pct } from "@/lib/format";

/** Turn a synced roster into candidates carrying this week's projection. */
export function toCandidates(
  team: LeagueTeam,
  proj: Map<string, WeekProj>
): Candidate[] {
  return team.roster.map((s) => {
    const p = s.playerId ? proj.get(s.playerId) : undefined;
    return {
      playerId: s.playerId,
      name: s.name,
      position: p?.position ?? s.position,
      nflTeam: p?.team ?? s.nflTeam,
      proj: p?.proj_week ?? null,
      opponent: p?.opponent ?? null,
      matchupMult: p?.matchup_mult ?? null,
    };
  });
}

// --------------------------------------------------------------- lineup

export function LineupPanel({
  team,
  slots,
  proj,
  fits,
  week,
}: {
  team: LeagueTeam;
  slots: string[];
  proj: Map<string, WeekProj>;
  fits: VarianceFit[];
  week: number;
}) {
  const roster = toCandidates(team, proj);
  const { starters, bench } = optimiseLineup(roster, slots);
  const swaps = swapCost(starters, bench);

  return (
    <>
      <Panel
        title={`Optimal lineup · week ${week}`}
      >
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Slot</th>
                <th className="l">Player</th>
                <th className="l">Opp</th>
                <th>Proj</th>
                <th title="Fitted spread of this player's week">± sd</th>
              </tr>
            </thead>
            <tbody>
              {starters.map((s, i) => (
                <tr key={`${s.slot}-${i}`}>
                  <td className="l text-ink-3 text-[11.5px]">{s.slot}</td>
                  <td className="l">
                    {s.player?.playerId ? (
                      <Link href={`/players/${s.player.playerId}`} className="link-cell font-medium">
                        {s.player.name}
                      </Link>
                    ) : (
                      <span className="text-ink-3">— nobody eligible —</span>
                    )}
                  </td>
                  <td className="l text-[11.5px] text-ink-2">{s.player?.opponent ?? "—"}</td>
                  <td className="num font-semibold">
                    {s.player?.proj === null || s.player?.proj === undefined
                      ? "—"
                      : num(s.player.proj, 1)}
                  </td>
                  <td className="num text-ink-3">
                    {s.player?.proj
                      ? `±${num(playerSd(s.player.proj, s.player.position, fits), 1)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Swaps worth making"
        className="mt-4"
      >
        {swaps.length === 0 ? (
          <Empty>Nobody on the bench out-projects a starter.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Slot</th>
                  <th className="l">Bench</th>
                  <th className="l">Over</th>
                  <th>Gain</th>
                </tr>
              </thead>
              <tbody>
                {swaps.map((s, i) => (
                  <tr key={i}>
                    <td className="l text-ink-3 text-[11.5px]">{s.slot}</td>
                    <td className="l font-medium">{s.in.name}</td>
                    <td className="l text-ink-2">{s.out.name}</td>
                    <td className="num font-semibold" style={{ color: "var(--pos)" }}>
                      +{num(s.gain, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// -------------------------------------------------------------- matchup

export function MatchupPanel({
  league,
  a,
  b,
  proj,
  fits,
  week,
}: {
  league: League;
  a: LeagueTeam;
  b: LeagueTeam;
  proj: Map<string, WeekProj>;
  fits: VarianceFit[];
  week: number;
}) {
  const lineA = optimiseLineup(toCandidates(a, proj), league.slots);
  const lineB = optimiseLineup(toCandidates(b, proj), league.slots);
  const odds = matchupOdds(lineA.starters, lineB.starters, fits);
  const dist = marginBuckets(odds);
  const peak = Math.max(...dist.map((d) => d.p), 0.0001);

  // A slot we cannot project contributes nothing, which silently deflates that
  // side. With a stale or half-covered roster the model will happily report
  // 100%, so the odds are withheld until both lineups are mostly filled.
  const filled = (line: typeof lineA) =>
    line.starters.filter((s) => s.player?.proj != null).length;
  const need = Math.max(1, Math.ceil(league.slots.length * 0.6));
  const thin = filled(lineA) < need || filled(lineB) < need;

  const lo = dist[0]?.x ?? 0;
  const hi = dist[dist.length - 1]?.x ?? 0;
  // Where zero sits inside the plotted range, for the break-even marker.
  const zeroAt = hi > lo ? ((0 - lo) / (hi - lo)) * 100 : null;

  return (
    <Panel
      title={`Week ${week} matchup`}
    >
      <div className="grid grid-cols-3 items-center gap-2 px-4 py-4 border-b border-rule">
        <div>
          <div className="text-[12.5px] font-medium truncate">{a.name}</div>
          <div className="num text-[26px] font-semibold leading-tight">{num(odds.meanA, 1)}</div>
          <div className="text-[11px] text-ink-3">±{num(odds.sdA, 1)}</div>
        </div>
        <div className="text-center">
          {thin ? (
            <>
              <div className="num text-[30px] font-semibold leading-none text-ink-3">—</div>
              <div className="text-[11px] text-ink-3 mt-1">too few projected</div>
            </>
          ) : (
            <>
              <div
                className="num text-[30px] font-semibold leading-none"
                style={{ color: odds.winProbA >= 0.5 ? "var(--pos)" : "var(--neg)" }}
              >
                {pct(odds.winProbA, 0)}
              </div>
              <div className="text-[11px] text-ink-3 mt-1">
                {a.name.split(" ")[0]} to win
              </div>
            </>
          )}
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-medium truncate">{b.name}</div>
          <div className="num text-[26px] font-semibold leading-tight">{num(odds.meanB, 1)}</div>
          <div className="text-[11px] text-ink-3">±{num(odds.sdB, 1)}</div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="label mb-2">
          Margin distribution · {a.name.split(" ")[0]} minus {b.name.split(" ")[0]}
        </div>
        <div className="relative">
          <div className="flex items-end gap-[2px] h-[90px]">
            {dist.map((d, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[1px]"
                style={{
                  height: `${(d.p / peak) * 100}%`,
                  background: d.x >= 0 ? "var(--pos)" : "var(--neg)",
                  opacity: 0.55,
                }}
                title={`${d.x >= 0 ? "+" : ""}${d.x.toFixed(0)} pts: ${(d.p * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          {/* Break-even only gets a marker when it is actually on the chart. */}
          {zeroAt !== null && zeroAt >= 0 && zeroAt <= 100 && (
            <span
              className="absolute inset-y-0 w-px bg-rule-strong"
              style={{ left: `${zeroAt}%` }}
              aria-hidden
            />
          )}
        </div>
        <div className="relative text-[10.5px] text-ink-3 num mt-1 h-[14px]">
          <span className="absolute left-0">{num(lo, 0)}</span>
          {zeroAt !== null && zeroAt > 8 && zeroAt < 92 && (
            <span
              className="absolute -translate-x-1/2"
              style={{ left: `${zeroAt}%` }}
            >
              even
            </span>
          )}
          <span className="absolute right-0">{hi >= 0 ? "+" : ""}{num(hi, 0)}</span>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------- free agents

export function FreeAgentPanel({
  league,
  proj,
  teams,
  week,
  limit = 20,
}: {
  league: League;
  proj: Map<string, WeekProj>;
  teams: Record<string, Team>;
  week: number;
  limit?: number;
}) {
  const rostered = new Set(
    league.teams.flatMap((t) => t.roster.map((s) => s.playerId).filter(Boolean) as string[])
  );
  const free = [...proj.values()]
    .filter((p) => !rostered.has(p.player_id))
    .sort((a, b) => b.proj_week - a.proj_week)
    .slice(0, limit);

  return (
    <Panel
      title={`Best available · week ${week}`}
    >
      {free.length === 0 ? (
        <Empty>Every projected player is rostered.</Empty>
      ) : (
        <div className="scroll-x max-h-[560px] scroll-y">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th className="l">Tm</th>
                <th className="l">Opp</th>
                <th title="Opponent's rank in points allowed to this position">Draw</th>
                <th>Proj</th>
              </tr>
            </thead>
            <tbody>
              {free.map((p) => (
                <tr key={p.player_id}>
                  <td className="l">
                    <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                      {p.name}
                    </Link>
                  </td>
                  <td className="l text-ink-3 text-[11.5px]">{p.position}</td>
                  <td className="l">
                    <TeamMark
                      team={p.team}
                      logo={teams[p.team]?.logo}
                      size={16}
                      showAbbr={false}
                    />
                  </td>
                  <td className="l text-[11.5px] text-ink-2">{p.opponent}</td>
                  <td
                    className="num text-ink-2"
                    style={{
                      color:
                        p.fpa_rank === null
                          ? undefined
                          : p.fpa_rank <= 8
                            ? "var(--pos)"
                            : p.fpa_rank >= 25
                              ? "var(--neg)"
                              : undefined,
                    }}
                  >
                    {p.fpa_rank ?? "—"}
                  </td>
                  <td className="num font-semibold">{num(p.proj_week, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
