import Link from "next/link";
import { ChartExport } from "@/components/ChartExport";
import { DriveChart, GameWinProbability } from "@/components/GameWinProbability";
import { Highlights } from "@/components/Highlights";
import { Empty, Panel, SectionRule, TeamMark } from "@/components/ui";
import {
  getGameBoxScore,
  getGameDrives,
  getGameFourthDowns,
  getGameTeamSummary,
  getGameTopPlays,
  getGameWinProbability,
  getTeamMap,
  type Game,
} from "@/lib/queries";
import { gameDate, int, num, pct, signed, line } from "@/lib/format";
import { distinguishTeamColors } from "@/lib/colors";

export async function CompletedGame({ game }: { game: Game }) {
  const teams = await getTeamMap();
  const [wp, drives, topPlays, fourths, summary, box] = await Promise.all([
    getGameWinProbability(game.season, game.game_id),
    getGameDrives(game.season, game.game_id),
    getGameTopPlays(game.season, game.game_id, 10),
    getGameFourthDowns(game.game_id),
    getGameTeamSummary(game.season, game.game_id),
    getGameBoxScore(game.season, game.game_id),
  ]);

  const { home: homeColor, away: awayColor } = distinguishTeamColors(
    teams[game.home_team] ?? {},
    teams[game.away_team] ?? {}
  );
  const teamColors = { [game.home_team]: homeColor, [game.away_team]: awayColor };

  const homeWon = game.winner === game.home_team;
  const statFor = (t: string) => summary.find((s) => s.team === t);
  const away = statFor(game.away_team);
  const home = statFor(game.home_team);

  const COMPARE: [string, (s: typeof away) => string][] = [
    ["EPA per play", (s) => signed(s?.epa ?? null)],
    ["Success rate", (s) => pct(s?.success ?? null, 0)],
    ["Pass EPA", (s) => signed(s?.pass_epa ?? null)],
    ["Rush EPA", (s) => signed(s?.rush_epa ?? null)],
    ["Explosive rate", (s) => pct(s?.explosive ?? null, 0)],
    ["Third down", (s) => pct(s?.third_conv ?? null, 0)],
    ["Dropbacks", (s) => int(s?.dropbacks ?? null)],
    ["Sacks allowed", (s) => int(s?.sacks ?? null)],
    ["Plays", (s) => int(s?.plays ?? null)],
  ];

  return (
    <>
      <SectionRule aside={<Link href="/scores" className="text-accent">All scores</Link>}>
        {teams[game.away_team]?.name ?? game.away_team} at {teams[game.home_team]?.name ?? game.home_team}
      </SectionRule>

      {/* ------------------------------------------------------- header */}
      <div className="panel overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-2 border-b border-rule bg-panel-2 text-[11px]">
          <span className="label">
            {game.game_type === "REG" ? `Week ${game.week}` : game.game_type} · {game.season}
          </span>
          <span className="text-ink-3">
            {[gameDate(game.gameday), game.stadium, game.roof].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 px-3 sm:px-5 py-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <TeamMark team={game.away_team} logo={teams[game.away_team]?.logo} size={38} showAbbr={false} href={`/teams/${game.away_team}`} />
            <div>
              <div className={`font-semibold text-[14px] ${homeWon ? "text-ink-3" : ""}`}>
                <span className="hidden sm:inline">{teams[game.away_team]?.nick ?? game.away_team}</span>
                <span className="sm:hidden">{game.away_team}</span>
              </div>
              <div className="text-[11px] text-ink-3 truncate">{game.away_qb_name}</div>
            </div>
          </div>
          <div className="text-center">
            <div className="num text-[28px] sm:text-[34px] font-semibold leading-none whitespace-nowrap">
              <span className={homeWon ? "text-ink-3" : ""}>{game.away_score}</span>
              <span className="text-ink-3 mx-1.5 sm:mx-2">–</span>
              <span className={homeWon ? "" : "text-ink-3"}>{game.home_score}</span>
            </div>
            <div className="text-[11px] text-ink-3 mt-1">
              Final{game.overtime ? " / OT" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-row-reverse text-right min-w-0">
            <TeamMark team={game.home_team} logo={teams[game.home_team]?.logo} size={38} showAbbr={false} href={`/teams/${game.home_team}`} />
            <div>
              <div className={`font-semibold text-[14px] ${homeWon ? "" : "text-ink-3"}`}>
                <span className="hidden sm:inline">{teams[game.home_team]?.nick ?? game.home_team}</span>
                <span className="sm:hidden">{game.home_team}</span>
              </div>
              <div className="text-[11px] text-ink-3 truncate">{game.home_qb_name}</div>
            </div>
          </div>
        </div>
        {game.spread_line !== null && (
          <div className="px-4 py-2 border-t border-rule bg-panel-2 text-[11px] text-ink-3 num text-center">
            {game.home_team} {line(game.spread_line)} · total {game.total_line}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] items-start">
        <div className="flex flex-col gap-4">
          <Highlights eventId={game.espn} />

          <Panel title="Win probability" meta={`${wp.length} plays · Hashmark model`}>
            {wp.length > 1 ? (
              <div className="pt-3">
                <ChartExport
                  filename={`wp-${game.game_id}`}
                  caption={`${game.away_team} ${game.away_score}–${game.home_score} ${game.home_team} · week ${game.week}, ${game.season}`}
                >
                <GameWinProbability
                  points={wp}
                  homeAbbr={game.home_team}
                  awayAbbr={game.away_team}
                  homeColor={homeColor}
                  awayColor={awayColor}
                  fourthDowns={fourths.map((f) => ({
                    clock: Number(f.game_seconds_remaining ?? 0),
                    optimal: Boolean(f.optimal),
                  }))}
                />
                </ChartExport>
              </div>
            ) : (
              <Empty>No play-by-play stored for this game.</Empty>
            )}
          </Panel>

          <Panel title="Drives" meta="bar is EPA produced" bodyClass="max-h-[420px] scroll-y">
            {drives.length ? (
              <DriveChart drives={drives} teamColors={teamColors} />
            ) : (
              <Empty>No drive data.</Empty>
            )}
          </Panel>

          <Panel title="Biggest plays" meta="by win probability added">
            <div className="scroll-x max-h-[360px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Q</th>
                    <th>Tm</th>
                    <th className="l">Play</th>
                    <th>EPA</th>
                    <th>WPA</th>
                  </tr>
                </thead>
                <tbody>
                  {topPlays.map((p) => (
                    <tr key={p.play_id}>
                      <td className="num text-ink-3">{p.qtr}</td>
                      <td>
                        <TeamMark team={p.posteam} logo={teams[p.posteam]?.logo} size={16} showAbbr={false} />
                      </td>
                      <td className="l text-[11.5px] text-ink-2 max-w-[380px] truncate" title={p.desc}>
                        {p.desc}
                      </td>
                      <td className="num" style={{ color: p.epa >= 0 ? "var(--pos)" : "var(--neg)" }}>
                        {signed(p.epa, 1)}
                      </td>
                      <td className="num font-semibold">{signed(p.wpa, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {fourths.length > 0 && (
            <Panel title="Fourth downs" meta="scored against the decision model">
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Q</th>
                      <th>Tm</th>
                      <th className="l">Situation</th>
                      <th className="l">Call</th>
                      <th className="l">Model</th>
                      <th>WP lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fourths.map((f, i) => (
                      <tr key={i}>
                        <td className="num text-ink-3">{String(f.qtr)}</td>
                        <td>
                          <TeamMark team={String(f.posteam)} logo={teams[String(f.posteam)]?.logo} size={16} showAbbr={false} />
                        </td>
                        <td className="l text-[11.5px] text-ink-2">
                          4th &amp; {String(f.ydstogo)} ·{" "}
                          {Number(f.yardline_100) > 50 ? `own ${100 - Number(f.yardline_100)}` : `opp ${f.yardline_100}`}
                        </td>
                        <td className="l text-[11.5px] num text-ink-2">{String(f.choice)}</td>
                        <td className="l text-[11.5px] num font-semibold">{String(f.best)}</td>
                        <td className="num" style={{ color: f.optimal ? "var(--ink-3)" : "var(--neg)" }}>
                          {f.optimal ? "—" : num(Number(f.wp_lost), 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Team comparison" meta="computed from the plays">
            <div className="px-4 py-2">
              {COMPARE.map(([label, fn]) => (
                <div key={label} className="flex items-center justify-between py-[7px] border-b border-rule last:border-0 text-[12.5px]">
                  <b className="num w-[64px]">{fn(away)}</b>
                  <span className="text-ink-3 text-[11px]">{label}</span>
                  <b className="num w-[64px] text-right">{fn(home)}</b>
                </div>
              ))}
              <div className="flex justify-between text-[11px] text-ink-3 pt-2">
                <span>{game.away_team}</span>
                <span>{game.home_team}</span>
              </div>
            </div>
          </Panel>

          <Panel title="Box score" meta="EPA included">
            <div className="scroll-x max-h-[560px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Tm</th>
                    <th>Yds</th>
                    <th>TD</th>
                    <th>EPA</th>
                  </tr>
                </thead>
                <tbody>
                  {box.slice(0, 26).map((b) => {
                    const yards =
                      Number(b.passing_yards ?? 0) + Number(b.rushing_yards ?? 0) + Number(b.receiving_yards ?? 0);
                    const tds =
                      Number(b.passing_tds ?? 0) + Number(b.rushing_tds ?? 0) + Number(b.receiving_tds ?? 0);
                    const epa =
                      Number(b.passing_epa ?? 0) + Number(b.rushing_epa ?? 0) + Number(b.receiving_epa ?? 0);
                    return (
                      <tr key={String(b.player_id)}>
                        <td>
                          <Link href={`/players/${b.player_id}`} className="link-cell">
                            {String(b.player_display_name)}{" "}
                            <span className="text-ink-3 text-[10.5px]">{String(b.position ?? "")}</span>
                          </Link>
                        </td>
                        <td>
                          <TeamMark team={String(b.team)} logo={teams[String(b.team)]?.logo} size={15} showAbbr={false} />
                        </td>
                        <td className="num text-ink-2">{int(yards)}</td>
                        <td className="num text-ink-2">{tds || "—"}</td>
                        <td className="num font-semibold" style={{ color: epa >= 0 ? "var(--pos)" : "var(--neg)" }}>
                          {signed(epa, 1)}
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
