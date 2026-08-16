import Link from "next/link";
import { Empty, SectionRule, TeamMark } from "@/components/ui";
import { SeasonNav } from "@/components/SeasonNav";
import { getGames, getManifest, getTeamMap, getWeekPreviews, getWeeks } from "@/lib/queries";
import { gameDate, line } from "@/lib/format";

export const metadata = { title: "Scores" };
export const revalidate = 120;

export default async function ScoresPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; week?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const season = Number(sp.season ?? manifest.stats_season);

  const weeks = await getWeeks(season);
  // In season: the week still being played. Finished season: the last full
  // slate, since landing on a one-game Super Bowl week reads as an empty page.
  const unplayed = weeks.find((w) => w.played < w.total);
  const lastRegular = [...weeks].reverse().find((w) => w.game_type === "REG");
  const defaultWeek = unplayed?.week ?? lastRegular?.week ?? weeks.at(-1)?.week ?? 1;
  const week = Number(sp.week ?? defaultWeek);

  const [games, teams, previews] = await Promise.all([
    getGames(season, week),
    getTeamMap(),
    getWeekPreviews(season, week),
  ]);
  const projection = Object.fromEntries(previews.map((p) => [p.game_id, p]));

  // The scheduled season has a fixture list but no play-by-play, so it is absent
  // from the built-seasons list and would otherwise be unreachable from the nav.
  const built = manifest.seasons.slice().reverse();
  const seasons = built.includes(manifest.scheduled_season)
    ? built
    : [manifest.scheduled_season, ...built];

  return (
    <>
      <SectionRule aside={`${games.length} ${games.length === 1 ? "game" : "games"}`}>Scores</SectionRule>

      <SeasonNav
        seasons={seasons}
        active={season}
        href={(s) => `/scores?season=${s}&week=1`}
      />

      <div className="flex gap-4 flex-wrap items-center mb-4">
        <div className="flex gap-1 items-center flex-wrap max-w-full">
          <span className="label">Week</span>
          {weeks.map((w) => (
            <Link
              key={w.week}
              href={`/scores?season=${season}&week=${w.week}`}
              className={`num px-2 py-1 rounded-[3px] border text-[12px] no-underline shrink-0 ${
                w.week === week
                  ? "bg-navy border-navy text-white"
                  : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
              }`}
              title={w.game_type === "REG" ? `Week ${w.week}` : w.game_type}
            >
              {w.game_type === "REG" ? w.week : w.game_type}
            </Link>
          ))}
        </div>
      </div>

      {games.length === 0 ? (
        <Empty>Nothing scheduled for this week.</Empty>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {games.map((g) => {
            const homeWon = g.winner === g.home_team;
            const awayWon = g.winner === g.away_team;
            const proj = g.played ? null : projection[g.game_id];
            return (
              <Link
                key={g.game_id}
                href={`/games/${g.played ? g.game_id : (g.espn ?? g.game_id)}`}
                className="panel no-underline hover:border-rule-strong transition-colors block overflow-hidden"
              >
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-rule text-[11px]">
                  <span className="text-ink-3">{gameDate(g.gameday)}</span>
                  <span className="text-ink-3">
                    {g.played ? "Final" : proj ? "Projected" : (g.gametime ?? "").slice(0, 5)}
                  </span>
                </div>

                {[
                  {
                    t: g.away_team, s: g.away_score, won: awayWon, qb: g.away_qb_name,
                    proj: proj?.proj_away_score, wp: proj ? 1 - proj.home_wp : null,
                  },
                  {
                    t: g.home_team, s: g.home_score, won: homeWon, qb: g.home_qb_name,
                    proj: proj?.proj_home_score, wp: proj?.home_wp ?? null,
                  },
                ].map((side) => (
                  <div key={side.t} className="flex items-center gap-2.5 px-3.5 py-2">
                    <TeamMark
                      team={side.t}
                      logo={teams[side.t]?.logo}
                      name={teams[side.t]?.nick ?? side.t}
                    />
                    <span className="flex-1" />
                    <span className="text-[11px] text-ink-3 truncate max-w-[92px]">{side.qb}</span>
                    {side.wp !== null && side.wp !== undefined && (
                      <span className="num text-[11px] text-ink-3 w-[30px] text-right shrink-0">
                        {Math.round(side.wp * 100)}%
                      </span>
                    )}
                    <span
                      className={`num text-[19px] w-[32px] text-right ${
                        side.s !== null && side.s !== undefined
                          ? side.won
                            ? "font-semibold text-ink"
                            : "text-ink-2"
                          : "text-ink-3"
                      }`}
                    >
                      {side.s ?? (side.proj !== undefined ? side.proj.toFixed(0) : "—")}
                    </span>
                  </div>
                ))}

                <div className="px-3.5 py-2 border-t border-rule bg-panel-2 flex items-center justify-between text-[11px] text-ink-3">
                  <span className="truncate">{g.stadium}</span>
                  <span className="num shrink-0">
                    {g.spread_line !== null && `${g.home_team} ${line(g.spread_line)}`}
                    {g.total_line !== null && ` · O/U ${g.total_line}`}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
