"use client";

/**
 * A football field drawn to scale, oriented so the team with the ball always
 * attacks to the right. That way the ball marker and line to gain read the same
 * way every possession, instead of flipping with the broadcast camera.
 *
 * Coordinates: 0–10 is the offense's own end zone, 10–110 the field, 110–120
 * the end zone being attacked. `yardline100` is yards from the ball to the
 * right-hand goal line.
 */

const W = 120;
const H = 44;
const EZ = 10;

export function FieldViz({
  yardline100,
  ydstogo,
  offenseAbbr,
  defenseAbbr,
  offenseColor,
  defenseColor,
  down,
}: {
  yardline100: number;
  ydstogo: number | null;
  offenseAbbr: string;
  defenseAbbr: string;
  offenseColor: string;
  defenseColor: string;
  down: number | null;
}) {
  const ballX = EZ + (100 - yardline100);
  const gainX = ydstogo === null ? null : Math.min(EZ + 100, ballX + ydstogo);
  const inRedZone = yardline100 <= 20;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      role="img"
      aria-label={`${offenseAbbr} ball on the ${yardline100} yard line, ${ydstogo ?? "?"} to go`}
    >
      {/* turf */}
      <rect x={EZ} y={0} width={100} height={H} fill="var(--panel-2)" />

      {/* red zone being attacked */}
      <rect x={EZ + 80} y={0} width={20} height={H} fill="var(--neg)" opacity={0.07} />

      {/* end zones in team colors */}
      <rect x={0} y={0} width={EZ} height={H} fill={offenseColor} opacity={0.85} />
      <rect x={EZ + 100} y={0} width={EZ} height={H} fill={defenseColor} opacity={0.85} />
      <text
        x={EZ / 2}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={5.5}
        fontWeight={700}
        transform={`rotate(-90 ${EZ / 2} ${H / 2})`}
        style={{ letterSpacing: "0.1em" }}
      >
        {offenseAbbr}
      </text>
      <text
        x={EZ + 100 + EZ / 2}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={5.5}
        fontWeight={700}
        transform={`rotate(90 ${EZ + 100 + EZ / 2} ${H / 2})`}
        style={{ letterSpacing: "0.1em" }}
      >
        {defenseAbbr}
      </text>

      {/* five yard lines, ten yard lines heavier */}
      {Array.from({ length: 21 }, (_, i) => i * 5).map((y) => {
        const x = EZ + y;
        const major = y % 10 === 0;
        return (
          <line
            key={y}
            x1={x}
            x2={x}
            y1={0}
            y2={H}
            stroke="var(--rule)"
            strokeWidth={major ? 0.35 : 0.18}
          />
        );
      })}

      {/* hash marks — the site's namesake */}
      {Array.from({ length: 99 }, (_, i) => i + 1).map((y) => (
        <g key={`h${y}`}>
          <line x1={EZ + y} x2={EZ + y} y1={H * 0.34} y2={H * 0.34 + 1.4} stroke="var(--rule-strong)" strokeWidth={0.16} />
          <line x1={EZ + y} x2={EZ + y} y1={H * 0.66 - 1.4} y2={H * 0.66} stroke="var(--rule-strong)" strokeWidth={0.16} />
        </g>
      ))}

      {/* yard numbers */}
      {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => (
        <text
          key={i}
          x={EZ + (i + 1) * 10}
          y={H - 4}
          textAnchor="middle"
          fill="var(--ink-3)"
          fontSize={4}
          style={{ fontFamily: "var(--font-data)" }}
        >
          {n}
        </text>
      ))}

      {/* distance to gain */}
      {gainX !== null && (
        <>
          <rect x={ballX} y={0} width={Math.max(0.4, gainX - ballX)} height={H} fill="var(--accent)" opacity={0.16} />
          <line x1={gainX} x2={gainX} y1={0} y2={H} stroke="var(--flag)" strokeWidth={0.6}>
            <title>Line to gain</title>
          </line>
        </>
      )}

      {/* line of scrimmage + ball */}
      <line x1={ballX} x2={ballX} y1={0} y2={H} stroke="var(--ink)" strokeWidth={0.5} opacity={0.65} />
      <ellipse cx={ballX} cy={H / 2} rx={2.2} ry={1.4} fill="var(--ink)" stroke="#fff" strokeWidth={0.4}>
        <title>{`Ball on the ${yardline100}`}</title>
      </ellipse>

      {/* direction of attack */}
      <path
        d={`M${ballX + 4} ${H / 2} L${ballX + 8} ${H / 2}`}
        stroke="var(--ink-3)"
        strokeWidth={0.5}
        markerEnd="url(#arrow)"
        opacity={0.8}
      />
      <defs>
        <marker id="arrow" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="var(--ink-3)" />
        </marker>
      </defs>

      {inRedZone && (
        <text x={EZ + 90} y={5.5} textAnchor="middle" fill="var(--neg)" fontSize={3.4} style={{ letterSpacing: "0.1em" }}>
          RED ZONE
        </text>
      )}

      {down !== null && (
        <text x={ballX} y={5} textAnchor="middle" fill="var(--ink)" fontSize={4} fontWeight={700}>
          {["", "1st", "2nd", "3rd", "4th"][down] ?? ""}
          {ydstogo !== null ? ` & ${ydstogo}` : ""}
        </text>
      )}
    </svg>
  );
}
