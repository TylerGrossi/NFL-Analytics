import Link from "next/link";
import { notFound } from "next/navigation";
import { AgingCurve } from "@/components/AgingCurve";
import { ChartExport } from "@/components/ChartExport";
import { LineChart } from "@/components/LineChart";
import { Empty, Notes, Panel, PercentileBar, SectionRule, StatTile, TeamMark } from "@/components/ui";
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
import { age, height, int, num, pct, pts, signed } from "@/lib/format";

export const revalidate = 300;

/** Which stat rows a card shows is driven by what the player actually did. */
/**
 * `pct` takes a fraction and `pts` a signed 0–100 figure. Two of the Next Gen
 * columns are neither: aggressiveness and share of intended air yards arrive
 * already multiplied but unsigned, so they get their own kind rather than
 * rendering as "1295%" or "+12.9".
 */
type Kind = "signed" | "pct" | "int" | "num" | "num1" | "pts" | "pctpts";

/**
 * A percentile row carries its own figure. A rank on its own says where a player
 * sits without saying what he did — 74th at what? — so every row names the stat,
 * plots the rank and prints the value. The raw column is the percentile column
 * without its `pct_` prefix; the pair exists for all sixteen.
 */
const PROFILES: Record<
  string,
  { tiles: [string, string, Kind][]; percentiles: [string, string, Kind][] }
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
      ["pct_epa_per_db", "EPA per dropback", "signed"],
      ["pct_cpoe", "Completion % over expected", "pts"],
      ["pct_play_success", "Success rate", "pct"],
      ["pct_sack_rate", "Sack avoidance", "pct"],
      ["pct_passing_yards", "Passing volume", "int"],
      ["pct_passing_tds", "Touchdowns", "int"],
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
      ["pct_epa_per_rush", "EPA per rush", "signed"],
      ["pct_play_success", "Success rate", "pct"],
      ["pct_yards_per_carry", "Yards per carry", "num"],
      ["pct_rushing_yards", "Rushing volume", "int"],
      ["pct_receiving_epa", "Receiving value", "signed"],
      ["pct_yprr", "Yards per route run", "num"],
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
      ["pct_yprr", "Yards per route run", "num"],
      ["pct_epa_per_target", "EPA per target", "signed"],
      ["pct_tprr", "Targets per route run", "num"],
      ["pct_play_success", "Success rate", "pct"],
      ["pct_receiving_yards", "Receiving volume", "int"],
      ["pct_wopr", "Opportunity share (WOPR)", "num"],
      ["pct_avg_separation", "Average separation", "num"],
      ["pct_avg_yac_above_expectation", "YAC over expected", "num"],
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
    case "pctpts":
      return v === null || v === undefined ? "—" : `${num(v, 1)}%`;
    case "int":
      return int(v);
    case "num1":
      return num(v, 1);
    default:
      return num(v, 2);
  }
}

/** A stat that is a ratio of two stored columns rather than a column of its own. */
function ratio(a: unknown, b: unknown): number | null {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && y > 0 ? x / y : null;
}

type Row = [label: string, value: unknown, kind: Kind];
type Group = { title: string; rows: Row[] };

/**
 * The detail groups under the card, per position.
 *
 * Built from the season row rather than declared as column names, because
 * several of the useful figures — completion rate, yards per attempt, catch
 * rate — are ratios the store does not keep. Groups whose volume is zero are
 * dropped by the caller: a quarterback's receiving columns hold junk from the
 * odd trick play (a −8 aDOT on one target) and are worse than showing nothing.
 */
function detailGroups(line: Record<string, unknown>, position: string): Group[] {
  const g: Group[] = [];
  const isQB = position === "QB";
  const isRB = position === "RB" || position === "FB";
  const carries = Number(line.carries ?? 0);
  const targets = Number(line.targets ?? 0);

  if (isQB) {
    g.push({
      title: "Passing",
      rows: [
        ["Completions", line.completions, "int"],
        ["Attempts", line.attempts, "int"],
        ["Completion rate", ratio(line.completions, line.attempts), "pct"],
        ["Yards", line.passing_yards, "int"],
        ["Yards per attempt", ratio(line.passing_yards, line.attempts), "num"],
        ["Touchdowns", line.passing_tds, "int"],
        ["Interceptions", line.passing_interceptions, "int"],
        ["First downs", line.passing_first_downs, "int"],
        ["Air yards", line.passing_air_yards, "int"],
        ["Yards after catch", line.passing_yards_after_catch, "int"],
        ["20+ yard gains", line.passing_20, "int"],
        ["40+ yard gains", line.passing_40, "int"],
      ],
    });
    g.push({
      title: "Pocket",
      rows: [
        ["Sacks taken", line.sacks_suffered, "int"],
        ["Sack rate", line.sack_rate, "pct"],
        // Stored negative; the label already carries the direction, and `int`
        // would render it with a hyphen rather than the site's true minus.
        ["Yards lost", Math.abs(Number(line.sack_yards_lost ?? 0)), "int"],
        ["Time to throw", line.avg_time_to_throw, "num"],
        ["Aggressiveness", line.aggressiveness, "pctpts"],
        ["Intended air yards", line.adot, "num1"],
        ["Completed air yards", line.avg_completed_air_yards, "num1"],
        ["PACR", line.pacr, "num"],
      ],
    });
    g.push({
      title: "Efficiency",
      rows: [
        ["EPA per dropback", line.epa_per_db, "signed"],
        ["Total QB EPA", line.total_qb_epa, "num1"],
        ["Success rate", line.play_success, "pct"],
        ["CPOE", line.cpoe, "pts"],
        ["Deep EPA", line.deep_epa, "signed"],
        ["Third-down EPA", line.third_epa, "signed"],
        ["Win probability added", line.wpa, "signed"],
      ],
    });
  }

  if (isRB || (isQB && carries > 0)) {
    g.push({
      title: "Rushing",
      rows: [
        ["Carries", line.carries, "int"],
        ["Yards", line.rushing_yards, "int"],
        ["Yards per carry", line.yards_per_carry, "num"],
        ["Touchdowns", line.rushing_tds, "int"],
        ["First downs", line.rushing_first_downs, "int"],
        ["EPA per rush", line.epa_per_rush, "signed"],
        ["Success rate", line.rush_success, "pct"],
        ["Explosive rate", line.explosive_rush_rate, "pct"],
        ["Stuffed rate", line.stuff_rate, "pct"],
        ["Yards over expected", line.rush_yards_over_expected_per_att, "signed"],
      ],
    });
  }

  if (!isQB && targets > 0) {
    g.push({
      title: "Receiving",
      rows: [
        ["Targets", line.targets, "int"],
        ["Receptions", line.receptions, "int"],
        ["Catch rate", ratio(line.receptions, line.targets), "pct"],
        ["Yards", line.receiving_yards, "int"],
        ["Yards per target", line.yards_per_target, "num"],
        ["Yards per reception", ratio(line.receiving_yards, line.receptions), "num"],
        ["Touchdowns", line.receiving_tds, "int"],
        ["First downs", line.receiving_first_downs, "int"],
        ["Air yards", line.receiving_air_yards, "int"],
        ["YAC per reception", line.yac_per_rec, "num"],
        ["20+ yard gains", line.receiving_20, "int"],
        ["40+ yard gains", line.receiving_40, "int"],
      ],
    });
    // The air-yards family only means anything for a player running routes. A
    // back with 31 air yards on 50 targets posts a RACR of 8.8, which is an
    // artefact of the divisor rather than a receiving profile.
    const routeRunner = !isRB;
    g.push({
      title: "Opportunity",
      rows: [
        ["Routes run", line.routes, "int"],
        ["Yards per route run", line.yprr, "num"],
        ["Targets per route run", line.tprr, "num"],
        ["Target share", line.target_share, "pct"],
        ["WOPR", line.wopr, "num"],
        ["Average depth of target", line.rec_adot, "num1"],
        ["EPA per target", line.epa_per_target, "signed"],
        ["Success rate", line.rec_success, "pct"],
        ["Total EPA", line.total_epa, "num1"],
        ...(routeRunner
          ? ([
              ["Air yards share", line.air_yards_share, "pct"],
              ["RACR", line.racr, "num"],
            ] as Row[])
          : []),
      ],
    });
    if (routeRunner) {
      g.push({
        title: "Route & catch",
        rows: [
          ["Average separation", line.avg_separation, "num"],
          ["Average cushion", line.avg_cushion, "num"],
          ["YAC over expected", line.avg_yac_above_expectation, "signed"],
          ["Intended air yards", line.avg_intended_air_yards, "num1"],
          ["Share of intended air", line.percent_share_of_intended_air_yards, "pctpts"],
        ],
      });
    }
  }

  g.push({
    title: "Usage",
    rows: [
      ["Games", line.games, "int"],
      ["Offensive snaps", line.off_snaps, "int"],
      ["Snap share", line.off_snap_pct, "pct"],
      ["Special teams snaps", line.st_snaps, "int"],
      ["Fantasy points", line.fantasy_points, "num1"],
      ["Fantasy points (PPR)", line.fantasy_points_ppr, "num1"],
      ["Penalties", line.penalties, "int"],
      ["Fumbles", line.fumbles_total, "int"],
    ],
  });

  // A group whose every figure is missing is noise; one stray zero is not.
  return g
    .map((x) => ({
      ...x,
      rows: x.rows.filter(([, v]) => v !== null && v !== undefined),
    }))
    .filter((x) => x.rows.length > 0);
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
  const groups = line ? detailGroups(line as Record<string, unknown>, position) : [];

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
                <SectionRule>Percentile rankings</SectionRule>
                <Panel bodyClass="px-4 py-3">
                  {/* The scale, stated once, so no row has to explain itself. */}
                  <div className="grid grid-cols-[minmax(96px,132px)_1fr_62px] items-center gap-3 pb-2 mb-1 border-b border-rule">
                    <span className="label">vs position</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10.5px] text-ink-3">0</span>
                      <span
                        className="h-[5px] flex-1 rounded-full"
                        style={{
                          background:
                            "linear-gradient(to right, #1b5fa8, #d9d4cc 50%, #b3332a)",
                        }}
                      />
                      <span className="text-[10.5px] text-ink-3">100</span>
                    </span>
                    <span className="label text-right">Value</span>
                  </div>

                  {profile.percentiles.map(([key, label, kind]) => {
                    const rank = line[key] as number | null | undefined;
                    const raw = line[key.replace(/^pct_/, "")];
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(96px,132px)_1fr_62px] items-center gap-3 py-[5px]"
                      >
                        <span className="text-[12.5px] text-ink-2 leading-tight">{label}</span>
                        <PercentileBar value={rank} label={label} />
                        <span className="num text-[12.5px] text-right font-semibold">
                          {raw === null || raw === undefined ? "—" : fmt(raw, kind)}
                        </span>
                      </div>
                    );
                  })}
                </Panel>
              </div>
            )}

            <div>
              <SectionRule>
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

          {groups.length > 0 && (
            <>
              <SectionRule>Season detail</SectionRule>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-2">
                {groups.map((group) => (
                  <Panel key={group.title} title={group.title} bodyClass="px-4 py-2">
                    <dl className="m-0">
                      {group.rows.map(([label, value, kind]) => (
                        <div
                          key={label}
                          className="flex items-baseline justify-between gap-3 py-[3px] border-b border-rule last:border-0"
                        >
                          <dt className="text-[12.5px] text-ink-2">{label}</dt>
                          <dd className="num text-[12.5px] font-semibold m-0">{fmt(value, kind)}</dd>
                        </div>
                      ))}
                    </dl>
                  </Panel>
                ))}
              </div>
            </>
          )}

          {war && (
            <>
              <SectionRule>Value</SectionRule>
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
              <SectionRule>Aging</SectionRule>
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
              <SectionRule>Games</SectionRule>
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

          {profile && (
            <Notes title="Reading the percentiles">
              <ul>
                <li>
                  Each row ranks this player against everyone at his position who cleared the
                  usage threshold that season. The bubble is the rank, the tick behind it is the
                  50th, and the figure at the right is the stat itself.
                </li>
                <li>
                  Red is the top of the position, blue the bottom, grey the middle. The two ends
                  stay apart for colourblind readers and in greyscale, but the number is printed
                  in the bubble either way, so nothing depends on seeing the colour.
                </li>
                <li>
                  Sack avoidance inverts its stat — a low sack rate ranks high. Players below the
                  usage threshold are left out of the ranking entirely rather than ranked on a
                  handful of plays.
                </li>
                <li>
                  A route here is a regular-season dropback the player was on the field for, counted
                  from the participation feed, which begins in 2016. That is the public
                  approximation, not a charted one: a back who stayed in to block and a tight end
                  who chipped both count as having run a route, so their yards per route run reads
                  a little low. Receivers are close to the charted figure.
                </li>
              </ul>
            </Notes>
          )}
        </>
      )}
    </>
  );
}
