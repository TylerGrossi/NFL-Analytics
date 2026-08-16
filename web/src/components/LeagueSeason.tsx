import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import type { League, LeagueTeam, Move, WeekScore } from "@/lib/leagues";
import type { WeekProj } from "@/lib/queries";
import { optimiseLineup, slotAccepts, type Candidate } from "@/lib/fantasyMath";
import { toCandidates } from "@/components/LeagueTools";
import { num, pct, signed } from "@/lib/format";

// ------------------------------------------------------------- all-play

export type AllPlay = {
  team: LeagueTeam;
  weeks: number;
  pointsFor: number;
  allPlayWins: number;
  allPlayGames: number;
  allPlayPct: number;
  actualPct: number;
  /** Actual wins minus what the all-play record deserved. */
  luck: number;
};

/**
 * Score every team against every other team, every week.
 *
 * A fantasy record is mostly the schedule. Beating the one opponent you drew
 * says less than how your score ranked against the whole league, and the gap
 * between the two is luck — which is the number everybody argues about and
 * nobody computes.
 */
export function allPlay(league: League, history: WeekScore[]): AllPlay[] {
  const byWeek = new Map<number, WeekScore[]>();
  for (const s of history) {
    const list = byWeek.get(s.week);
    if (list) list.push(s);
    else byWeek.set(s.week, [s]);
  }

  const tally = new Map<string, { w: number; g: number; pf: number; weeks: number }>();
  for (const scores of byWeek.values()) {
    for (const a of scores) {
      const t = tally.get(a.rosterId) ?? { w: 0, g: 0, pf: 0, weeks: 0 };
      for (const b of scores) {
        if (b.rosterId === a.rosterId) continue;
        t.g += 1;
        if (a.points > b.points) t.w += 1;
        else if (a.points === b.points) t.w += 0.5;
      }
      t.pf += a.points;
      t.weeks += 1;
      tally.set(a.rosterId, t);
    }
  }

  return league.teams
    .map((team) => {
      const t = tally.get(team.id) ?? { w: 0, g: 0, pf: 0, weeks: 0 };
      const played = team.wins + team.losses + team.ties;
      const actualPct = played ? (team.wins + 0.5 * team.ties) / played : 0;
      const allPlayPct = t.g ? t.w / t.g : 0;
      return {
        team,
        weeks: t.weeks,
        pointsFor: t.pf,
        allPlayWins: t.w,
        allPlayGames: t.g,
        allPlayPct,
        actualPct,
        luck: played ? (actualPct - allPlayPct) * played : 0,
      };
    })
    .sort((a, b) => b.allPlayPct - a.allPlayPct);
}

export function AllPlayPanel({ rows }: { rows: AllPlay[] }) {
  const played = rows.some((r) => r.weeks > 0);
  if (!played) {
    return (
      <Panel title="All-play standings" meta="how you would do against everyone">
        <Empty>
          No weeks have been played yet. All-play needs scores, so this fills in once the season
          starts.
        </Empty>
      </Panel>
    );
  }

  return (
    <Panel title="All-play standings" meta="every team against every other, every week">
      <div className="scroll-x">
        <table className="grid-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="l">Team</th>
              <th>Real</th>
              <th title="Record if you played every team every week">All-play</th>
              <th title="Actual wins minus what the all-play record deserved">Luck</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.team.id}>
                <td className="num text-ink-3">{i + 1}</td>
                <td className="l font-medium">{r.team.name}</td>
                <td className="num text-ink-2">
                  {r.team.wins}–{r.team.losses}
                  {r.team.ties ? `–${r.team.ties}` : ""}
                </td>
                <td className="num font-semibold">{pct(r.allPlayPct, 1)}</td>
                <td
                  className="num font-semibold"
                  style={{
                    color:
                      r.luck >= 1 ? "var(--pos)" : r.luck <= -1 ? "var(--neg)" : "var(--ink-3)",
                  }}
                >
                  {signed(r.luck, 1)}
                </td>
                <td className="num text-ink-2">{num(r.pointsFor, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-2">
        <b>Luck</b> is actual wins minus what the all-play record earned. A team at +2 has won two
        more than its scores deserved — it drew the right opponents. Over a full season the schedule
        is worth a couple of wins either way, which is usually the difference between the playoffs
        and the couch.
      </div>
    </Panel>
  );
}

// -------------------------------------------------------- trade targets

/**
 * Who on another roster would most improve your starting lineup.
 *
 * A blank trade calculator asks the user to guess first. This works the other
 * way round: it prices every rostered player in the league against *your*
 * lineup, so the answer is a shortlist rather than a form. The number is the
 * points your optimal lineup gains — a great player at a position you are
 * already deep at is worth close to nothing, which is the whole point.
 */
export function tradeTargets(
  league: League,
  mine: LeagueTeam,
  proj: Map<string, WeekProj>,
  limit = 15
) {
  const roster = toCandidates(mine, proj);
  const base = optimiseLineup(roster, league.slots).total;

  const out: { player: Candidate; from: LeagueTeam; gain: number }[] = [];
  for (const other of league.teams) {
    if (other.id === mine.id) continue;
    for (const cand of toCandidates(other, proj)) {
      if (cand.proj === null) continue;
      // Only worth testing if some slot could actually take him.
      if (!league.slots.some((sl) => slotAccepts(sl, cand.position))) continue;
      const withHim = optimiseLineup([...roster, cand], league.slots).total;
      const gain = withHim - base;
      if (gain > 0.05) out.push({ player: cand, from: other, gain });
    }
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

export function TradeTargetPanel({
  targets,
  teamName,
}: {
  targets: ReturnType<typeof tradeTargets>;
  teamName: string;
}) {
  return (
    <Panel
      title="Who would upgrade your lineup"
      meta="points added to your optimal lineup this week"
    >
      {targets.length === 0 ? (
        <Empty>Nobody in the league would improve this lineup.</Empty>
      ) : (
        <>
          <div className="scroll-x max-h-[520px] scroll-y">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Player</th>
                  <th className="l">Pos</th>
                  <th className="l">Owned by</th>
                  <th>Proj</th>
                  <th>Gain</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t, i) => (
                  <tr key={`${t.player.playerId ?? t.player.name}-${i}`}>
                    <td className="l">
                      {t.player.playerId ? (
                        <Link href={`/players/${t.player.playerId}`} className="link-cell font-medium">
                          {t.player.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{t.player.name}</span>
                      )}
                    </td>
                    <td className="l text-ink-3 text-[11.5px]">{t.player.position}</td>
                    <td className="l text-ink-2 text-[11.5px]">{t.from.name}</td>
                    <td className="num text-ink-2">{num(t.player.proj, 1)}</td>
                    <td className="num font-semibold" style={{ color: "var(--pos)" }}>
                      +{num(t.gain, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-2">
            Gain is what {teamName}&apos;s optimal lineup adds with that player on the roster, so a
            star at a position you are already deep at scores near zero. It prices the fit, not the
            player — and it says nothing about what the other manager would want back.
          </div>
        </>
      )}
    </Panel>
  );
}

// ----------------------------------------------------------- moves log

export function MovesPanel({
  moves,
  league,
  nameOf,
}: {
  moves: Move[];
  league: League;
  nameOf: (sleeperId: string) => string;
}) {
  const teamName = (rosterId: string) =>
    league.teams.find((t) => t.id === rosterId)?.name ?? `Team ${rosterId}`;

  if (moves.length === 0) {
    return (
      <Panel title="Recent moves" meta="adds, drops and trades">
        <Empty>No completed transactions yet.</Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Recent moves" meta={`${moves.length} most recent`}>
      <div className="scroll-x max-h-[520px] scroll-y">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Wk</th>
              <th className="l">Type</th>
              <th className="l">Team</th>
              <th className="l">In</th>
              <th className="l">Out</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m, i) => (
              <tr key={`${m.created}-${i}`}>
                <td className="num text-ink-3">{m.week ?? "—"}</td>
                <td className="l text-[11.5px] text-ink-2">{m.type.replace(/_/g, " ")}</td>
                <td className="l text-[11.5px]">
                  {m.rosterIds.map(teamName).join(", ")}
                </td>
                <td className="l text-[11.5px]" style={{ color: "var(--pos)" }}>
                  {m.adds.map(nameOf).join(", ") || "—"}
                </td>
                <td className="l text-[11.5px] text-ink-3">
                  {m.drops.map(nameOf).join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
