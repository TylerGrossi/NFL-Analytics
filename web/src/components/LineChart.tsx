/**
 * Server-rendered SVG line chart. No client bundle, no chart library.
 * Each point carries a <title> so the browser gives a native tooltip.
 */

export type Series = {
  name: string;
  color: string;
  values: (number | null)[];
  fill?: boolean;
};

export function LineChart({
  series,
  labels,
  height = 200,
  width = 620,
  yMin,
  yMax,
  zeroLine = true,
  format = (v: number) => v.toFixed(2),
}: {
  series: Series[];
  labels: string[];
  height?: number;
  width?: number;
  yMin?: number;
  yMax?: number;
  zeroLine?: boolean;
  format?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (all.length === 0) return null;

  const pad = (Math.max(...all) - Math.min(...all)) * 0.15 || 0.05;
  const lo = yMin ?? Math.min(...all) - pad;
  const hi = yMax ?? Math.max(...all) + pad;

  // One series needs no legend — the panel title says what it is. Two or more
  // are unreadable without one, so reserve a strip at the top for it.
  const showLegend = series.length > 1;
  const m = { t: showLegend ? 26 : 10, r: 12, b: 22, l: 42 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const n = labels.length;

  const X = (i: number) => m.l + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const Y = (v: number) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * k) / 4);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label={series.map((s) => s.name).join(" and ")}
    >
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={m.l} x2={width - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" strokeWidth={1} />
          <text
            x={m.l - 6}
            y={Y(v) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--ink-3)"
            style={{ fontFamily: "var(--font-data)" }}
          >
            {format(v)}
          </text>
        </g>
      ))}

      {zeroLine && lo < 0 && hi > 0 && (
        <line
          x1={m.l}
          x2={width - m.r}
          y1={Y(0)}
          y2={Y(0)}
          stroke="var(--rule-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {series.map((s) => {
        const pts = s.values
          .map((v, i) => (v === null ? null : ([X(i), Y(v)] as const)))
          .filter((p): p is readonly [number, number] => p !== null);
        if (pts.length === 0) return null;
        const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
        return (
          <g key={s.name}>
            {s.fill && (
              <path
                d={`${d} L${pts[pts.length - 1][0]} ${Y(lo)} L${pts[0][0]} ${Y(lo)} Z`}
                fill={s.color}
                opacity={0.08}
              />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={X(i)} cy={Y(v)} r={3} fill={s.color} stroke="var(--panel)" strokeWidth={1.5}>
                  <title>{`${s.name} · ${labels[i]}: ${format(v)}`}</title>
                </circle>
              )
            )}
          </g>
        );
      })}

      {labels.map((l, i) =>
        n <= 20 || i % Math.ceil(n / 12) === 0 ? (
          <text
            key={i}
            x={X(i)}
            y={height - 6}
            textAnchor="middle"
            fontSize={10}
            fill="var(--ink-3)"
            style={{ fontFamily: "var(--font-data)" }}
          >
            {l}
          </text>
        ) : null
      )}
      {showLegend &&
        series.map((s, k) => {
          const x = m.l + k * 150;
          return (
            <g key={`legend-${s.name}`}>
              <line
                x1={x}
                x2={x + 16}
                y1={11}
                y2={11}
                stroke={s.color}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <text x={x + 22} y={14} fontSize={10.5} fill="var(--ink-2)">
                {s.name}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** Team efficiency quadrant: offense on x, defense on y, better = up and right. */
export function Quadrant({
  points,
  width = 620,
  height = 460,
}: {
  points: { team: string; x: number; y: number; color: string; logo?: string | null }[];
  width?: number;
  height?: number;
}) {
  const m = { t: 16, r: 18, b: 38, l: 50 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.12;
  const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.12;
  const x0 = Math.min(...xs) - xPad;
  const x1 = Math.max(...xs) + xPad;
  const y0 = Math.min(...ys) - yPad;
  const y1 = Math.max(...ys) + yPad;

  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * iw;
  // Defensive EPA allowed: lower is better, so a smaller value sits higher.
  const Y = (v: number) => m.t + ((v - y0) / (y1 - y0)) * ih;

  const xTicks = [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2].filter((v) => v > x0 && v < x1);
  const yTicks = [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15].filter((v) => v > y0 && v < y1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Team efficiency quadrant">
      {xTicks.map((v) => (
        <g key={`x${v}`}>
          <line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ih} stroke="var(--rule)" />
          <text x={X(v)} y={m.t + ih + 14} textAnchor="middle" fontSize={10} fill="var(--ink-3)" style={{ fontFamily: "var(--font-data)" }}>
            {v.toFixed(2)}
          </text>
        </g>
      ))}
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={m.l} x2={width - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
          <text x={m.l - 6} y={Y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-3)" style={{ fontFamily: "var(--font-data)" }}>
            {v.toFixed(2)}
          </text>
        </g>
      ))}

      <line x1={X(0)} x2={X(0)} y1={m.t} y2={m.t + ih} stroke="var(--rule-strong)" strokeDasharray="3 3" />
      <line x1={m.l} x2={width - m.r} y1={Y(0)} y2={Y(0)} stroke="var(--rule-strong)" strokeDasharray="3 3" />

      <text x={width - m.r - 4} y={m.t + 12} textAnchor="end" fontSize={10} fill="var(--ink-3)" style={{ letterSpacing: "0.01em" }}>
        Good offense · good defense
      </text>
      <text x={m.l + 4} y={m.t + ih - 5} fontSize={10} fill="var(--ink-3)" style={{ letterSpacing: "0.01em" }}>
        Bad offense · bad defense
      </text>
      <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--ink-3)" style={{ letterSpacing: "0.01em" }}>
        Offense EPA / play →
      </text>
      <text
        transform={`translate(12, ${m.t + ih / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={10}
        fill="var(--ink-3)"
        style={{ letterSpacing: "0.01em" }}
      >
        Defense EPA allowed (top = better)
      </text>

      {points.map((p) => (
        <g key={p.team}>
          {p.logo ? (
            <image href={p.logo} x={X(p.x) - 11} y={Y(p.y) - 11} width={22} height={22}>
              <title>{`${p.team} — offense ${p.x.toFixed(3)}, defense ${p.y.toFixed(3)}`}</title>
            </image>
          ) : (
            <>
              <circle cx={X(p.x)} cy={Y(p.y)} r={12} fill={p.color} stroke="var(--panel)" strokeWidth={2}>
                <title>{`${p.team} — offense ${p.x.toFixed(3)}, defense ${p.y.toFixed(3)}`}</title>
              </circle>
              <text x={X(p.x)} y={Y(p.y) + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" pointerEvents="none">
                {p.team}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
