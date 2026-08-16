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
    getTeamMap(),
  ]);
  const recordFor = Object.fromEntries(standings.map((s) => [s.team, s]));

  return (
    <>
      <SectionRule aside={`${season} · sorted by net rating`}>Teams</SectionRule>

      <SeasonNav seasons={seasons} active={season} href={(s) => `/teams?season=${s}`} />

      <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] mb-6">
        {efficiency.slice(0, 8).map((t) => {
          const meta = teams[t.team];
          const rec = recordFor[t.team];
          return (
            <Link
              key={t.team}
              href={`/teams/${t.team}?season=${season}`}
              className="panel px-3 py-2.5 no-underline hover:border-rule-strong transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {meta?.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meta.logo} alt="" width={30} height={30} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[13px] text-ink truncate">{meta?.nick ?? t.team}</div>
                  <div className="text-[11px] text-ink-3 num">
                    {rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ""}` : ""} · net {signed(t.net_adj)}
                  </div>
                </div>
                <span className="num text-[19px] font-semibold text-ink-2">{t.net_rank}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Quadrant flips the defensive axis itself — pass EPA allowed as stored. */}
      <Panel
        title="Efficiency landscape"
        meta="opponent-adjusted EPA per play · up and right is better"
        className="mb-6"
      >
        <div className="px-3 py-3">
          <Quadrant
            points={efficiency.map((t) => ({
              team: t.team,
              x: t.off_adj,
              y: t.def_adj,
              color: teams[t.team]?.color ?? "var(--navy)",
              logo: teams[t.team]?.logo,
            }))}
          />
        </div>
      </Panel>

      <Panel title="Full efficiency table" meta="opponent-adjusted EPA per play">
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Rec</th>
                <th>Off EPA</th>
                <th>Rk</th>
                <th>Def EPA</th>
                <th>Rk</th>
                <th>Net</th>
                <th className="w-[90px]">Margin</th>
                <th>Pass</th>
                <th>Rush</th>
                <th>Succ%</th>
                <th>Expl%</th>
                <th>PROE</th>
                <th>Pts/Dr</th>
                <th>3rd%</th>
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
