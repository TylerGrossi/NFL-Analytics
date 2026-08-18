import Link from "next/link";
import { Deck, Empty, Panel, PageHead, StatTile, TeamMark } from "@/components/ui";
import {
  getAllTimeSeasons,
  getCareerWar,
  getManifest,
  getTeamMap,
  getWarLeaders,
  getWarValidation,
  type CareerWarRow,
  type WarRow,
} from "@/lib/queries";
import { int, num, signed } from "@/lib/format";

export const metadata = { title: "WAR" };
export const revalidate = 300;

const POSITIONS = [
  { key: "ALL", label: "All" },
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running backs" },
  { key: "WR", label: "Receivers" },
  { key: "DEF", label: "Defenders" },
  { key: "OL", label: "Linemen" },
  { key: "ST", label: "Specialists" },
];

/** Which roles actually produced a player's value, largest first. */
function roleBreakdown(p: {
  war_passing: number; war_rushing: number; war_receiving: number;
  war_defense: number; war_line: number;
  war_kicking: number; war_punting: number; war_returns: number;
}): string {
  const parts: [string, number][] = [
    ["pass", p.war_passing],
    ["rush", p.war_rushing],
    ["rec", p.war_receiving],
    ["def", p.war_defense],
    ["line", p.war_line],
    ["kick", p.war_kicking],
    ["punt", p.war_punting],
    ["ret", p.war_returns],
  ];
  const shown = parts
    .filter(([, v]) => v !== null && v !== undefined && Math.abs(v) >= 0.05)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
  return shown.length ? shown.join(" · ") : "—";
}



const VIEWS = [
  { key: "season", label: "Season" },
  { key: "career", label: "Career" },
  { key: "alltime", label: "All-time seasons" },
];

export default async function WarPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; season?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const season = Number(sp.season ?? manifest.stats_season);
  const position = POSITIONS.find((p) => p.key === sp.pos)?.key ?? "ALL";
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "season";

  const [leaders, career, allTime, teams, validation] = await Promise.all([
    view === "season" ? getWarLeaders(season, position, 50) : Promise.resolve([]),
    view === "career" ? getCareerWar(position, 50) : Promise.resolve([]),
    view === "alltime" ? getAllTimeSeasons(position, 50) : Promise.resolve([]),
    getTeamMap(),
    getWarValidation(),
  ]);

  const rows: (WarRow | CareerWarRow)[] =
    view === "career" ? career : view === "alltime" ? allTime : leaders;
  const isCareer = view === "career";
  // Only the season board carries a percentile: it is computed over that
  // season's qualified pool at that position, which the career and all-time
  // views are not drawn from.
  const showPct = view === "season";
  // On a filtered board, show the value that board ranks on. Total WAR is
  // still the honest figure for a player overall, but on a running back list
  // it lets return work masquerade as rushing value.
  const warOf = (r: WarRow | CareerWarRow) =>
    isCareer
      ? (r as CareerWarRow).career_war
      : ((r as WarRow).role_war ?? (r as WarRow).war);

  const maxWar = Math.max(1, ...rows.map((r) => warOf(r)));
  const minWar = Math.min(0, ...rows.map((r) => warOf(r)));
  const scale = (v: number) => ((v - minWar) / (maxWar - minWar)) * 100;

  const qs = (patch: Record<string, string | number>) => {
    const base: Record<string, string> = { pos: position, view };
    if (view === "season") base.season = String(season);
    for (const [k, v] of Object.entries(patch)) base[k] = String(v);
    return `/war?${new URLSearchParams(base).toString()}`;
  };

  return (
    <>
      <PageHead
      >
        Wins above replacement
      </PageHead>

      <Deck>
        Credit for every snap, allocated across all eight roles — passer, carrier, receiver,
        defender, line, kicking, punting, returns.
      </Deck>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={qs({ view: v.key })}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              v.key === view
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {POSITIONS.map((p) => (
          <Link
            key={p.key}
            href={qs({ pos: p.key })}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              p.key === position
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <div className="flex-1" />
        {view === "season" &&
          manifest.seasons
            .slice()
            .reverse()
            .slice(0, 10)
            .map((s) => (
              <Link
                key={s}
                href={qs({ season: s })}
                className={`num px-2 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline ${
                  s === season
                    ? "bg-navy border-navy text-white"
                    : "bg-panel border-rule text-ink-2"
                }`}
              >
                {s}
              </Link>
            ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] items-start">
        <Panel
          title={
            view === "career"
              ? "Career leaderboard"
              : view === "alltime"
                ? "Best seasons ever"
                : "Leaderboard"
          }
        >
          {rows.length === 0 ? (
            <Empty>No WAR built for this season.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="l">Player</th>
                    <th className="l">Pos</th>
                    <th className="l">Tm</th>
                    <th>{isCareer ? "Seasons" : "Plays"}</th>
                    <th className="l" style={{ width: 170 }} aria-label="Distribution" />
                    <th>WAR</th>
                    {showPct && (
                      <th title="Percentile among everyone at this position who cleared the usage qualifier this season">
                        Pctl
                      </th>
                    )}
                    <th title="Points above replacement — what WAR is derived from">PAR</th>
                    <th className="l">Value from</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((rowData, i) => {
                    const p = rowData as WarRow & CareerWarRow;
                    const war = warOf(rowData);
                    const par = isCareer ? p.career_par : p.par;
                    const plays = isCareer ? p.seasons : p.plays;
                    return (
                    <tr key={`${p.player_id}-${p.season ?? "career"}`}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td className="l">
                        <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                          {p.name ?? p.player_id}
                        </Link>
                      </td>
                      <td className="l text-ink-3 text-[11.5px]">{p.position ?? "—"}</td>
                      <td className="l">
                        {p.team && (
                          <TeamMark
                            team={p.team}
                            logo={teams[p.team]?.logo}
                            size={16}
                            showAbbr={false}
                            href={`/teams/${p.team}`}
                          />
                        )}
                      </td>
                      <td className="num text-ink-2">
                        {int(plays)}
                        {view === "alltime" && (
                          <span className="text-ink-3 ml-1.5 text-[11px]">{p.season}</span>
                        )}
                      </td>
                      <td className="l">
                        <span className="relative block h-[13px] bg-panel-2 rounded-[2px]">
                          {scale(0) > 0.5 && (
                            <span
                              className="absolute inset-y-0 w-px bg-rule-strong z-[1]"
                              style={{ left: `${scale(0)}%` }}
                            />
                          )}
                          <span
                            className="absolute inset-y-0 rounded-[1px]"
                            style={{
                              left: `${Math.min(scale(0), scale(war))}%`,
                              width: `${Math.max(0.6, Math.abs(scale(war) - scale(0)))}%`,
                              background: war < 0 ? "var(--neg)" : "var(--accent)",
                              opacity: 0.75,
                            }}
                          />
                        </span>
                      </td>
                      <td className="num font-semibold">{num(war, Math.abs(war) < 1 ? 2 : 1)}</td>
                      {showPct && (
                        <td className="num text-ink-2">
                          {p.role_pct === undefined || p.role_pct === null
                            ? "—"
                            : Math.round(p.role_pct * 100)}
                        </td>
                      )}
                      <td className="num text-ink-2">{num(par, 0)}</td>
                      <td className="l text-[11.5px] text-ink-2">{roleBreakdown(p)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          {validation && (
            <>
              <StatTile
                standalone
                label="Points per win"
                value={num(validation.points_per_win, 1)}
              />

              <Panel title="Backtests">
                <div className="px-4 py-2">
                  <Check
                    label="Team WAR vs actual wins"
                    value={
                      validation.team_war_vs_wins_r_full_coverage ??
                      validation.team_war_vs_wins_r
                    }
                    detail={
                      validation.full_coverage_from
                        ? `${validation.full_coverage_team_seasons ?? 0} team seasons from ${validation.full_coverage_from}, when every role has a source`
                        : `${validation.team_seasons ?? 0} team seasons`
                    }
                    good={0.7}
                    ok={0.5}
                  />
                  <Check
                    label="Team WAR vs Pythagorean wins"
                    value={
                      validation.team_war_vs_pythagorean_r_full_coverage ??
                      validation.team_war_vs_pythagorean_r
                    }
                    detail="against expected wins from point differential"
                    good={0.75}
                    ok={0.55}
                  />
                  {validation.full_coverage_from && (
                    <Check
                      label="…across all seasons stored"
                      value={validation.team_war_vs_wins_r}
                      detail={`${validation.team_seasons ?? 0} team seasons; the earliest have no receiver, defensive or line value to sum`}
                      good={0.7}
                      ok={0.5}
                    />
                  )}
                  <Check
                    label="Ceiling: point differential vs wins"
                    value={validation.pythagorean_vs_wins_r}
                    detail="knows every score and still misses — nothing beats this"
                    good={0.85}
                    ok={0.7}
                  />
                  <Check
                    label="QB year over year"
                    value={validation.qb_year_over_year_r}
                    detail={
                      validation.stability_benchmarks
                        ? `passing yards repeat at ${validation.stability_benchmarks.passing_yards?.toFixed(2)}, EPA per dropback at ${validation.stability_benchmarks.epa_per_dropback?.toFixed(2)}`
                        : `${validation.qb_year_over_year_n ?? 0} paired seasons`
                    }
                    good={0.35}
                    ok={0.25}
                  />
                  <div className="text-[11px] text-ink-3 pt-2.5">
                    Read the first against the ceiling, not against 1.0.
                  </div>
                </div>
              </Panel>

              {validation.mean_war_by_position && (
                <Panel title="Positional value">
                  <div className="px-4 py-2">
                    {Object.entries(validation.mean_war_by_position).map(([pos, value]) => (
                      <div
                        key={pos}
                        className="flex items-center justify-between py-[6px] border-b border-rule last:border-0 text-[12.5px]"
                      >
                        <span className="text-ink-2">{pos}</span>
                        <b className="num">{signed(value, 2)}</b>
                      </div>
                    ))}
                    <div className="text-[11px] text-ink-3 pt-2">
                      Quarterbacks clear every position by an order of magnitude.
                    </div>
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>

    </>
  );
}

function Check({
  label,
  value,
  detail,
  good,
  ok,
}: {
  label: string;
  value: number | undefined;
  detail: string;
  good: number;
  ok: number;
}) {
  const tone =
    value === undefined ? "mid" : value >= good ? "good" : value >= ok ? "warn" : "bad";
  const color =
    tone === "good" ? "var(--pos)" : tone === "warn" ? "var(--flag)" : tone === "bad" ? "var(--neg)" : "var(--ink-3)";
  const verdict =
    tone === "good" ? "passes" : tone === "warn" ? "usable" : tone === "bad" ? "weak" : "—";

  return (
    <div className="py-2 border-b border-rule last:border-0">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-2">{label}</span>
        <span className="flex items-baseline gap-2">
          <b className="num">r = {value === undefined ? "—" : value.toFixed(2)}</b>
          <span className="tag" style={{ color, background: "transparent", padding: 0 }}>
            {verdict}
          </span>
        </span>
      </div>
      <div className="h-[6px] rounded-[2px] bg-panel-3 mt-1.5 overflow-hidden">
        <div
          className="h-full rounded-[2px]"
          style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`, background: color }}
        />
      </div>
      <div className="text-[11px] text-ink-3 mt-1">{detail}</div>
    </div>
  );
}
