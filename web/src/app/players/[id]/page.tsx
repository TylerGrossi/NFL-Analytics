import Link from "next/link";
import { notFound } from "next/navigation";
import { AgingCurve } from "@/components/AgingCurve";
import { ChartExport } from "@/components/ChartExport";
import { LineChart } from "@/components/LineChart";
import { Empty, Panel, PercentileBar, SectionRule, StatTile, TeamMark } from "@/components/ui";
import {
  getAgingCurve,
  getManifest,
  getPlayerBio,
  getPlayerCareer,
  getPlayerCareerWar,
  getPlayerGameLog,
  getPlayerSeason,
  getPlayerWar,
  getTeamMap,
} from "@/lib/queries";
import { age, height, int, num, ordinal, pct, pts, signed } from "@/lib/format";

export const revalidate = 300;

/** Which stat rows a card shows is driven by what the player actually did. */
const PROFILES: Record<
  string,
  { tiles: [string, string, "signed" | "pct" | "int" | "num" | "pts"][]; percentiles: [string, string][] }
> = {
  QB: {
    tiles: [
      ["dropbacks", "Dropbacks", "int"],
      ["epa_per_db", "EPA / dropback", "signed"],
      ["cpoe", "CPOE", "pts"],
      ["play_success", "Success rate", "pct"],
      ["passing_yards", "Pass yards", "int"],
      ["passing_tds", "TD", "int"],
    ],
    percentiles: [
      ["pct_epa_per_db", "EPA per dropback"],
      ["pct_cpoe", "Completion % over expected"],
      ["pct_play_success", "Success rate"],
      ["pct_sack_rate", "Sack avoidance"],
      ["pct_passing_yards", "Passing volume"],
      ["pct_passing_tds", "Touchdowns"],
    ],
  },
  RB: {
    tiles: [
      ["carries", "Carries", "int"],
      ["epa_per_rush", "EPA / rush", "signed"],
      ["yards_per_carry", "Yards / carry", "num"],
      ["rush_success", "Success rate", "pct"],
      ["rushing_yards", "Rush yards", "int"],
      ["receiving_yards", "Rec yards", "int"],
    ],
    percentiles: [
      ["pct_epa_per_rush", "EPA per rush"],
      ["pct_play_success", "Success rate"],
      ["pct_yards_per_carry", "Yards per carry"],
      ["pct_rushing_yards", "Rushing volume"],
      ["pct_receiving_epa", "Receiving value"],
    ],
  },
  WR: {
    tiles: [
      ["targets", "Targets", "int"],
      ["epa_per_target", "EPA / target", "signed"],
      ["receptions", "Receptions", "int"],
      ["receiving_yards", "Rec yards", "int"],
      ["avg_separation", "Separation", "num"],
      ["wopr", "WOPR", "num"],
    ],
    percentiles: [
      ["pct_epa_per_target", "EPA per target"],
      ["pct_play_success", "Success rate"],
      ["pct_receiving_yards", "Receiving volume"],
      ["pct_wopr", "Opportunity share (WOPR)"],
      ["pct_avg_separation", "Average separation"],
      ["pct_avg_yac_above_expectation", "YAC over expected"],
    ],
  },
};
PROFILES.TE = PROFILES.WR;
PROFILES.FB = PROFILES.RB;

const DEFENSE: [string, string, "int" | "num"][] = [
  ["def_snaps", "Snaps", "int"],
  ["def_sacks", "Sacks", "num"],
  ["def_qb_hits", "QB hits", "int"],
  ["def_tackles_for_loss", "TFL", "int"],
  ["def_interceptions", "INT", "int"],
  ["def_pass_defended", "PBU", "int"],
];

function fmt(value: unknown, kind: string): string {
  const v = value as number | null;
  switch (kind) {
    case "signed":
      return signed(v);
    case "pct":
      return pct(v);
    case "pts":
      return pts(v);
    case "int":
      return int(v);
    default:
      return num(v, 2);
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bio = await getPlayerBio(id);
  return { title: (bio?.name as string) ?? "Player" };
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const manifest = await getManifest();

  const bio = await getPlayerBio(id);
  if (!bio) notFound();

  const career = await getPlayerCareer(id);
  // Only honour a season the player actually played; otherwise fall back to
  // his most recent, so a stale link never renders an empty card.
  const requested = sp.season ? Number(sp.season) : null;
  const season =
    (requested !== null && career.some((c) => Number(c.season) === requested)
      ? requested
      : null) ??
    career[0]?.season ??
    manifest.stats_season;
  const careerWar = await getPlayerCareerWar(id);

  // Aging is a positional tendency, so it keys off the group rather than the
  // listed position; `getAgingCurve` falls back to the all-position curve when
  // a group has too few paired seasons to fit its own.
  const posGroup = (bio.pos_group as string) ?? null;
  const aging = await getAgingCurve(posGroup);
  const agingFellBack = aging.length > 0 && aging[0].pos_group !== posGroup;
  const playerAge = Number(age(bio.birth_date as string));
  const [line, log, teams, warSeasons] = await Promise.all([
    getPlayerSeason(id, Number(season)),
    getPlayerGameLog(id, Number(season)),
    getTeamMap(),
    getPlayerWar(id),
  ]);
  const war = warSeasons.find((w) => w.season === Number(season));

  const position = String(bio.position ?? line?.position ?? "");
  const profile = PROFILES[position];
  const team = String(line?.recent_team ?? bio.team ?? "");
  const teamMeta = teams[team];
  const isDefender = !profile && Number(line?.def_snaps ?? 0) > 0;

  const weeklyEpa = log
    .filter((g) => g.epa_per_db !== null && g.epa_per_db !== undefined)
    .map((g) => ({ week: Number(g.week), value: Number(g.epa_per_db) }));

  return (
    <>
      <div className="panel overflow-hidden mb-4">
        <div className="h-1" style={{ background: teamMeta?.color ?? "var(--navy)" }} />
        <div className="px-4 py-4 flex gap-4 flex-wrap items-start">
          {bio.headshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(bio.headshot)}
              alt=""
              width={78}
              height={78}
              className="rounded-[3px] bg-panel-2 object-cover"
            />
          ) : (
            <div className="w-[78px] h-[78px] rounded-[3px] bg-panel-2 grid place-items-center num text-ink-3 text-[22px]">
              {bio.jersey_number ?? "—"}
            </div>
          )}

          <div className="min-w-[220px] flex-1">
            <h1 className="headline text-[26px] leading-none">{String(bio.name)}</h1>
            <div className="text-[12.5px] text-ink-2 mt-1.5 flex items-center gap-2 flex-wrap">
              {teamMeta && (
                <TeamMark team={team} logo={teamMeta.logo} href={`/teams/${team}`} size={18} name={teamMeta.nick} />
              )}
              <span className="text-ink-3">·</span>
              <span>{position}</span>
              {bio.jersey_number ? <span className="text-ink-3">#{String(bio.jersey_number)}</span> : null}
            </div>
            <div className="text-[12px] text-ink-3 mt-1.5">
              {height(bio.height as number)} · {bio.weight ? `${bio.weight} lb` : "—"} · age{" "}
              {age(bio.birth_date as string)} · {String(bio.college_name ?? "—")}
              {bio.draft_year
                ? ` · ${bio.draft_year} rd ${bio.draft_round} pick ${bio.draft_pick} (${bio.draft_team})`
                : " · undrafted"}
            </div>
          </div>

          <div className="border-l border-rule pl-4 min-w-[150px]">
            <div className="label">Season</div>
            <div className="num text-[26px] font-semibold leading-tight">{String(season)}</div>
            <div className="text-[11.5px] text-ink-3">
              {line?.games ? `${int(line.games as number)} games` : "no games"} ·{" "}
              {line?.qualified ? "qualified" : "below threshold"}
            </div>
          </div>

          {war && (
            <div className="border-l border-rule pl-4 min-w-[168px]">
              <div className="label">Wins above replacement</div>
              <div className="flex items-baseline gap-2">
                <div className="num text-[30px] font-semibold leading-tight">
                  {num(war.war, 1)}
                </div>
              </div>
              <div className="text-[11px] text-ink-3 mt-0.5">
                {num(war.par, 0)} points above replacement · {int(war.plays)} plays
              </div>
            </div>
          )}

          {careerWar && careerWar.seasons > 1 && (
            <div className="border-l border-rule pl-4 min-w-[142px]">
              <div className="label">Career</div>
              <div className="num text-[30px] font-semibold leading-tight">
                {num(careerWar.career_war, 1)}
              </div>
              <div className="text-[11px] text-ink-3 mt-0.5">
                WAR across {int(careerWar.seasons)} seasons
                <br />
                best {careerWar.best_season} at {num(careerWar.best_season_war, 1)}
              </div>
            </div>
          )}
        </div>
      </div>

      {!line ? (
        <Empty>No {season} statistics for this player.</Empty>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            {(profile?.tiles ?? (isDefender ? DEFENSE.map(([k, l, f]) => [k, l, f] as [string, string, "int" | "num"]) : [])).map(
              ([key, label, kind]) => (
                <StatTile key={key} label={label} value={fmt(line[key], kind)} />
              )
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr] mt-7">
            {profile && (
              <div>
                <SectionRule aside={`vs qualified ${position}s, ${season}`}>Percentile profile</SectionRule>
                <Panel bodyClass="px-4 py-3">
                  {profile.percentiles.map(([key, label]) => (
                    <div key={key} className="grid grid-cols-[150px_1fr_44px] items-center gap-3 py-1.5">
                      <span className="text-[12.5px] text-ink-2">{label}</span>
                      <PercentileBar value={line[key] as number | null} />
                      <span className="num text-[12.5px] text-right font-semibold">
                        {line[key] === null || line[key] === undefined ? "—" : ordinal(line[key] as number)}
                      </span>
                    </div>
                  ))}
                  <div className="text-[11.5px] text-ink-3 mt-2">
                    Fill shows percentile; the center tick is the 50th. Players below the usage
                    threshold are excluded from the ramp entirely.
                  </div>
                </Panel>
              </div>
            )}

            <div>
              <SectionRule aside="per game">
                {position === "QB" ? "EPA per dropback" : "Season log"}
              </SectionRule>
              <Panel bodyClass="p-3">
                {weeklyEpa.length > 1 ? (
                  <ChartExport
                    filename={`${String(bio.name ?? id).replace(/\W+/g, "-").toLowerCase()}-${season}`}
                    caption={`${String(bio.name ?? "")} · ${season} EPA per dropback`}
                  >
                  <LineChart
                    labels={weeklyEpa.map((w) => `W${w.week}`)}
                    series={[{ name: "EPA per dropback", color: "var(--c1)", values: weeklyEpa.map((w) => w.value), fill: true }]}
                    height={230}
                    format={(v) => v.toFixed(2)}
                  />
                  </ChartExport>
                ) : (
                  <Empty>No per-play chart for this position yet.</Empty>
                )}
              </Panel>
            </div>
          </div>

          {war && (
            <>
              <SectionRule aside="wins above replacement">Value</SectionRule>
              <Panel bodyClass="px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Passing", war.war_passing, war.plays_passing],
                    ["Rushing", war.war_rushing, war.plays_rushing],
                    ["Receiving", war.war_receiving, war.plays_receiving],
                    ["Defense", war.war_defense, war.plays_defense],
                  ]
                    .filter(([, , plays]) => Number(plays) > 0)
                    .map(([label, value, plays]) => (
                      <div key={String(label)} className="border border-rule rounded-[3px] px-3 py-2.5">
                        <div className="label">{String(label)}</div>
                        <div className="num text-[20px] font-semibold mt-0.5">
                          {num(Number(value), 2)}
                        </div>
                        <div className="text-[11px] text-ink-3">{int(Number(plays))} plays</div>
                      </div>
                    ))}
                </div>
                <div className="text-[11.5px] text-ink-3 mt-3 leading-relaxed">
                  Quarterbacks are charged with the whole dropback, scrambles and sacks included;
                  receivers are judged on the full result of the target against what a throw of
                  that depth was worth; defenders are measured on their charted production rather
                  than plus-minus. Offensive linemen share a unit number split by snaps.{" "}
                  <Link href="/war" className="text-accent">How this is built</Link>
                </div>
              </Panel>
            </>
          )}

          {aging.length >= 5 && (
            <>
              <SectionRule aside="delta method">Aging</SectionRule>
              <AgingCurve
                rows={aging}
                age={Number.isFinite(playerAge) ? playerAge : null}
                posGroup={posGroup}
                fellBack={agingFellBack}
              />
            </>
          )}

          {log.length > 0 && (
            <>
              <SectionRule aside={`${season} game log`}>Games</SectionRule>
              <Panel>
                <div className="scroll-x">
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th>Wk</th>
                        <th className="l">Opp</th>
                        {position === "QB" ? (
                          <>
                            <th>DB</th>
                            <th>EPA/DB</th>
                            <th>WPA</th>
                            <th>C/A</th>
                            <th>Yds</th>
                            <th>TD</th>
                            <th>INT</th>
                            <th>Sacks</th>
                          </>
                        ) : (
                          <>
                            <th>Car</th>
                            <th>Rush yds</th>
                            <th>Tgt</th>
                            <th>Rec</th>
                            <th>Rec yds</th>
                            <th>TD</th>
                            <th>EPA</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {log.map((g) => (
                        <tr key={String(g.game_id ?? g.week)}>
                          <td className="num text-ink-3">{String(g.week)}</td>
                          <td className="l">
                            {g.opponent_team ? (
                              <TeamMark
                                team={String(g.opponent_team)}
                                logo={teams[String(g.opponent_team)]?.logo}
                                href={`/teams/${g.opponent_team}`}
                                size={17}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          {position === "QB" ? (
                            <>
                              <td className="num text-ink-2">{int(g.dropbacks as number)}</td>
                              <td className="num font-semibold">{signed(g.epa_per_db as number)}</td>
                              <td className="num text-ink-2">{signed(g.wpa as number, 2)}</td>
                              <td className="num text-ink-2">
                                {int(g.completions as number)}/{int(g.attempts as number)}
                              </td>
                              <td className="num text-ink-2">{int(g.passing_yards as number)}</td>
                              <td className="num text-ink-2">{int(g.passing_tds as number)}</td>
                              <td className="num text-ink-2">{int(g.passing_interceptions as number)}</td>
                              <td className="num text-ink-2">{int(g.sacks_suffered as number)}</td>
                            </>
                          ) : (
                            <>
                              <td className="num text-ink-2">{int(g.carries as number)}</td>
                              <td className="num text-ink-2">{int(g.rushing_yards as number)}</td>
                              <td className="num text-ink-2">{int(g.targets as number)}</td>
                              <td className="num text-ink-2">{int(g.receptions as number)}</td>
                              <td className="num text-ink-2">{int(g.receiving_yards as number)}</td>
                              <td className="num text-ink-2">
                                {int(
                                  Number(g.rushing_tds ?? 0) + Number(g.receiving_tds ?? 0)
                                )}
                              </td>
                              <td className="num font-semibold">
                                {signed(
                                  Number(g.rushing_epa ?? 0) + Number(g.receiving_epa ?? 0),
                                  1
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {career.length > 1 && (
            <>
              <SectionRule>Career</SectionRule>
              <Panel>
                <div className="scroll-x">
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th className="l">Team</th>
                        <th>G</th>
                        <th>Pass yds</th>
                        <th>Rush yds</th>
                        <th>Rec yds</th>
                        <th>Total EPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.map((s) => (
                        <tr key={String(s.season)}>
                          <td>
                            <Link
                              href={`/players/${id}?season=${s.season}`}
                              className={`link-cell num ${
                                Number(s.season) === Number(season) ? "font-semibold" : ""
                              }`}
                            >
                              {String(s.season)}
                            </Link>
                          </td>
                          <td>
                            <TeamMark
                              team={String(s.recent_team)}
                              logo={teams[String(s.recent_team)]?.logo}
                              size={17}
                            />
                          </td>
                          <td className="num text-ink-2">{int(s.games as number)}</td>
                          <td className="num text-ink-2">{int(s.passing_yards as number)}</td>
                          <td className="num text-ink-2">{int(s.rushing_yards as number)}</td>
                          <td className="num text-ink-2">{int(s.receiving_yards as number)}</td>
                          <td className="num font-semibold">{signed(s.total_epa as number, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}
