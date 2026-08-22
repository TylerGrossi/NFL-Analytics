import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AgingCurve } from "@/components/AgingCurve";
import { LineChart } from "@/components/LineChart";
import { Empty, Notes, Panel, PercentileBar, SectionRule, StatTile, TeamMark } from "@/components/ui";
import {
  getAgingCurve,
  getManifest,
  getPlayerBio,
  getPlayerCareer,
  getPlayerCareerEpa,
  getPlayerGameLog,
  getPlayerSeason,
  getTeamMap,
} from "@/lib/queries";
import { age, height, int, num, pct, pts, signed } from "@/lib/format";

export const revalidate = 300;

/**
 * `pct` takes a fraction and `pts` a signed 0–100 figure. Two of the Next Gen
 * columns are neither: aggressiveness and share of intended air yards arrive
 * already multiplied but unsigned, so they get their own kind rather than
 * rendering as "1295%" or "+12.9".
 */
type Kind = "signed" | "pct" | "int" | "num" | "num1" | "pts" | "pctpts";

/**
 * Positions expected points can price at all.
 *
 * EPA is charged to the man who touched the ball, so a dropback, a carry and a
 * target are the whole of it. Linemen and defenders are not absent because they
 * do not matter — they are absent because this stat has nothing to say about
 * them, and their cards fall back to the charted production below.
 */
const SKILL = new Set(["QB", "RB", "FB", "WR", "TE"]);

/**
 * Roster status, as the feed spells it against what it means.
 *
 * These arrive as three-letter codes — ACT, DEV, RES — which are unambiguous
 * to the source and opaque to everyone else. Anything not listed falls back to
 * the raw code rather than to nothing, so a new code shows up as a puzzle
 * rather than as a blank line.
 */
const STATUS: Record<string, string> = {
  ACT: "Active",
  DEV: "Practice squad",
  RES: "Injured reserve",
  PUP: "Physically unable to perform",
  RSR: "Reserve / retired",
  RSN: "Reserve / non-football injury",
  NWT: "Not with a team",
  CUT: "Free agent",
  RLS: "Released",
  SUS: "Suspended",
};

/**
 * The season-and-career strip under the header.
 *
 * This replaced a row of six tiles. Every figure in those tiles now appears in
 * the Profile below with a rank beside it, so the tiles were repeating the page
 * back to itself; a career line next to the season line is the one thing the
 * card could not say before.
 */
const TOTALS: Record<string, [label: string, column: string, kind: Kind][]> = {
  QB: [
    ["G", "games", "int"],
    ["Cmp", "completions", "int"],
    ["Att", "attempts", "int"],
    ["Yds", "passing_yards", "int"],
    ["TD", "passing_tds", "int"],
    ["INT", "passing_interceptions", "int"],
    ["Rush yds", "rushing_yards", "int"],
  ],
  WR: [
    ["G", "games", "int"],
    ["Tgt", "targets", "int"],
    ["Rec", "receptions", "int"],
    ["Yds", "receiving_yards", "int"],
    ["TD", "receiving_tds", "int"],
    ["EPA", "total_epa", "num1"],
  ],
  RB: [
    ["G", "games", "int"],
    ["Att", "carries", "int"],
    ["Rush yds", "rushing_yards", "int"],
    ["TD", "rushing_tds", "int"],
    ["Rec", "receptions", "int"],
    ["Rec yds", "receiving_yards", "int"],
  ],
};
TOTALS.TE = TOTALS.WR;
TOTALS.FB = TOTALS.RB;

/**
 * The career table's columns when the position has no totals set of its own —
 * a lineman, a kicker, a defender whose season line is charted rather than
 * counted. Games and the three yardage columns are the least wrong thing to
 * show a reader who came looking for a career.
 */
const CAREER_FALLBACK: [string, string, Kind][] = [
  ["G", "games", "int"],
  ["Pass yds", "passing_yards", "int"],
  ["Rush yds", "rushing_yards", "int"],
  ["Rec yds", "receiving_yards", "int"],
];

const DEF_TOTALS: [string, string, Kind][] = [
  ["G", "games", "int"],
  ["Snaps", "def_snaps", "int"],
  ["Tkl", "def_tackles_combined", "int"],
  ["TFL", "def_tackles_for_loss", "int"],
  ["Sacks", "def_sacks", "num1"],
  ["Prss", "def_pressures", "int"],
  ["INT", "def_interceptions", "int"],
  ["PD", "def_pass_defended", "int"],
];
for (const pos of ["CB", "SAF", "FS", "S", "SS", "DB", "LB", "OLB", "ILB", "MLB", "DE", "DT", "NT", "DL"]) {
  TOTALS[pos] = DEF_TOTALS;
}

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

/**
 * A row names the column it came from, so the card can find that column's
 * percentile — `pct_<column>` — without a second table mapping one to the other.
 * A literal number is a figure the store does not keep (a ratio computed here);
 * it has no rank and so draws no bar.
 */
type Source = string | number | null;
type Row = [label: string, source: Source, kind: Kind];
type Group = { title: string; rows: Row[] };

/**
 * The detail groups under the card, per position.
 *
 * Groups whose volume is zero are dropped by the caller: a quarterback's
 * receiving columns hold junk from the odd trick play (a -8 aDOT on one target)
 * and are worse than showing nothing.
 */
const DEF_POSITIONS = new Set([
  "CB", "SAF", "FS", "S", "SS", "DB", "LB", "OLB", "ILB", "MLB",
  "DE", "DT", "NT", "DL",
]);

function detailGroups(line: Record<string, unknown>, position: string): Group[] {
  const g: Group[] = [];
  const isQB = position === "QB";
  const isRB = position === "RB" || position === "FB";
  const isReceiver = position === "WR" || position === "TE";
  const carries = Number(line.carries ?? 0);
  const targets = Number(line.targets ?? 0);

  // Value first, because it is the thing the card is now about. Expected points
  // added is the site's headline figure; the phase rows underneath say where it
  // came from, and only appear for a phase the player actually played.
  if (SKILL.has(position)) {
    g.push({
      title: "Value",
      rows: [
        ["Total EPA", "total_epa", "num1"],
        ...(isQB ? ([["Passing EPA", "passing_epa", "num1"]] as Row[]) : []),
        // A receiver's total EPA *is* his receiving EPA to within a jet
        // sweep, so the phase rows would print the headline number three
        // times over. Backs and quarterbacks genuinely split and keep theirs;
        // a quarterback's receiving line is one trick play and is never shown.
        ...(isReceiver
          ? []
          : [
              ...(carries > 0
                ? ([["Rushing EPA", "rushing_epa", "num1"]] as Row[])
                : []),
              ...(!isQB && targets > 0
                ? ([["Receiving EPA", "receiving_epa", "num1"]] as Row[])
                : []),
            ]),
        ...(isQB
          ? ([["EPA per dropback", "epa_per_db", "signed"]] as Row[])
          : isRB
            ? ([["EPA per rush", "epa_per_rush", "signed"]] as Row[])
            : ([["EPA per target", "epa_per_target", "signed"]] as Row[])),
      ],
    });
  }

  if (isQB) {
    g.push({
      title: "Passing",
      rows: [
        ["Completions", "completions", "int"],
        ["Attempts", "attempts", "int"],
        ["Completion rate", "completion_pct", "pct"],
        ["Yards", "passing_yards", "int"],
        ["Yards per attempt", "yards_per_attempt", "num"],
        ["Touchdowns", "passing_tds", "int"],
        ["Interceptions", "passing_interceptions", "int"],
      ],
    });
    g.push({
      title: "Efficiency",
      rows: [
        ["CPOE", "cpoe", "pts"],
        ["Passer rating", "passer_rating", "num1"],
        ["Deep EPA", "deep_epa", "signed"],
        ["Third-down EPA", "third_epa", "signed"],
        ["Sacks taken", "sacks_suffered", "int"],
        ["Sack rate", "sack_rate", "pct"],
      ],
    });
  }

  if (isRB || (isQB && carries > 0)) {
    g.push({
      title: "Rushing",
      rows: [
        ...(isQB
          ? []
          : ([["Carries", "carries", "int"]] as Row[])),
        ["Yards", "rushing_yards", "int"],
        ...(isQB
          ? []
          : ([["Yards per carry", "yards_per_carry", "num"]] as Row[])),
        ["Touchdowns", "rushing_tds", "int"],
        ...(isQB
          ? []
          : ([
              ["First downs", "rushing_first_downs", "int"],
              ["Success rate", "rush_success", "pct"],
              ["Explosive rate", "explosive_rush_rate", "pct"],
              ["Stuffed rate", "stuff_rate", "pct"],
            ] as Row[])),
        ["Yards over expected", "rush_yards_over_expected_per_att", "signed"],
        ["Total yards over expected", "rush_yards_over_expected", "num1"],
        ["Runs over expected", "rush_pct_over_expected", "pctpts"],
      ],
    });
  }

  if (!isQB && targets > 0) {
    g.push({
      title: "Receiving",
      rows: [
        ["Targets", "targets", "int"],
        ["Receptions", "receptions", "int"],
        ["Catch rate", "catch_pct", "pct"],
        ["Yards", "receiving_yards", "int"],
        ["Yards per reception", "yards_per_rec", "num"],
        ["Touchdowns", "receiving_tds", "int"],
        ["First downs", "receiving_first_downs", "int"],
        // Off a receiver's card: yards per target is yards and catch rate
        // multiplied together, and the last two are volume the target count
        // above already carries.
        ...(isReceiver
          ? []
          : ([
              ["Yards per target", "yards_per_target", "num"],
              ["20+ yard gains", "receiving_20", "int"],
              ["Air yards", "receiving_air_yards", "int"],
            ] as Row[])),
      ],
    });
    // The air-yards family only means anything for a player running routes. A
    // back with 31 air yards on 50 targets posts a RACR of 8.8, which is an
    // artifact of the divisor rather than a receiving profile.
    const routeRunner = !isRB;
    g.push({
      title: "Opportunity",
      rows: [
        ["Routes run", "routes", "int"],
        ["YPRR", "yprr", "num"],
        // Off a receiver's card: targets per route run, target share and
        // air-yards share are three ways of saying how much of the offense
        // ran through him, and YPRR above already prices what a route was
        // worth.
        ...(isReceiver
          ? []
          : ([
              ["Targets per route run", "tprr", "num"],
              ["Target share", "target_share", "pct"],
              ["Success rate", "rec_success", "pct"],
            ] as Row[])),
        ...(routeRunner
          ? ([
              ...(isReceiver
                ? []
                : ([["Air yards share", "air_yards_share", "pct"]] as Row[])),
              ["Average separation", "avg_separation", "num"],
              ["YAC over expected", "avg_yac_above_expectation", "signed"],
            ] as Row[])
          : []),
      ],
    });
  }

  if (DEF_POSITIONS.has(position) && Number(line.def_snaps ?? 0) > 0) {
    g.push({
      title: "Pass rush",
      rows: [
        ["Pressures", "def_pressures", "int"],
        ["Hurries", "def_hurries", "int"],
        ["QB knockdowns", "def_qb_knockdowns", "int"],
        ["QB hits", "def_qb_hits", "int"],
        ["Sacks", "def_sacks", "num1"],
        ["Tackles for loss", "def_tackles_for_loss", "int"],
      ],
    });
    g.push({
      title: "Coverage",
      rows: [
        ["Targeted", "def_targets", "int"],
        ["Completions allowed", "def_completions_allowed", "int"],
        // PFR ships this as a fraction, not as points.
        ["Completion rate", "def_completion_pct_allowed", "pct"],
        ["Yards allowed", "def_yards_allowed", "int"],
        ["TDs allowed", "def_tds_allowed", "int"],
        ["Passer rating allowed", "def_passer_rating_allowed", "num1"],
        ["YAC allowed", "def_yac_allowed", "int"],
        ["Interceptions", "def_interceptions", "int"],
        ["Passes defended", "def_pass_defended", "int"],
      ],
    });
    g.push({
      title: "Tackling & usage",
      rows: [
        ["Tackles", "def_tackles_combined", "int"],
        ["Missed tackles", "def_missed_tackles", "int"],
        ["Missed tackle rate", "def_missed_tackle_pct", "pct"],
        ["Forced fumbles", "def_fumbles_forced", "int"],
        ["Defensive snaps", "def_snaps", "int"],
      ],
    });
  }

  // Red zone and usage are dropped for receivers and quarterbacks on
  // purpose. Red zone is a second copy of the line above filtered to twenty
  // yards of field, and usage is snaps and fantasy points — two dozen rows
  // between the reader and anything the groups above had not already said.
  const noSplits = isReceiver || isQB;
  const rzCarries = noSplits ? 0 : Number(line.rz_carries ?? 0);
  const rzTargets = noSplits ? 0 : Number(line.rz_targets ?? 0);
  if (rzCarries > 0 || rzTargets > 0) {
    g.push({
      title: "Red zone",
      rows: [
        ...(rzCarries > 0
          ? ([
              ["Carries", "rz_carries", "int"],
              ["Rush yards", "rz_rush_yards", "int"],
              ["Rush TD", "rz_rush_tds", "int"],
              ["Rush success", "rz_rush_success", "pct"],
              ["EPA per rush", "rz_epa_per_rush", "signed"],
              // Inside the five is a different job from inside the twenty.
              ["Goal-line carries", "gl_carries", "int"],
              ["Goal-line TD", "gl_rush_tds", "int"],
            ] as Row[])
          : []),
        ...(rzTargets > 0
          ? ([
              ["Targets", "rz_targets", "int"],
              ["Receptions", "rz_receptions", "int"],
              ["Rec yards", "rz_rec_yards", "int"],
              ["Rec TD", "rz_rec_tds", "int"],
              ["EPA per target", "rz_epa_per_target", "signed"],
              ["Goal-line targets", "gl_targets", "int"],
            ] as Row[])
          : []),
      ],
    });
  }

  if (!noSplits) g.push({
    title: "Usage",
    rows: [
      ["Offensive snaps", "off_snaps", "int"],
      ["Snap share", "off_snap_pct", "pct"],
      ["Fantasy points", "fantasy_points", "num1"],
      ["Fantasy points (PPR)", "fantasy_points_ppr", "num1"],
      ["Penalties", "penalties", "int"],
      ["Fumbles", "fumbles_total", "int"],
    ],
  });

  // A row whose figure is missing is noise; a group with nothing left is worse.
  const value = (src: Source) => (typeof src === "string" ? line[src] : src);
  return g
    .map((x) => ({
      ...x,
      rows: x.rows.filter(([, src]) => {
        const v = value(src);
        return v !== null && v !== undefined;
      }),
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
  // Only honor a season the player actually played; otherwise fall back to
  // his most recent, so a stale link never renders an empty card.
  const requested = sp.season ? Number(sp.season) : null;
  const season =
    (requested !== null && career.some((c) => Number(c.season) === requested)
      ? requested
      : null) ??
    career[0]?.season ??
    manifest.stats_season;
  const careerEpa = await getPlayerCareerEpa(id);

  // Aging is a positional tendency, so it keys off the group rather than the
  // listed position; `getAgingCurve` falls back to the all-position curve when
  // a group has too few paired seasons to fit its own.
  const posGroup = (bio.pos_group as string) ?? null;
  const aging = await getAgingCurve(posGroup);
  const agingFellBack = aging.length > 0 && aging[0].pos_group !== posGroup;
  const playerAge = Number(age(bio.birth_date as string));
  const [line, log, teams] = await Promise.all([
    getPlayerSeason(id, Number(season)),
    getPlayerGameLog(id, Number(season)),
    getTeamMap(),
  ]);

  const position = String(bio.position ?? line?.position ?? "");
  const isSkill = SKILL.has(position);
  const team = String(line?.recent_team ?? bio.team ?? "");
  const teamMeta = teams[team];
  const isDefender = !isSkill && Number(line?.def_snaps ?? 0) > 0;
  const groups = line ? detailGroups(line as Record<string, unknown>, position) : [];
  const totals = line ? (TOTALS[position] ?? []) : [];
  // The career table used to print pass, rush and receiving yards for
  // everybody, so a receiver read a column of zeroes and a quarterback read
  // two. It uses the position's own column set instead, with EPA on the end.
  // The career table draws EPA itself, in its own signed column on the end, so
  // the strip's EPA entry is dropped here rather than printed twice.
  const careerCols = (TOTALS[position] ?? CAREER_FALLBACK).filter(
    ([, column]) => column !== "total_epa"
  );
  // Career is every season row the store holds for him, so a total is a sum
  // across them rather than a separate stored figure.
  const careerTotal = (column: string) =>
    career.reduce((sum, row) => sum + Number((row as Record<string, unknown>)[column] ?? 0), 0);

  // The rolling line under the bio. Every position that scores EPA at all
  // scores it the same three ways, so one series covers the card rather than
  // one per position.
  const weeklyEpa = log
    .map((g) => ({
      week: Number(g.week),
      value:
        Number(g.passing_epa ?? 0) +
        Number(g.rushing_epa ?? 0) +
        Number(g.receiving_epa ?? 0),
    }))
    .filter((w) => Number.isFinite(w.value));

  return (
    <>
      {/* Identity on the left, ranking on the right — the shape a reader
          already knows from a baseball or basketball card. The left column is
          fixed at 440px because it holds a portrait, a bio, and a totals
          table that should not need a scrollbar of its own; the right takes whatever is left and never falls below zero,
          which is what `minmax(0,1fr)` is for under the global `min-width: 0`. */}
      <div className="grid gap-4 lg:grid-cols-[440px_minmax(0,1fr)] mb-4">
        <div className="panel overflow-hidden">
          <div className="h-1" style={{ background: teamMeta?.color ?? "var(--navy)" }} />

          <div className="px-5 pt-6 pb-4 text-center">
            {bio.headshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(bio.headshot)}
                alt=""
                width={148}
                height={148}
                className="rounded-full bg-panel-2 object-cover mx-auto"
              />
            ) : (
              <div className="w-[148px] h-[148px] rounded-full bg-panel-2 grid place-items-center num text-ink-3 text-[36px] mx-auto">
                {bio.jersey_number ?? "—"}
              </div>
            )}

            <h1 className="headline text-[30px] leading-tight mt-3.5">{String(bio.name)}</h1>

            <div className="text-[13.5px] text-ink-2 mt-1.5 flex items-center justify-center gap-x-2 flex-wrap">
              {teamMeta ? (
                <TeamMark
                  team={team}
                  logo={teamMeta.logo}
                  href={`/teams/${team}`}
                  size={17}
                  name={teamMeta.nick}
                />
              ) : (
                <span>{team || "Free agent"}</span>
              )}
              {bio.jersey_number ? (
                <>
                  <span className="text-ink-3">·</span>
                  <span className="num text-ink-3">#{String(bio.jersey_number)}</span>
                </>
              ) : null}
              <span className="text-ink-3">·</span>
              <span>{position || "—"}</span>
            </div>

            {bio.status ? (
              <div className="text-[11.5px] text-ink-3 mt-2 flex items-center justify-center gap-1.5">
                <span
                  className="inline-block w-[7px] h-[7px] rounded-full"
                  style={{
                    background:
                      bio.status === "ACT" ? "var(--pos)" : "var(--rule-strong)",
                  }}
                />
                {STATUS[String(bio.status)] ?? String(bio.status)}
              </div>
            ) : null}
          </div>

          <dl className="px-5 py-3 border-t border-rule text-[13px]">
            <BioRow label="Ht / Wt">
              {height(bio.height as number)}
              {bio.weight ? ` · ${bio.weight} lb` : ""}
            </BioRow>
            <BioRow label="Age">{age(bio.birth_date as string)}</BioRow>
            <BioRow label="Experience">
              {bio.years_of_experience ? `${bio.years_of_experience} seasons` : "Rookie"}
            </BioRow>
            <BioRow label="Draft">
              {bio.draft_year
                ? `${bio.draft_year} · Rd ${bio.draft_round}, Pk ${bio.draft_pick}${
                    bio.draft_team ? ` (${bio.draft_team})` : ""
                  }`
                : "Undrafted"}
            </BioRow>
            <BioRow label="College">{String(bio.college_name ?? "—")}</BioRow>
          </dl>

          {line && totals.length > 0 && (
            <div className="border-t border-rule scroll-x">
              <table className="grid-table text-[12.5px]" data-nosort>
                <thead>
                  <tr>
                    <th className="l" />
                    {totals.map(([label]) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="l font-semibold">{season}</td>
                    {totals.map(([label, column, kind]) => (
                      <td key={label} className="num font-semibold">
                        {fmt(line[column], kind)}
                      </td>
                    ))}
                  </tr>
                  {career.length > 1 && (
                    <tr>
                      <td className="l text-ink-2">Career</td>
                      {totals.map(([label, column, kind]) => (
                        <td key={label} className="num text-ink-2">
                          {fmt(careerTotal(column), kind)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {weeklyEpa.length > 1 && (
            <div className="border-t border-rule px-2 pt-2 pb-1">
              <div className="label px-2">Weekly EPA</div>
              <LineChart
                labels={weeklyEpa.map((w) => String(w.week))}
                series={[
                  {
                    name: "EPA",
                    color: "var(--c1)",
                    values: weeklyEpa.map((w) => w.value),
                    fill: true,
                  },
                ]}
                width={660}
                height={240}
                format={(v) => v.toFixed(0)}
              />
            </div>
          )}
        </div>

        {/* The ranking sheet. One column, sectioned — a three-across grid of
            group boxes made every row's bar a different length from its
            neighbor's, so nothing could be read down. */}
        <div className="panel overflow-hidden">
          <div className="px-4 pt-3.5 pb-2">
            <h2 className="headline text-[17px] leading-none">
              {season} season · league percentile rankings
            </h2>
          </div>

          {!line ? (
            <Empty>No {season} statistics for this player.</Empty>
          ) : groups.length === 0 ? (
            <Empty>No ranked statistics for this player.</Empty>
          ) : (
            <>
              {/* The scale, once, over the column every bar shares. */}
              <div className={`${RANK_GRID} px-4 pb-1.5`}>
                <span />
                <span className="flex justify-between label text-ink-3">
                  <span>Poor</span>
                  <span>Average</span>
                  <span>Great</span>
                </span>
                <span />
              </div>

              {groups.map((group) => (
                <section key={group.title} className="border-t border-rule px-4 py-2.5">
                  <div className="label mb-1.5">{group.title}</div>
                  {group.rows.map(([label, source, kind]) => {
                    const value = typeof source === "string" ? line[source] : source;
                    const rank =
                      typeof source === "string"
                        ? (line[`pct_${source}`] as number | null | undefined)
                        : null;
                    return (
                      <div key={label} className={`${RANK_GRID} items-center py-[2.5px]`}>
                        <span className="text-[12.5px] text-ink-2 leading-tight truncate">
                          {label}
                        </span>
                        <PercentileBar value={rank} label={label} />
                        <span className="num text-[12.5px] text-right font-semibold">
                          {fmt(value, kind)}
                        </span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </>
          )}
        </div>
      </div>

      {!line ? null : (
        <>
          {!isSkill && isDefender && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] mb-4">
              {DEFENSE.map(([key, label, kind]) => (
                <StatTile key={key} label={label} value={fmt(line[key], kind)} />
              ))}
            </div>
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
                        {careerCols.map(([label]) => (
                          <th key={label}>{label}</th>
                        ))}
                        <th>EPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.map((sn) => (
                        <tr key={String(sn.season)}>
                          <td>
                            <Link
                              href={`/players/${id}?season=${sn.season}`}
                              className={`link-cell num ${
                                Number(sn.season) === Number(season) ? "font-semibold" : ""
                              }`}
                            >
                              {String(sn.season)}
                            </Link>
                          </td>
                          <td>
                            <TeamMark
                              team={String(sn.recent_team)}
                              logo={teams[String(sn.recent_team)]?.logo}
                              size={17}
                            />
                          </td>
                          {careerCols.map(([label, column, kind]) => (
                            <td key={label} className="num text-ink-2">
                              {fmt((sn as Record<string, unknown>)[column], kind)}
                            </td>
                          ))}
                          <td className="num font-semibold">{signed(sn.total_epa as number, 1)}</td>
                        </tr>
                      ))}
                      {careerEpa && careerEpa.seasons > 1 && (
                        <tr>
                          <td className="l text-ink-2">Career</td>
                          <td className="l text-ink-3 text-[11.5px]">
                            {careerEpa.seasons} seasons
                          </td>
                          {careerCols.map(([label, column, kind]) => (
                            <td key={label} className="num text-ink-2">
                              {fmt(careerTotal(column), kind)}
                            </td>
                          ))}
                          <td className="num font-semibold">
                            {signed(careerEpa.career_epa, 0)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {isSkill && (
            <Notes title="Reading the percentiles">
              <ul>
                <li>
                  Each row ranks this player against everyone at his position who cleared the
                  usage threshold that season. The bubble is the rank, the tick behind it is the
                  50th, and the figure at the right is the stat itself.
                </li>
                <li>
                  Red is the top of the position, blue the bottom, gray the middle. The two ends
                  stay apart for colorblind readers and in grayscale, but the number is printed
                  in the bubble either way, so nothing depends on seeing the color.
                </li>
                <li>
                  Sack avoidance inverts its stat — a low sack rate ranks high. Players below the
                  usage threshold are left out of the ranking entirely rather than ranked on a
                  handful of plays.
                </li>
                <li>
                  Expected points added is charged to the man who touched the ball, so a
                  dropback, a carry and a target are the whole of it. A quarterback wears the
                  sack and the scramble along with the throw; a receiver wears the full result of
                  the target. Blocking and coverage score nothing here, which is why linemen and
                  defenders read their charted production instead.{" "}
                  <Link href="/glossary" className="text-accent">What the terms mean</Link>
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

/**
 * The shared column template for a ranked row: label, bar, figure.
 *
 * Named rather than repeated so the "Poor / Average / Great" scale above the
 * list sits over exactly the track the bars use. The bar column is elastic and
 * the figure column fixed, so every number in the sheet lines up on its right
 * edge however long the label beside it runs.
 */
const RANK_GRID = "grid grid-cols-[minmax(0,1fr)_minmax(140px,3.4fr)_58px] gap-3";

function BioRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <dt className="label shrink-0">{label}</dt>
      <dd className="text-right text-ink-2 truncate">{children}</dd>
    </div>
  );
}
