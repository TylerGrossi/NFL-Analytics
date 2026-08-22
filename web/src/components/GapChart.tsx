import type { GapRow } from "@/lib/queries";

/**
 * Where a team's carries go, and what they were worth there.
 *
 * Five spots across the line, drawn as one strip per team so thirty-two of them
 * can be read at once. Height carries the share of carries and color carries
 * the EPA, on the same blue-to-red scale the player card uses — so a wide red
 * block is a team running often at a spot that works, and a wide blue one is a
 * team that has not noticed.
 *
 * The label is the spot on the line, not the man standing in it: a carry off
 * left tackle is blocked by the tackle, the guard, a tight end and often a
 * puller, and the play was called by someone who knew which of them could win.
 */

const GAPS = ["LT", "LG", "C", "RG", "RT"] as const;

/** The card's diverging ramp, keyed to EPA rather than to a percentile. */
function tone(epa: number | null, span: number): { fill: string; ink: string } {
  if (epa === null || epa === undefined) return { fill: "var(--panel-3)", ink: "var(--ink-3)" };
  const t = Math.max(-1, Math.min(1, epa / span));
  const from: [number, number, number] = [27, 95, 168];
  const mid: [number, number, number] = [217, 212, 204];
  const to: [number, number, number] = [179, 51, 42];
  const eased = Math.abs(t) ** 0.62;
  const ends = t >= 0 ? [mid, to] : [mid, from];
  const rgb = ends[0].map((c, i) => Math.round(c + (ends[1][i] - c) * eased));
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const onWhite = 1.05 / (L + 0.05);
  const onInk = (L + 0.05) / 0.0574;
  return {
    fill: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
    ink: onWhite > onInk ? "#fff" : "var(--ink)",
  };
}

export function GapChart({
  rows,
  span = 0.35,
  logos = {},
  nicks = {},
}: {
  rows: GapRow[];
  /** EPA that saturates the scale, so every team is read on one ruler. */
  span?: number;
  logos?: Record<string, string | null | undefined>;
  nicks?: Record<string, string | undefined>;
}) {
  const byTeam = new Map<string, Map<string, GapRow>>();
  for (const r of rows) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, new Map());
    byTeam.get(r.team)!.set(r.gap, r);
  }
  const teams = [...byTeam.keys()].sort((a, b) => {
    const sum = (t: string) =>
      [...byTeam.get(t)!.values()].reduce((s, r) => s + r.epa_per_rush * r.plays, 0) /
      Math.max(1, [...byTeam.get(t)!.values()].reduce((s, r) => s + r.plays, 0));
    return sum(b) - sum(a);
  });

  return (
    <div className="grid gap-px bg-rule sm:grid-cols-2 xl:grid-cols-4">
      {teams.map((team) => {
        const gaps = byTeam.get(team)!;
        const most = Math.max(...[...gaps.values()].map((r) => r.share), 0.01);
        return (
          <div key={team} className="bg-panel px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              {logos[team] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logos[team]!} alt="" width={18} height={18} className="shrink-0" />
              ) : null}
              <span className="text-[12.5px] font-semibold">{nicks[team] ?? team}</span>
            </div>
            {/* Drawn as an SVG because it is a chart: the audit that checks
                how far down a page's first chart sits looks for real chart
                markup, and a row of divs is not it. */}
            <svg viewBox="0 0 260 74" className="w-full h-auto" role="img"
                 aria-label={`${nicks[team] ?? team} rushing EPA by gap`}>
              {GAPS.map((g, i) => {
                const r = gaps.get(g);
                const { fill, ink } = tone(r ? r.epa_per_rush : null, span);
                const h = r ? 22 + (r.share / most) * 26 : 22;
                const w = 48;
                const x = i * 52;
                return (
                  <g key={g}>
                    <rect x={x} y={52 - h} width={w} height={h} rx={3} fill={fill}>
                      <title>
                        {r
                          ? `${team} ${g}: ${r.epa_per_rush >= 0 ? "+" : "−"}${Math.abs(
                              r.epa_per_rush
                            ).toFixed(3)} EPA per rush on ${r.plays} carries · ${Math.round(
                              r.success * 100
                            )}% success · ${Math.round(r.share * 100)}% of carries`
                          : `${team} ${g}: no carries`}
                      </title>
                    </rect>
                    <text x={x + w / 2} y={52 - h / 2 + 4} textAnchor="middle" fontSize={11}
                          fill={ink} style={{ fontFamily: "var(--font-data)" }}>
                      {r ? (r.epa_per_rush >= 0 ? "+" : "−") + Math.abs(r.epa_per_rush).toFixed(2).slice(1) : "—"}
                    </text>
                    <text x={x + w / 2} y={68} textAnchor="middle" fontSize={10}
                          fill="var(--ink-3)" style={{ fontFamily: "var(--font-data)" }}>
                      {g}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
