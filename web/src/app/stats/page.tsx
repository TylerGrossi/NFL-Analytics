import Link from "next/link";
import { Empty, Panel, SectionRule, TeamMark } from "@/components/ui";
import { SeasonNav } from "@/components/SeasonNav";
import { getManifest, getTeamMap, runStatsQuery } from "@/lib/queries";
import { findGroup, groupsFor, type Fmt, type StatColumn } from "@/lib/statColumns";
import { int, num, pct, pts, signed } from "@/lib/format";

export const metadata = { title: "Stats" };
export const revalidate = 300;

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P"];
const LIMITS = [25, 50, 100, 250];

function render(value: unknown, fmt: Fmt): string {
  const v = value as number | null;
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "int": return int(v);
    case "num1": return num(v, 1);
    case "num2": return num(v, 2);
    case "num3": return num(v, 3);
    case "pct": return pct(v, 1);
    case "pct0": return pct(v, 0);
    case "signed": return signed(v, 3);
    case "signed1": return signed(v, 1);
    case "signed2": return signed(v, 2);
    case "pts": return pts(v, 1);
    default: return String(value ?? "—");
  }
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();

  const mode = sp.mode === "teams" ? "teams" : "players";
  const group = findGroup(mode, sp.cat);
  const season = Number(sp.season ?? manifest.stats_season);
  const sort = group.columns.some((c) => c.key === sp.sort) ? sp.sort! : group.sort;
  const sortCol = group.columns.find((c) => c.key === sort);
  const dir: "asc" | "desc" =
    sp.dir === "asc" || sp.dir === "desc"
      ? (sp.dir as "asc" | "desc")
      : sortCol?.lowerBetter
        ? "asc"
        : "desc";
  const position = sp.pos ?? "ALL";
  const team = sp.team ?? "ALL";
  const min = sp.min !== undefined ? Number(sp.min) : group.qualifier.min;
  const limit = LIMITS.includes(Number(sp.limit)) ? Number(sp.limit) : 50;

  const [rows, teams] = await Promise.all([
    runStatsQuery({
      mode,
      source: group.source,
      season,
      columns: group.columns.map((c) => c.key),
      qualifierColumn: group.qualifier.column,
      qualifierMin: Number.isFinite(min) ? min : group.qualifier.min,
      positions: group.positions,
      position: mode === "players" ? position : undefined,
      team,
      sort,
      dir,
      limit,
    }),
    getTeamMap(),
  ]);

  const href = (patch: Record<string, string | number | undefined>) => {
    const base: Record<string, string> = {
      mode,
      cat: group.key,
      season: String(season),
      pos: position,
      team,
      min: String(min),
      limit: String(limit),
      sort,
      dir,
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete base[k];
      else base[k] = String(v);
    }
    return `/stats?${new URLSearchParams(base).toString()}`;
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-[3px] border text-[12px] no-underline whitespace-nowrap shrink-0 transition-colors ${
      active
        ? "bg-navy border-navy text-white"
        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
    }`;

  return (
    <>
      <SectionRule aside={`${rows.length} rows · ${season}`}>Stats</SectionRule>

      <SeasonNav
        seasons={manifest.seasons}
        active={season}
        href={(s) => href({ season: s })}
      />

      {/* ------------------------------------------------------------ filters */}
      <div className="panel px-3.5 py-3 mb-4 flex flex-col gap-2.5">
        <div className="flex gap-4 flex-wrap items-center">
          <div className="flex gap-1.5 items-center">
            <span className="label">Table</span>
            {(["players", "teams"] as const).map((m) => (
              <Link
                key={m}
                href={`/stats?mode=${m}&season=${season}`}
                className={chip(m === mode)}
              >
                {m === "players" ? "Players" : "Teams"}
              </Link>
            ))}
          </div>

          <div className="flex gap-1.5 items-center flex-wrap">
            <span className="label">Category</span>
            {groupsFor(mode).map((g) => (
              <Link
                key={g.key}
                href={`/stats?mode=${mode}&cat=${g.key}&season=${season}`}
                className={chip(g.key === group.key)}
              >
                {g.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex gap-4 flex-wrap items-center">

          {mode === "players" && (
            <div className="flex gap-1 items-center flex-wrap">
              <span className="label">Position</span>
              {POSITIONS.map((p) => (
                <Link key={p} href={href({ pos: p })} className={chip(p === position)}>
                  {p === "ALL" ? "All" : p}
                </Link>
              ))}
            </div>
          )}

          <div className="flex gap-1 items-center">
            <span className="label">Rows</span>
            {LIMITS.map((l) => (
              <Link key={l} href={href({ limit: l })} className={`num ${chip(l === limit)}`}>
                {l}
              </Link>
            ))}
          </div>

          <div className="flex gap-1 items-center">
            <span className="label">Min {group.qualifier.label}</span>
            {[0, group.qualifier.min, group.qualifier.min * 2].map((m) => (
              <Link key={m} href={href({ min: m })} className={`num ${chip(m === min)}`}>
                {m}
              </Link>
            ))}
          </div>

          <div className="flex-1" />
          <Link href="/leaders" className="text-[12px] text-accent no-underline">
            Curated leaderboards
          </Link>
          <Link
            href={`/api/stats/export?${new URLSearchParams({
              mode, cat: group.key, season: String(season), pos: position,
              team, min: String(min), limit: String(limit), sort, dir,
            }).toString()}`}
            className="text-[12px] text-accent no-underline"
          >
            Download CSV
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------ table */}
      <Panel
        title={`${group.label} · ${mode === "teams" ? "teams" : "players"}`}
        meta={`sorted by ${sortCol?.label ?? sort} ${dir === "asc" ? "ascending" : "descending"}`}
      >
        {rows.length === 0 ? (
          <Empty>Nothing clears the qualifier for this combination.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">{mode === "teams" ? "Team" : "Player"}</th>
                  {mode === "players" && <th className="l">Pos</th>}
                  {mode === "players" && <th className="l">Tm</th>}
                  {group.columns.map((c) => (
                    <SortHeader key={c.key} col={c} active={c.key === sort} dir={dir} href={href} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={String(r.player_id ?? r.team ?? i)}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="l">
                      {mode === "teams" ? (
                        <TeamMark
                          team={String(r.team)}
                          logo={teams[String(r.team)]?.logo}
                          href={`/teams/${r.team}`}
                          name={teams[String(r.team)]?.nick ?? String(r.team)}
                        />
                      ) : (
                        <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                          {String(r.name ?? r.player_id)}
                        </Link>
                      )}
                    </td>
                    {mode === "players" && (
                      <td className="l text-ink-3 text-[11.5px]">{String(r.position ?? "—")}</td>
                    )}
                    {mode === "players" && (
                      <td className="l">
                        {r.team && (
                          <TeamMark
                            team={String(r.team)}
                            logo={teams[String(r.team)]?.logo}
                            size={16}
                            showAbbr={false}
                            href={`/teams/${r.team}`}
                          />
                        )}
                      </td>
                    )}
                    {group.columns.map((c) => (
                      <td
                        key={c.key}
                        className={`num ${c.key === sort ? "font-semibold" : "text-ink-2"}`}
                      >
                        {render(r[c.key], c.fmt)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="text-[11.5px] text-ink-3 mt-3 max-w-[86ch] leading-relaxed">
        Every column here comes from the built parquet store, so a filter is a real query rather
        than a precomputed page. Counting stats are league official via nflverse; EPA, success rate
        and per-play rates are computed from play-by-play; separation, cushion, time to throw and
        yards over expected come from Next Gen Stats and start in 2016.
      </div>
    </>
  );
}

function SortHeader({
  col,
  active,
  dir,
  href,
}: {
  col: StatColumn;
  active: boolean;
  dir: "asc" | "desc";
  href: (patch: Record<string, string | number | undefined>) => string;
}) {
  // Clicking the active column flips it; a new column starts in its natural
  // direction, so "fewest interceptions" doesn't open as "most".
  const next = active ? (dir === "desc" ? "asc" : "desc") : col.lowerBetter ? "asc" : "desc";
  return (
    <th title={col.title}>
      <Link
        href={href({ sort: col.key, dir: next })}
        className="no-underline text-inherit hover:text-accent whitespace-nowrap"
      >
        {col.label}
        {active && <span className="ml-0.5">{dir === "desc" ? "▾" : "▴"}</span>}
      </Link>
    </th>
  );
}
