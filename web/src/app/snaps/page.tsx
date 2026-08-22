import Link from "next/link";
import { SeasonNav } from "@/components/SeasonNav";
import { TeamSelect } from "@/components/TeamSelect";
import { Empty, Panel, SectionRule } from "@/components/ui";
import {
  getManifest,
  getSnapSeasons,
  getSnapTeams,
  getSnapWeeks,
  getTeamMap,
  type SnapWeekRow,
} from "@/lib/queries";

export const metadata = { title: "Snap counts" };
export const revalidate = 900;

const GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "OTHER"];
const GROUP_LABEL: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  OL: "Offensive line",
  DL: "Defensive line",
  LB: "Linebacker",
  DB: "Defensive back",
  OTHER: "Other",
};
const OFFENSE = new Set(["QB", "RB", "WR", "TE", "OL"]);

export default async function SnapsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; team?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getSnapSeasons();
  const season = Number(sp.season ?? seasons[0] ?? manifest.stats_season);

  // From the snap store, not the team map: the team map carries every franchise
  // the store has ever known, so 2025 offered SD, STL and OAK and each of them
  // led to an empty page.
  const teamList = await getSnapTeams(season);
  const team = sp.team && teamList.includes(sp.team) ? sp.team : teamList[0] ?? "ARI";
  const teams = await getTeamMap(season);

  const rows = await getSnapWeeks(season, team);
  const weeks = [...new Set(rows.map((r) => Number(r.week)))].sort((a, b) => a - b);

  const byGroup = new Map<string, Map<string, SnapWeekRow[]>>();
  for (const r of rows) {
    const g = r.pos_group ?? "OTHER";
    if (!byGroup.has(g)) byGroup.set(g, new Map());
    const players = byGroup.get(g)!;
    if (!players.has(r.player)) players.set(r.player, []);
    players.get(r.player)!.push(r);
  }

  const teamOptions = teamList.map((t) => ({
    team: t,
    name: teams[t]?.nick ?? t,
    href: `/snaps?season=${season}&team=${t}`,
  }));

  // One table, fixed widths, so a week sits in the same column in every group.
  const WEEK_W = 58;

  return (
    <>
      <SectionRule>Snap counts</SectionRule>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <SeasonNav
          seasons={seasons}
          active={season}
          href={(s) => `/snaps?season=${s}&team=${team}`}
          inline
        />
        <TeamSelect options={teamOptions} active={team} />
      </div>

      {rows.length === 0 ? (
        <Empty>
          No snap counts for {team} in {season}.
        </Empty>
      ) : (
        <Panel bodyClass="scroll-x">
          <table
            className="grid-table snap-grid"
            style={{
              tableLayout: "fixed",
              width: "100%",
              minWidth: 184 + weeks.length * WEEK_W + 124,
            }}
          >
            <tbody>
              {/* A header row per position group, the way a snap-count sheet is
                  normally set: the group name sits where the player names are
                  and the week labels repeat, so a reader deep in the defensive
                  backs still knows which week a column is. */}
              {GROUP_ORDER.filter((g) => byGroup.has(g)).flatMap((g) => {
                const players = byGroup.get(g)!;
                const offense = OFFENSE.has(g);
                const snapsOf = (r: SnapWeekRow) =>
                  Number((offense ? r.off_snaps : r.def_snaps) ?? 0);
                const shareOf = (r: SnapWeekRow) =>
                  Number((offense ? r.off_pct : r.def_pct) ?? 0);
                const ordered = [...players.entries()].sort(
                  (a, b) =>
                    b[1].reduce((s, r) => s + snapsOf(r), 0) -
                    a[1].reduce((s, r) => s + snapsOf(r), 0)
                );

                return [
                  <tr key={`head-${g}`} className="snap-head">
                    <th
                      scope="col"
                      className="l sticky left-0 z-[2]"
                      style={{ width: 184, background: "var(--panel-2)" }}
                    >
                      {GROUP_LABEL[g] ?? g}
                    </th>
                    {weeks.map((w) => (
                      <th key={w} scope="col" style={{ width: WEEK_W }}>
                        Wk {w}
                      </th>
                    ))}
                    <th scope="col" style={{ width: 62 }}>
                      Total
                    </th>
                    <th scope="col" style={{ width: 62 }}>
                      Share
                    </th>
                  </tr>,
                  ...ordered.map(([player, rs]) => {
                    const byWeek = new Map(rs.map((r) => [Number(r.week), r]));
                    const total = rs.reduce((s, r) => s + snapsOf(r), 0);
                    // Averaged over the weeks he actually played rather than
                    // over the season: a man who missed six weeks and took
                    // every snap of the rest is a full-time player.
                    const played = rs.filter((r) => snapsOf(r) > 0);
                    const share = played.length
                      ? played.reduce((sum, r) => sum + shareOf(r), 0) / played.length
                      : 0;
                    const id = rs.find((r) => r.player_id)?.player_id ?? null;
                    return (
                      <tr key={`${g}-${player}`}>
                        <td
                          className="l sticky left-0 z-[1] truncate"
                          style={{ background: "var(--panel)", maxWidth: 184 }}
                        >
                          {id ? (
                            <Link href={`/players/${id}?season=${season}`} className="link-cell">
                              {player}
                            </Link>
                          ) : (
                            player
                          )}
                        </td>
                        {weeks.map((w) => {
                          const r = byWeek.get(w);
                          const snaps = r ? Math.round(snapsOf(r)) : 0;
                          const share = r ? shareOf(r) : 0;
                          // A week he did not play is a single figure, not a
                          // count stacked on a nought.
                          if (snaps <= 0) {
                            return (
                              <td key={w} className="num text-ink-3">
                                0
                              </td>
                            );
                          }
                          return (
                            <td key={w} className="num">
                              <span className="snap-count block leading-tight">
                                {snaps}
                              </span>
                              <span className="block font-semibold leading-tight">
                                {Math.round(share * 100)}%
                              </span>
                            </td>
                          );
                        })}
                        <td className="num font-semibold">{Math.round(total)}</td>
                        <td className="num text-ink-2">{Math.round(share * 100)}%</td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
