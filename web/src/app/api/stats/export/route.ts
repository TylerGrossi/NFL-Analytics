import { runStatsQuery } from "@/lib/queries";
import { findGroup } from "@/lib/statColumns";

/** Same query the table runs, handed back as CSV. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const mode = p.get("mode") === "teams" ? "teams" : "players";
  const group = findGroup(mode, p.get("cat") ?? undefined);
  const season = Number(p.get("season") ?? new Date().getFullYear() - 1);

  const rows = await runStatsQuery({
    mode,
    source: group.source,
    season,
    columns: group.columns.map((c) => c.key),
    qualifierColumn: group.qualifier.column,
    qualifierMin: Number(p.get("min") ?? group.qualifier.min),
    positions: group.positions,
    position: mode === "players" ? (p.get("pos") ?? "ALL") : undefined,
    team: p.get("team") ?? "ALL",
    sort: p.get("sort") ?? group.sort,
    dir: p.get("dir") === "asc" ? "asc" : "desc",
    limit: Math.min(1000, Number(p.get("limit") ?? 50)),
  });

  const headers =
    mode === "teams"
      ? ["team", ...group.columns.map((c) => c.key)]
      : ["name", "position", "team", ...group.columns.map((c) => c.key)];

  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hashmark-${mode}-${group.key}-${season}.csv"`,
    },
  });
}
