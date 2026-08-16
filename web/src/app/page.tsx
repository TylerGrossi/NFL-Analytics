import Link from "next/link";
import { Panel, RankChip, SectionRule, StatTile, TeamMark, DivergingBar } from "@/components/ui";
import { getScoreboard } from "@/lib/espn";
import {
  getGames,
  getLeaders,
  getLeaguePulse,
  getManifest,
  getStandings,
  getTeamMap,
  getTeamSeasons,
} from "@/lib/queries";
import { gameDate, int, num, pct, pts, signed, line } from "@/lib/format";

export const revalidate = 60;

export default async function HomePage() {
  const manifest = await getManifest();
  const season = manifest.stats_season;

  const [teams, standings, efficiency, pulse, qbLeaders, live, upcoming] = await Promise.all([
    getTeamMap(),
    getStandings(season),
    getTeamSeasons(season),
    getLeaguePulse(season),
    getLeaders("qb-epa", season, 8),
    getScoreboard(),
    getGames(manifest.scheduled_season, 1),
  ]);

  const inProgress = live.filter((g) => g.state === "in");
  const topTeams = efficiency.slice(0, 10);
  const offseason = manifest.season_state.state === "upcoming";

  return (
    <>
      {inProgress.length > 0 && (
        <>
          <SectionRule aside={offseason ? "preseason — not included in any stat on this page" : "from ESPN, refreshed every 30s"}>
            Live now
          </SectionRule>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {inProgress.map((g) => (
              <Link
                key={g.id}
                href={`/games/${g.id}`}
                className="panel px-3.5 py-3 no-underline hover:border-rule-strong transition-colors block"
              >
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="label !text-pos">● {g.detail}</span>
                  <span className="text-ink-3">{g.broadcast}</span>
                </div>
                {[g.away, g.home].map((t) => (
                  <div key={t.abbr ?? ""} className="flex items-center gap-2.5 py-1">
                    {t.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.logo} alt="" width={20} height={20} />
                    )}
                    <span className="flex-1 font-semibold text-[13px]">{t.abbr}</span>
                    <span className="text-[11px] text-ink-3">{t.record}</span>
                    <span className="num text-[17px] font-semibold">{t.score ?? "—"}</span>
                  </div>
                ))}
                <div className="text-[11px] text-ink-2 mt-1.5 pt-1.5 border-t border-rule flex justify-between gap-2">
                  <span className="truncate">{g.downDistance ?? "—"}</span>
                  <span className="text-accent shrink-0">4th down call →</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionRule aside={`${int(pulse?.plays)} scrimmage plays`}>
        {season} league averages
      </SectionRule>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(155px,1fr))]">
        <StatTile label="Pass EPA / play" value={signed(pulse?.pass_epa ?? null)} meta="all dropbacks" />
        <StatTile label="Rush EPA / play" value={signed(pulse?.rush_epa ?? null)} meta="designed runs" />
        <StatTile label="Success rate" value={pct(pulse?.success ?? null)} meta="EPA > 0" />
        <StatTile label="Explosive rate" value={pct(pulse?.explosive_rate ?? null)} meta="20+ pass / 10+ rush" />
        <StatTile label="Pass rate" value={pct(pulse?.pass_rate ?? null)} meta="of scrimmage plays" />
        <StatTile
          label={offseason ? "Next kickoff" : "Week"}
          value={offseason ? `Wk 1` : String(manifest.season_state.current_week)}
          meta={offseason ? gameDate(upcoming[0]?.gameday) : `${manifest.scheduled_season} season`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] mt-7">
        <div>
          <SectionRule aside="opponent-adjusted EPA per play">Efficiency leaders</SectionRule>
          <Panel>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Rec</th>
                    <th>Off</th>
                    <th>Def</th>
                    <th>Net</th>
                    <th className="w-[90px]">Margin</th>
                    <th>Pts/Dr</th>
                  </tr>
                </thead>
                <tbody>
                  {topTeams.map((t) => {
                    const rec = standings.find((s) => s.team === t.team);
                    const meta = teams[t.team];
                    return (
                      <tr key={t.team}>
                        <td>
                          <TeamMark
                            team={t.team}
                            logo={meta?.logo}
                            href={`/teams/${t.team}`}
                            name={meta?.nick ?? t.team}
                          />
                        </td>
                        <td className="num text-ink-2">
                          {rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ""}` : "—"}
                        </td>
                        <td>
                          <RankChip rank={t.off_rank} />
                        </td>
                        <td>
                          <RankChip rank={t.def_rank} />
                        </td>
                        <td className="num font-semibold">{signed(t.net_adj)}</td>
                        <td>
                          <DivergingBar value={t.net_adj} max={0.25} />
                        </td>
                        <td className="num text-ink-2">
                          {num(t.off_points_per_drive as number, 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div>
          <SectionRule aside="min. 150 dropbacks">Quarterback value</SectionRule>
          <Panel>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>DB</th>
                    <th>EPA/DB</th>
                    <th>CPOE</th>
                  </tr>
                </thead>
                <tbody>
                  {qbLeaders.map((p) => (
                    <tr key={String(p.player_id)}>
                      <td>
                        <Link href={`/players/${p.player_id}`} className="link-cell flex items-center gap-2">
                          <TeamMark
                            team={String(p.recent_team)}
                            logo={teams[String(p.recent_team)]?.logo}
                            size={17}
                            showAbbr={false}
                          />
                          <span className="font-medium">{String(p.player_display_name)}</span>
                        </Link>
                      </td>
                      <td className="num text-ink-2">{int(p.dropbacks as number)}</td>
                      <td className="num font-semibold">{signed(p.epa_per_db as number)}</td>
                      <td className="num text-ink-2">{pts(p.cpoe as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {offseason && upcoming.length > 0 && (
        <>
          <SectionRule aside={`${manifest.scheduled_season} season opens`}>Week 1</SectionRule>
          <Panel>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Away</th>
                    <th>Home</th>
                    <th>Line</th>
                    <th>Total</th>
                    <th>Stadium</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((g) => (
                    <tr key={g.game_id}>
                      <td className="text-ink-2">{gameDate(g.gameday)}</td>
                      <td>
                        <TeamMark team={g.away_team} logo={teams[g.away_team]?.logo} href={`/teams/${g.away_team}`} />
                      </td>
                      <td>
                        <TeamMark team={g.home_team} logo={teams[g.home_team]?.logo} href={`/teams/${g.home_team}`} />
                      </td>
                      <td className="num text-ink-2">
                        {line(g.spread_line)}
                      </td>
                      <td className="num text-ink-2">{g.total_line ?? "—"}</td>
                      <td className="text-ink-3 text-[12px]">{g.stadium}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
