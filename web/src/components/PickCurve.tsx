import type { DraftCurvePoint } from "@/lib/queries";

/**
 * What a pick returns, by slot.
 *
 * The raw per-pick averages are plotted underneath the fitted curve rather than
 * hidden, because the fit is the claim and the scatter is the evidence for it —
 * about twenty players sit behind each pick number, so the raw line is noisy
 * enough that a smooth curve drawn alone would overstate how much is known.
 */
export function PickCurve({
  points,
  width = 720,
  height = 300,
}: {
  points: DraftCurvePoint[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const m = { t: 14, r: 14, b: 34, l: 44 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const maxPick = Math.max(...points.map((p) => p.pick));
  const maxVal = Math.max(...points.map((p) => Math.max(p.raw_value, p.value)));

  const X = (v: number) => m.l + (v / maxPick) * iw;
  const Y = (v: number) => m.t + ih - (v / maxVal) * ih;

  const fitted = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${X(p.pick).toFixed(1)},${Y(p.value).toFixed(1)}`)
    .join(" ");

  const roundStarts = [33, 65, 106, 150, 190, 225].filter((v) => v < maxPick);
  const yTicks = [0, 10, 20, 30, 40, 50, 60].filter((v) => v <= maxVal);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Career value produced by draft slot"
    >
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={width - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
          <text
            x={m.l - 6}
            y={Y(v) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--ink-3)"
            style={{ fontFamily: "var(--font-data)" }}
          >
            {v}
          </text>
        </g>
      ))}

      {/* Round boundaries, so a slot can be read as "early third" not just "#70". */}
      {roundStarts.map((v, i) => (
        <g key={v}>
          <line
            x1={X(v)}
            x2={X(v)}
            y1={m.t}
            y2={m.t + ih}
            stroke="var(--rule-strong)"
            strokeDasharray="2 3"
            opacity={0.7}
          />
          <text x={X(v) + 3} y={m.t + 10} fontSize={9} fill="var(--ink-3)">
            R{i + 2}
          </text>
        </g>
      ))}

      {points.map((p) => (
        <circle
          key={p.pick}
          cx={X(p.pick)}
          cy={Y(p.raw_value)}
          r={1.8}
          fill="var(--ink-3)"
          opacity={0.42}
        >
          <title>{`Pick ${p.pick} — ${p.raw_value.toFixed(1)} AV average over ${p.n} players`}</title>
        </circle>
      ))}

      <path d={fitted} fill="none" stroke="var(--accent)" strokeWidth={2.2} />

      <text
        x={m.l + iw / 2}
        y={height - 3}
        textAnchor="middle"
        fontSize={10}
        fill="var(--ink-3)"
        style={{ letterSpacing: "0.01em" }}
      >
        Pick →
      </text>
      <text
        transform={`translate(11, ${m.t + ih / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={10}
        fill="var(--ink-3)"
        style={{ letterSpacing: "0.01em" }}
      >
        Career AV
      </text>
    </svg>
  );
}
