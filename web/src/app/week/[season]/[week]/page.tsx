import Link from "next/link";
import { notFound } from "next/navigation";
import { Deck, Empty, Panel, PageHead, TeamMark } from "@/components/ui";
import {
  getPlayedWeeks,
  getTeamMap,
  getWeekBigPlays,
  getWeekFourthMisses,
  getWeekPlayers,
  getWeekTeamSwings,
  getWeekUpsets,
} from "@/lib/queries";
import { num, signed } from "@/lib/format";

export const revalidate = 900;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
  return { title: `Week ${week}, ${season}` };
}

/** Playoff rounds carry week numbers that mean nothing to a reader. */
function weekLabel(week: number): string {
  const rounds: Record<number, string> = {
    19: "Wild Card", 20: "Divisional", 21: "Conference Championship", 22: "Super Bowl",
  };
  return rounds[week] ?? `Week ${week}`;
}

export default async function WeekPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const p = await params;
  const season = Number(p.season);
  const week = Number(p.week);
  if (!Number.isFinite(season) || !Number.isFinite(week)) notFound();

  const weeks = await getPlayedWeeks();
  if (!weeks.some((w) => w.season === season && w.week === week)) notFound();

  const [plays, swings, misses, upsets, players, teams] = await Promise.all([
    getWeekBigPlays(season, week, 10),
    getWeekTeamSwings(season, week),
    getWeekFourthMisses(season, week, 8),
    getWeekUpsets(season, week, 6),
    getWeekPlayers(season, week, 10),
    getTeamMap(season),
  ]);

  const idx = weeks.findIndex((w) => w.season === season && w.week === week);
  const newer = idx > 0 ? weeks[idx - 1] : null;
  const older = idx >= 0 && idx < weeks.length - 1 ? weeks[idx + 1] : null;

  const best = swings.slice(0, 5);
  const worst = swings.slice(Math.max(best.length, swings.length - 5)).reverse();

  return (
    <>
      <PageHead
        aside={
          <span className="flex gap-3">
            {older && (
              <Link href={`/week/${older.season}/${older.week}`} className="text-accent">
                ← {weekLabel(older.week)}
              </Link>
            )}
            {newer && (
              <Link href={`/week/${newer.season}/${newer.week}`} className="text-accent">
                {weekLabel(newer.week)} →
              </Link>
            )}
          </span>
        }
      >
        {weekLabel(week)} · {season}
      </PageHead>

      <Deck>
        What actually moved — the biggest swings, the worst decisions, and the results the market
        did not see coming.
      </Deck>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title="Biggest plays">
          {plays.length === 0 ? (
            <Empty>No play-by-play stored for this week.</Empty>
          ) : (
            <div className="scroll-x max-h-[420px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Q</th>
                    <th className="l">Tm</th>
                    <th className="l">Play</th>
                    <th>WPA</th>
                  </tr>
                </thead>
                <tbody>
                  {plays.map((pl) => (
                    <tr key={`${pl.game_id}-${pl.play_id}`}>
                      <td className="num text-ink-3">{pl.qtr}</td>
                      <td className="l">
                        <TeamMark
                          team={pl.posteam}
                          logo={teams[pl.posteam]?.logo}
                          size={16}
                          showAbbr={false}
                        />
                      </td>
                      <td
                        className="l text-[11.5px] text-ink-2 max-w-[360px] truncate"
                        title={pl.desc}
                      >
                        <Link href={`/games/${pl.game_id}`} className="link-cell">
                          {pl.desc}
                        </Link>
                      </td>
                      <td
                        className="num font-semibold"
                        style={{ color: pl.wpa >= 0 ? "var(--pos)" : "var(--neg)" }}
                      >
                        {signed(pl.wpa, 3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Best individual weeks">
          {players.length === 0 ? (
            <Empty>No weekly player data.</Empty>
          ) : (
            <div className="scroll-x max-h-[420px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Player</th>
                    <th className="l">Pos</th>
                    <th className="l">Tm</th>
                    <th>PPR</th>
                    <th title="Only populated for passers in the weekly table">WPA</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((pl) => (
                    <tr key={pl.player_id}>
                      <td className="l">
                        <Link href={`/players/${pl.player_id}`} className="link-cell font-medium">
                          {pl.player_display_name}
                        </Link>
                      </td>
                      <td className="l text-ink-3 text-[11.5px]">{pl.position}</td>
                      <td className="l">
                        <TeamMark
                          team={pl.team}
                          logo={teams[pl.team]?.logo}
                          size={16}
                          showAbbr={false}
                        />
                      </td>
                      <td className="num font-semibold">{num(pl.fantasy_points_ppr, 1)}</td>
                      <td className="num text-ink-2">
                        {pl.wpa === null ? "—" : signed(pl.wpa, 3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start mt-4">
        <Panel
          title="Who played above and below themselves"
        >
          {swings.length === 0 ? (
            <Empty>No plays stored for this week.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    <th>Plays</th>
                    <th>This week</th>
                    <th>Season</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {[...best, ...worst].map((t, i) => (
                    <tr
                      key={t.team}
                      style={
                        i === best.length
                          ? { borderTop: "2px solid var(--rule-strong)" }
                          : undefined
                      }
                    >
                      <td className="l">
                        <TeamMark
                          team={t.team}
                          logo={teams[t.team]?.logo}
                          href={`/teams/${t.team}`}
                          name={teams[t.team]?.nick ?? t.team}
                        />
                      </td>
                      <td className="num text-ink-3">{t.plays}</td>
                      <td className="num text-ink-2">{signed(t.epa)}</td>
                      <td className="num text-ink-3">{signed(t.season_epa)}</td>
                      <td
                        className="num font-semibold"
                        style={{ color: t.delta >= 0 ? "var(--pos)" : "var(--neg)" }}
                      >
                        {signed(t.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            title="Costliest fourth downs"
          >
            {misses.length === 0 ? (
              <Empty>Every fourth down this week matched the model.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="l">Tm</th>
                      <th className="l">Situation</th>
                      <th className="l">Chose</th>
                      <th className="l">Model</th>
                      <th>WP lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {misses.map((m, i) => (
                      <tr key={`${m.game_id}-${i}`}>
                        <td className="l">
                          <TeamMark
                            team={m.posteam}
                            logo={teams[m.posteam]?.logo}
                            size={16}
                            showAbbr={false}
                          />
                        </td>
                        <td className="l text-[11.5px] text-ink-2">
                          Q{m.qtr} · 4th &amp; {m.ydstogo} ·{" "}
                          {m.yardline_100 > 50
                            ? `own ${100 - m.yardline_100}`
                            : `opp ${m.yardline_100}`}
                        </td>
                        <td className="l text-[11.5px]">{m.choice?.toLowerCase()}</td>
                        <td className="l text-[11.5px] text-ink-2">{m.best?.toLowerCase()}</td>
                        <td className="num font-semibold" style={{ color: "var(--neg)" }}>
                          {num(m.wp_lost, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {upsets.length > 0 && (
            <Panel title="What the market missed">
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="l">Game</th>
                      <th>Line</th>
                      <th>Result</th>
                      <th>Miss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upsets.map((g) => (
                      <tr key={g.game_id}>
                        <td className="l text-[11.5px]">
                          <Link href={`/games/${g.game_id}`} className="link-cell">
                            {g.away_team} {g.away_score} — {g.home_score} {g.home_team}
                          </Link>
                        </td>
                        <td className="num text-ink-2">{signed(g.spread_line, 1)}</td>
                        <td className="num text-ink-2">{signed(g.margin, 0)}</td>
                        <td className="num font-semibold">{signed(g.market_err, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      </div>

    </>
  );
}
