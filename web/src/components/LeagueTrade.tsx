import Link from "next/link";
import { Empty, Panel } from "@/components/ui";
import type { League, LeagueTeam, WeekScore } from "@/lib/leagues";
import type { WeekProj } from "@/lib/queries";
import { optimiseLineup, type Candidate } from "@/lib/fantasyMath";
import { toCandidates } from "@/components/LeagueTools";
import { num, signed } from "@/lib/format";

/**
 * A two-sided trade, priced on both lineups.
 *
 * The trade *targets* panel answers "who helps me". This answers the different
 * question a trade actually poses: is the swap good for both sides? Value is
 * the change in each club's optimal starting lineup, so depth at a position
 * you already own is correctly worth nothing, and a swap can improve both
 * teams at once — which is the only kind that gets accepted.
 *
 * State lives entirely in the query string, so a proposal is a link you can
 * paste into the league chat.
 */
export function TradeSimulator({
  league,
  mine,
  partner,
  give,
  get,
  proj,
  hrefFor,
}: {
  league: League;
  mine: LeagueTeam;
  partner: LeagueTeam;
  give: Set<string>;
  get: Set<string>;
  proj: Map<string, WeekProj>;
  hrefFor: (patch: { give?: string[]; get?: string[]; vs?: string }) => string;
}) {
  const myRoster = toCandidates(mine, proj);
  const theirRoster = toCandidates(partner, proj);

  const outgoing = myRoster.filter((p) => p.playerId && give.has(p.playerId));
  const incoming = theirRoster.filter((p) => p.playerId && get.has(p.playerId));

  const after = (
    roster: Candidate[],
    lose: Candidate[],
    gain: Candidate[]
  ) => {
    const losing = new Set(lose.map((p) => p.playerId));
    return optimiseLineup(
      [...roster.filter((p) => !losing.has(p.playerId)), ...gain],
      league.slots
    ).total;
  };

  const myBefore = optimiseLineup(myRoster, league.slots).total;
  const theirBefore = optimiseLineup(theirRoster, league.slots).total;
  const myAfter = after(myRoster, outgoing, incoming);
  const theirAfter = after(theirRoster, incoming, outgoing);

  const mySwing = myAfter - myBefore;
  const theirSwing = theirAfter - theirBefore;
  const live = outgoing.length > 0 || incoming.length > 0;

  const verdict = !live
    ? null
    : mySwing > 0.2 && theirSwing > 0.2
      ? { text: "Both sides improve", tone: "var(--pos)" }
      : mySwing > 0.2 && theirSwing <= 0.2
        ? { text: "Good for you, not for them", tone: "var(--flag)" }
        : mySwing <= 0.2 && theirSwing > 0.2
          ? { text: "Good for them, not for you", tone: "var(--neg)" }
          : { text: "Neither side gains", tone: "var(--ink-3)" };

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return [...next];
  };

  const column = (
    title: string,
    team: LeagueTeam,
    roster: Candidate[],
    selected: Set<string>,
    key: "give" | "get"
  ) => (
    <div>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="text-[11px] text-ink-3">{team.name}</span>
      </div>
      <div className="scroll-x max-h-[360px] scroll-y">
        <table className="grid-table">
          <tbody>
            {roster
              .filter((p) => p.playerId)
              .sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1))
              .map((p) => {
                const on = selected.has(p.playerId!);
                return (
                  <tr key={p.playerId} style={on ? { background: "var(--accent-wash)" } : undefined}>
                    <td className="l">
                      <Link
                        href={hrefFor({ [key]: toggle(selected, p.playerId!) })}
                        className="link-cell"
                      >
                        {on ? "− " : "+ "}
                        <span className={on ? "font-semibold" : ""}>{p.name}</span>
                      </Link>
                    </td>
                    <td className="l text-ink-3 text-[11.5px]">{p.position}</td>
                    <td className="num text-ink-2">
                      {p.proj === null ? "—" : num(p.proj, 1)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <Panel title="Trade simulator">
        <div className="grid grid-cols-3 items-center gap-2 px-4 py-4 border-b border-rule">
          <div>
            <div className="text-[12.5px] font-medium truncate">{mine.name}</div>
            <div
              className="num text-[24px] font-semibold leading-tight"
              style={{ color: mySwing > 0.05 ? "var(--pos)" : mySwing < -0.05 ? "var(--neg)" : undefined }}
            >
              {live ? signed(mySwing, 1) : "—"}
            </div>
            <div className="text-[11px] text-ink-3">
              {num(myBefore, 1)} → {num(myAfter, 1)}
            </div>
          </div>
          <div className="text-center">
            <div
              className="text-[12.5px] font-semibold"
              style={{ color: verdict?.tone ?? "var(--ink-3)" }}
            >
              {verdict?.text ?? "Pick players from both sides"}
            </div>
            <div className="text-[11px] text-ink-3 mt-1">
              {outgoing.length} out · {incoming.length} in
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12.5px] font-medium truncate">{partner.name}</div>
            <div
              className="num text-[24px] font-semibold leading-tight"
              style={{ color: theirSwing > 0.05 ? "var(--pos)" : theirSwing < -0.05 ? "var(--neg)" : undefined }}
            >
              {live ? signed(theirSwing, 1) : "—"}
            </div>
            <div className="text-[11px] text-ink-3">
              {num(theirBefore, 1)} → {num(theirAfter, 1)}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-rule">
          <div className="bg-panel">{column("You give", mine, myRoster, give, "give")}</div>
          <div className="bg-panel">{column("You get", partner, theirRoster, get, "get")}</div>
        </div>

        <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-2">
          Both numbers are the change in that club&apos;s <em>optimal starting lineup</em> this week,
          so surplus depth is correctly worth nothing and a trade can help both sides at once. It
          values this week only — it knows nothing about the rest of the schedule, byes, or what
          either manager is trying to build.
        </div>
      </Panel>

      <div className="flex gap-1 flex-wrap mt-3">
        <span className="label self-center mr-1">Trade with</span>
        {league.teams
          .filter((t) => t.id !== mine.id)
          .map((t) => (
            <Link
              key={t.id}
              href={hrefFor({ vs: t.id, get: [] })}
              className={`px-2 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[11.5px] no-underline ${
                t.id === partner.id
                  ? "bg-navy border-navy text-white"
                  : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
              }`}
            >
              {t.name}
            </Link>
          ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------ scoreboard

/** Weekly results, or the projection when a week has not been played. */
export function ScoreboardPanel({
  league,
  history,
  week,
}: {
  league: League;
  history: WeekScore[];
  week: number;
}) {
  const rows = history.filter((h) => h.week === week);
  if (rows.length === 0) {
    return (
      <Panel title={`Week ${week} scoreboard`}>
        <Empty>Week {week} has not been played.</Empty>
      </Panel>
    );
  }

  const pairs = new Map<number, WeekScore[]>();
  for (const r of rows) {
    if (r.matchupId === null) continue;
    const list = pairs.get(r.matchupId);
    if (list) list.push(r);
    else pairs.set(r.matchupId, [r]);
  }
  const name = (id: string) =>
    league.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  return (
    <Panel title={`Week ${week} scoreboard`}>
      <div className="scroll-x">
        <table className="grid-table">
          <tbody>
            {[...pairs.values()].map((m, i) => {
              const [a, b] = m;
              if (!a || !b) return null;
              const aWon = a.points > b.points;
              return (
                <tr key={i}>
                  <td className={`l ${aWon ? "font-semibold" : "text-ink-2"}`}>{name(a.rosterId)}</td>
                  <td className={`num ${aWon ? "font-semibold" : "text-ink-2"}`}>
                    {num(a.points, 1)}
                  </td>
                  <td className="num text-ink-3">–</td>
                  <td className={`num ${aWon ? "text-ink-2" : "font-semibold"}`}>
                    {num(b.points, 1)}
                  </td>
                  <td className={`l ${aWon ? "text-ink-2" : "font-semibold"}`}>{name(b.rosterId)}</td>
                  <td className="num text-ink-3">{signed(a.points - b.points, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// -------------------------------------------------------- season summary

export function SeasonSummaryPanel({
  league,
  history,
}: {
  league: League;
  history: WeekScore[];
}) {
  if (history.length === 0) {
    return (
      <Panel title="Season summary">
        <Empty>No completed weeks yet.</Empty>
      </Panel>
    );
  }

  const name = (id: string) =>
    league.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  const best = [...history].sort((a, b) => b.points - a.points)[0];
  const worst = [...history].sort((a, b) => a.points - b.points)[0];
  const avg = history.reduce((s, h) => s + h.points, 0) / history.length;

  // Closest and widest results, which need the pairings.
  const byPair = new Map<string, WeekScore[]>();
  for (const h of history) {
    if (h.matchupId === null) continue;
    const k = `${h.week}-${h.matchupId}`;
    const list = byPair.get(k);
    if (list) list.push(h);
    else byPair.set(k, [h]);
  }
  const margins = [...byPair.values()]
    .filter((m) => m.length === 2)
    .map((m) => ({ m, gap: Math.abs(m[0].points - m[1].points) }))
    .sort((a, b) => a.gap - b.gap);
  const closest = margins[0];
  const blowout = margins[margins.length - 1];

  return (
    <Panel title="Season summary">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))] px-4 py-3.5">
        <div>
          <div className="label">Highest week</div>
          <div className="num text-[20px] font-semibold mt-0.5">{num(best.points, 1)}</div>
          <div className="text-[11px] text-ink-3">
            {name(best.rosterId)} · wk {best.week}
          </div>
        </div>
        <div>
          <div className="label">Lowest week</div>
          <div className="num text-[20px] font-semibold mt-0.5">{num(worst.points, 1)}</div>
          <div className="text-[11px] text-ink-3">
            {name(worst.rosterId)} · wk {worst.week}
          </div>
        </div>
        <div>
          <div className="label">League average</div>
          <div className="num text-[20px] font-semibold mt-0.5">{num(avg, 1)}</div>
          <div className="text-[11px] text-ink-3">per team per week</div>
        </div>
        {closest && (
          <div>
            <div className="label">Closest game</div>
            <div className="num text-[20px] font-semibold mt-0.5">{num(closest.gap, 2)}</div>
            <div className="text-[11px] text-ink-3">
              wk {closest.m[0].week} · {name(closest.m[0].rosterId)}
            </div>
          </div>
        )}
        {blowout && (
          <div>
            <div className="label">Biggest blowout</div>
            <div className="num text-[20px] font-semibold mt-0.5">{num(blowout.gap, 1)}</div>
            <div className="text-[11px] text-ink-3">
              wk {blowout.m[0].week} · {name(blowout.m[0].rosterId)}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
