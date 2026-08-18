import Link from "next/link";
import { Panel, RankChip, SectionRule, DivergingBar } from "@/components/ui";
import { Quadrant } from "@/components/LineChart";
import { SeasonNav } from "@/components/SeasonNav";
import {
  getBuiltSeasons,
  getManifest,
  getStandings,
  getTeamMap,
  getTeamSeasons,
} from "@/lib/queries";
import { num, pct, pts, signed } from "@/lib/format";

export const metadata = { title: "Teams" };
export const revalidate = 300;

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const season = Number(sp.season ?? manifest.stats_season);
  const [efficiency, standings, teams] = await Promise.all([
    getTeamSeasons(season),
    getStandings(season),
    getTeamMap(season),
  ]);
  const recordFor = Object.fromEntries(standings.map((s) => [s.team, s]));
  const quadrantPoints = efficiency.map((t) => ({
    team: t.team,
    x: t.off_adj,
    y: t.def_adj,
    color: teams[t.team]?.color ?? "var(--navy)",
    logo: teams[t.team]?.logo,
  }));

  return (
    <>
      <SectionRule>Teams</SectionRule>

      <SeasonNav seasons={seasons} active={season} href={(s) => `/teams?season=${s}`} />

      {/* Quadrant flips the defensive axis itself — pass EPA allowed as stored.
          The SVG scales to its container width, so the viewBox is what sets both
          the rendered height and the effective type scale — and the right box
          differs by breakpoint. On a wide screen 1280x400 keeps the whole plot
          above the fold and the labels near their nominal size; at 620 it stood
          over 1000px tall with labels at twice size. On a phone that same wide
          box collapses to ~100px of unreadable dots, so narrow screens get a
          square one instead. Only one is ever displayed, so the hidden copy's
          logos are never fetched. */}
      <Panel title="Efficiency landscape" className="mb-6">
        <div className="px-3 py-3">
          <div className="hidden sm:block">
            <Quadrant width={1280} height={400} points={quadrantPoints} />
          </div>
          <div className="sm:hidden">
            <Quadrant width={620} height={620} points={quadrantPoints} />
          </div>
        </div>
      </Panel>

      <Panel title="Full efficiency table">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Record</th>
                <th>Offense EPA</th>
                <th>Rank</th>
                <th>Defense EPA</th>
                <th>Rank</th>
                <th>Net</th>
                <th className="w-[90px]">Margin</th>
                <th>Pass</th>
                <th>Rush</th>
                <th>Success%</th>
                <th>Explosive%</th>
                {/* PROE and SoS stay abbreviated: spelled out they run to
                    "pass rate over expected" and "strength of schedule", each
                    several times the width of the figures beneath them. */}
                <th>PROE</th>
                <th>Points/drive</th>
                <th>Third down%</th>
                <th>SoS</th>
              </tr>
            </thead>
            <tbody>
              {efficiency.map((t) => {
                const meta = teams[t.team];
                const rec = recordFor[t.team];
                return (
                  <tr key={t.team}>
                    <td>
                      <Link href={`/teams/${t.team}`} className="link-cell flex items-center gap-2">
                        {meta?.logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={meta.logo} alt="" width={19} height={19} />
                        )}
                        <span className="font-semibold">{meta?.nick ?? t.team}</span>
                      </Link>
                    </td>
                    <td className="num text-ink-2">
                      {rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ""}` : "—"}
                    </td>
                    <td className="num">{signed(t.off_adj)}</td>
                    <td>
                      <RankChip rank={t.off_rank} />
                    </td>
                    <td className="num">{signed(t.def_adj)}</td>
                    <td>
                      <RankChip rank={t.def_rank} />
                    </td>
                    <td className="num font-semibold">{signed(t.net_adj)}</td>
                    <td>
                      <DivergingBar value={t.net_adj} max={0.25} />
                    </td>
                    <td className="num text-ink-2">{signed(t.off_pass_epa as number)}</td>
                    <td className="num text-ink-2">{signed(t.off_rush_epa as number)}</td>
                    <td className="num text-ink-2">{pct(t.off_success as number, 0)}</td>
                    <td className="num text-ink-2">{pct(t.off_explosive_rate as number, 0)}</td>
                    <td className="num text-ink-2">{pts(t.neutral_proe as number)}</td>
                    <td className="num text-ink-2">{num(t.off_points_per_drive as number, 2)}</td>
                    <td className="num text-ink-2">{pct(t.off_third_conv as number, 0)}</td>
                    <td className="num text-ink-3">{signed(t.sos as number)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
