import Link from "next/link";
import { notFound } from "next/navigation";
import { FormationPanels } from "@/components/FormationPanels";
import { SeasonNav } from "@/components/SeasonNav";
import { LineChart } from "@/components/LineChart";
import { Panel, RankChip, SectionRule, StatTile, TeamMark, Empty } from "@/components/ui";
import {
  getGames,
  getManifest,
  getStandings,
  getTeam,
  getTeamMap,
  getTeamRoster,
  getTeamSeason,
  getTeamWeeklyEpa,
  getTeams,
  getFormationSplits,
  getParticipationTeam,
  getBuiltSeasons,
  getTeamHistory,
} from "@/lib/queries";
import { gameDate, int, num, ordinal, pct, pts, signed, line } from "@/lib/format";

export const revalidate = 300;

export async function generateStaticParams() {
  const teams = await getTeams();
  return teams.map((t) => ({ team: t.team }));
}

export async function generateMetadata({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  const meta = await getTeam(team);
  return { title: meta?.name ?? team.toUpperCase() };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { team: abbr } = await params;
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const season = Number(sp.season ?? manifest.stats_season);

  const meta = await getTeam(abbr);
  if (!meta) notFound();

  const [eff, standings, weekly, roster, games, teamMap, splits, participation] =
    await Promise.all([
      getTeamSeason(meta.team, season),
      getStandings(season),
      getTeamWeeklyEpa(season, meta.team),
      getTeamRoster(meta.team, season),
      getGames(season),
      getTeamMap(),
      getFormationSplits(season, meta.team),
      getParticipationTeam(season, meta.team),
    ]);

  const history = await getTeamHistory(meta.team);

  const record = standings.find((s) => s.team === meta.team);
  const teamGames = games.filter((g) => g.home_team === meta.team || g.away_team === meta.team);

  const labels = weekly.map((w) => `W${w.week}`);
  const offense = weekly.map((w) => w.off_epa);
  const defense = weekly.map((w) => w.def_epa);

  const skill = roster.filter((p) =>
    ["QB", "RB", "WR", "TE"].includes(String(p.position))
  );
  const defenders = roster.filter((p) => Number(p.def_snaps ?? 0) > 100);

  return (
    <>
      <div className="panel overflow-hidden mb-4">
        <div className="h-1" style={{ background: meta.color }} />
        <div className="px-4 py-3.5 flex items-center gap-4 flex-wrap">
          {meta.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.logo} alt="" width={46} height={46} />
          )}
          <div className="min-w-[180px]">
            <h1 className="headline text-[24px] leading-none">{meta.name}</h1>
            <div className="text-[12.5px] text-ink-2 mt-1">
              {record ? `${record.w}-${record.l}${record.t ? `-${record.t}` : ""}` : "—"} ·{" "}
              {ordinal(record?.div_place)} in the {meta.division} ·{" "}
              {teamGames[0]?.home_team === meta.team
                ? teamGames[0]?.home_coach
                : teamGames[0]?.away_coach}
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex gap-6">
            <div>
              <div className="label">Net rating</div>
              <div className="num text-[21px] font-semibold">{signed(eff?.net_adj)}</div>
            </div>
            <div>
              <div className="label">Off</div>
              <div className="num text-[21px] font-semibold">#{eff?.off_rank ?? "—"}</div>
            </div>
            <div>
              <div className="label">Def</div>
              <div className="num text-[21px] font-semibold">#{eff?.def_rank ?? "—"}</div>
            </div>
          </div>
        </div>
      </div>

      <SeasonNav
        seasons={seasons}
        active={season}
        href={(s) => `/teams/${meta.team}?season=${s}`}
      />

      {eff ? (
        <>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            <StatTile
              label="Off EPA / play"
              value={signed(eff.off_adj)}
              meta={<><RankChip rank={eff.off_rank} /> opponent-adjusted</>}
            />
            <StatTile
              label="Def EPA / play"
              value={signed(eff.def_adj)}
              meta={<><RankChip rank={eff.def_rank} /> lower is better</>}
            />
            <StatTile label="Success rate" value={pct(eff.off_success as number)} meta="offense" />
            <StatTile label="Points / drive" value={num(eff.off_points_per_drive as number, 2)} meta={<><RankChip rank={eff.off_ppd_rank as number} /> offense</>} />
            <StatTile label="PROE" value={pts(eff.neutral_proe as number)} meta="neutral early downs" />
            <StatTile label="Explosive rate" value={pct(eff.off_explosive_rate as number)} meta="20+ pass / 10+ rush" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] mt-7">
            <div>
              <SectionRule aside="EPA per play, by week">Season shape</SectionRule>
              <Panel bodyClass="p-3">
                {labels.length > 0 ? (
                  <>
                    <LineChart
                      labels={labels}
                      series={[
                        { name: "Offense", color: "var(--c1)", values: offense, fill: true },
                        { name: "Defense allowed", color: "var(--c2)", values: defense },
                      ]}
                      height={230}
                      format={(v) => v.toFixed(2)}
                    />
                    <div className="flex gap-4 text-[12px] text-ink-2 mt-2 px-1">
                      <span className="flex items-center gap-1.5">
                        <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: "var(--c1)" }} />
                        Offense
                      </span>
                      <span className="flex items-center gap-1.5">
                        <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: "var(--c2)" }} />
                        Defense allowed
                      </span>
                    </div>
                  </>
                ) : (
                  <Empty>No play-by-play for this season yet.</Empty>
                )}
              </Panel>
            </div>

            <div>
              <SectionRule aside="vs league average">Splits</SectionRule>
              <Panel bodyClass="px-4 py-2">
                {[
                  ["Pass offense", eff.off_pass_epa, eff.off_pass_rank],
                  ["Rush offense", eff.off_rush_epa, eff.off_rush_rank],
                  ["Pass defense", eff.def_pass_epa, eff.def_pass_rank],
                  ["Rush defense", eff.def_rush_epa, eff.def_rush_rank],
                  ["Early downs", eff.off_early_epa, null],
                  ["Third down", eff.off_third_epa, null],
                  ["Red zone", eff.off_rz_epa, null],
                ].map(([label, value, rank]) => (
                  <div
                    key={String(label)}
                    className="flex items-center justify-between py-[7px] border-b border-rule last:border-0 text-[12.5px]"
                  >
                    <span className="text-ink-2">{String(label)}</span>
                    <span className="flex items-center gap-2.5">
                      {rank ? <RankChip rank={rank as number} /> : null}
                      <b className="num">{signed(value as number)}</b>
                    </span>
                  </div>
                ))}
              </Panel>

              <Panel title="Tendencies" className="mt-4" bodyClass="px-4 py-2">
                {[
                  ["Neutral pass rate", pct(eff.neutral_pass_rate as number)],
                  ["Shotgun", pct(eff.shotgun_rate as number)],
                  ["No huddle", pct(eff.no_huddle_rate as number)],
                  ["Sack rate allowed", pct(eff.off_sack_rate as number)],
                  ["Three-and-out rate", pct(eff.off_three_out_rate as number)],
                  ["Red zone TD rate", pct(eff.off_rz_td_rate as number)],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="flex items-center justify-between py-[7px] border-b border-rule last:border-0 text-[12.5px]"
                  >
                    <span className="text-ink-2">{String(label)}</span>
                    <b className="num">{String(value)}</b>
                  </div>
                ))}
              </Panel>
            </div>
          </div>
        </>
      ) : (
        <Empty>No efficiency data built for {season}.</Empty>
      )}

      <SectionRule aside="charted participation data">Formations &amp; matchups</SectionRule>
      <FormationPanels
        splits={splits}
        participation={participation[0]}
        season={season}
      />

      {history.length > 1 && (
        <>
          <SectionRule aside={`${history[history.length - 1].season}–${history[0].season}`}>
            Franchise history
          </SectionRule>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] items-start mb-2">
            <Panel title="Net rating by season" meta="opponent-adjusted EPA per play">
              <div className="p-3">
                <LineChart
                  labels={[...history].reverse().map((h) => `'${String(h.season).slice(2)}`)}
                  series={[
                    {
                      name: "Net rating",
                      color: "var(--c1)",
                      values: [...history].reverse().map((h) => h.net_adj),
                      fill: true,
                    },
                  ]}
                  height={210}
                  format={(v) => v.toFixed(2)}
                />
              </div>
            </Panel>
            <Panel title="Season by season" meta="click a year to load it">
              <div className="scroll-x max-h-[300px] scroll-y">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Yr</th>
                      <th>Rec</th>
                      <th>Off</th>
                      <th>Def</th>
                      <th>Net</th>
                      <th>Seed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.season}>
                        <td>
                          <Link
                            href={`/teams/${meta.team}?season=${h.season}`}
                            className={`link-cell num ${h.season === season ? "font-semibold" : ""}`}
                          >
                            {h.season}
                          </Link>
                        </td>
                        <td className="num text-ink-2">
                          {h.w !== null ? `${h.w}-${h.l}${h.t ? `-${h.t}` : ""}` : "—"}
                        </td>
                        <td>
                          <RankChip rank={h.off_rank} />
                        </td>
                        <td>
                          <RankChip rank={h.def_rank} />
                        </td>
                        <td className="num font-semibold">{signed(h.net_adj)}</td>
                        <td className="num text-ink-3">
                          {h.in_playoffs ? h.seed : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}

      <SectionRule aside={`${season} · by snaps`}>Skill players</SectionRule>
      <Panel>
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th>G</th>
                <th>Snaps</th>
                <th>Snap%</th>
                <th>Pass yds</th>
                <th>Rush yds</th>
                <th>Rec</th>
                <th>Rec yds</th>
                <th>Total EPA</th>
              </tr>
            </thead>
            <tbody>
              {skill.slice(0, 16).map((p) => (
                <tr key={String(p.player_id)}>
                  <td className="l">
                    <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                      {String(p.player_display_name)}
                    </Link>
                  </td>
                  <td className="l text-ink-3 text-[11.5px]">{String(p.position)}</td>
                  <td className="num text-ink-2">{int(p.games as number)}</td>
                  <td className="num text-ink-2">
                    {p.off_snaps === null || p.off_snaps === undefined
                      ? "—"
                      : int(p.off_snaps as number)}
                  </td>
                  <td className="num text-ink-3">
                    {p.off_snap_pct === null || p.off_snap_pct === undefined
                      ? "—"
                      : `${num((p.off_snap_pct as number) * 100, 0)}%`}
                  </td>
                  <td className="num text-ink-2">{int(p.passing_yards as number)}</td>
                  <td className="num text-ink-2">{int(p.rushing_yards as number)}</td>
                  <td className="num text-ink-2">{int(p.receptions as number)}</td>
                  <td className="num text-ink-2">{int(p.receiving_yards as number)}</td>
                  <td className="num font-semibold">{signed(p.total_epa as number, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 mt-7">
        <div>
          <SectionRule aside="100+ defensive snaps">Defense</SectionRule>
          <Panel>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>Snaps</th>
                    <th>Sacks</th>
                    <th>INT</th>
                    <th>Solo</th>
                  </tr>
                </thead>
                <tbody>
                  {defenders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="l text-[12px] text-ink-3 py-6 text-center">
                        Snap counts begin in 2012, so defensive playing time cannot be listed for
                        this season.
                      </td>
                    </tr>
                  )}
                  {defenders.slice(0, 14).map((p) => (
                    <tr key={String(p.player_id)}>
                      <td>
                        <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                          {String(p.player_display_name)}
                        </Link>
                      </td>
                      <td className="text-ink-3 text-[11.5px]">{String(p.position)}</td>
                      <td className="num text-ink-2">{int(p.def_snaps as number)}</td>
                      <td className="num">{num(p.def_sacks as number, 1)}</td>
                      <td className="num text-ink-2">{int(p.def_interceptions as number)}</td>
                      <td className="num text-ink-2">{int(p.def_tackles_solo as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div>
          <SectionRule aside={`${season} results`}>Schedule</SectionRule>
          <Panel>
            <div className="scroll-x max-h-[520px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Wk</th>
                    <th className="l">Opponent</th>
                    <th>Result</th>
                    <th>Score</th>
                    <th>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {teamGames.map((g) => {
                    const home = g.home_team === meta.team;
                    const opp = home ? g.away_team : g.home_team;
                    const us = home ? g.home_score : g.away_score;
                    const them = home ? g.away_score : g.home_score;
                    const won = g.winner === meta.team;
                    return (
                      <tr key={g.game_id}>
                        <td className="num text-ink-3">{g.week}</td>
                        <td className="l">
                          <span className="flex items-center gap-1.5">
                            <span className="text-ink-3 text-[11px] w-[10px]">{home ? "" : "@"}</span>
                            <TeamMark team={opp} logo={teamMap[opp]?.logo} href={`/teams/${opp}`} size={17} />
                          </span>
                        </td>
                        <td>
                          {!g.played ? (
                            <span className="text-ink-3 text-[12px]">{gameDate(g.gameday)}</span>
                          ) : (
                            <span className={won ? "text-pos font-semibold" : "text-neg font-semibold"}>
                              {g.winner === "TIE" ? "T" : won ? "W" : "L"}
                            </span>
                          )}
                        </td>
                        <td className="num text-ink-2">
                          {g.played ? `${us}–${them}` : "—"}
                        </td>
                        <td className="num text-ink-3">
                          {line(g.spread_line, home)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
