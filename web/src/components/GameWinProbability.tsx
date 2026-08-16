/**
 * Win probability across a finished game, from our own play-by-play.
 *
 * The x axis is game clock, not play number, so the fourth quarter occupies a
 * quarter of the width instead of half — long drives shouldn't stretch time.
 */

export type WpPoint = {
  play_id: number;
  qtr: number;
  clock: number;
  home_wp: number;
  scoring: boolean;
  desc: string | null;
};

export function GameWinProbability({
  points,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  fourthDowns = [],
  height = 230,
}: {
  points: WpPoint[];
  homeAbbr: string;
  awayAbbr: string;
  homeColor: string;
  awayColor: string;
  fourthDowns?: { clock: number; optimal: boolean }[];
  height?: number;
}) {
  if (points.length < 2) return null;

  const W = 700;
  const H = height;
  const m = { t: 12, r: 14, b: 22, l: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  // Clock runs 3600 -> 0; overtime plays report 0 and pile at the right edge.
  const X = (clock: number) => m.l + ((3600 - Math.max(0, Math.min(3600, clock))) / 3600) * iw;
  const Y = (p: number) => m.t + ih - p * ih;

  const path = points
    .map((pt, i) => `${i ? "L" : "M"}${X(pt.clock).toFixed(1)} ${Y(pt.home_wp).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${X(points[points.length - 1].clock).toFixed(1)} ${Y(0.5)} L${X(points[0].clock).toFixed(1)} ${Y(0.5)} Z`;
  const final = points[points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Win probability">
        <defs>
          <clipPath id="gwp-above">
            <rect x={m.l} y={m.t} width={iw} height={Y(0.5) - m.t} />
          </clipPath>
          <clipPath id="gwp-below">
            <rect x={m.l} y={Y(0.5)} width={iw} height={m.t + ih - Y(0.5)} />
          </clipPath>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line
              x1={m.l}
              x2={W - m.r}
              y1={Y(p)}
              y2={Y(p)}
              stroke={p === 0.5 ? "var(--rule-strong)" : "var(--rule)"}
              strokeDasharray={p === 0.5 ? "3 3" : undefined}
            />
            <text x={m.l - 5} y={Y(p) + 3} textAnchor="end" fontSize={9.5} fill="var(--ink-3)" style={{ fontFamily: "var(--font-data)" }}>
              {Math.round(p * 100)}
            </text>
          </g>
        ))}

        {/* quarter boundaries */}
        {[2700, 1800, 900].map((c) => (
          <line key={c} x1={X(c)} x2={X(c)} y1={m.t} y2={m.t + ih} stroke="var(--rule)" />
        ))}
        {[
          ["Q1", 3150],
          ["Q2", 2250],
          ["Q3", 1350],
          ["Q4", 450],
        ].map(([label, c]) => (
          <text key={label as string} x={X(c as number)} y={H - 6} textAnchor="middle" fontSize={9.5} fill="var(--ink-3)" style={{ letterSpacing: "0.08em" }}>
            {label}
          </text>
        ))}

        <path d={area} fill={homeColor} opacity={0.18} clipPath="url(#gwp-above)" />
        <path d={area} fill={awayColor} opacity={0.18} clipPath="url(#gwp-below)" />
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />

        {/* fourth down decisions, colored by whether the model agreed */}
        {fourthDowns.map((f, i) => (
          <line
            key={i}
            x1={X(f.clock)}
            x2={X(f.clock)}
            y1={m.t}
            y2={m.t + ih}
            stroke={f.optimal ? "var(--pos)" : "var(--neg)"}
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.32}
          />
        ))}

        {points
          .filter((pt) => pt.scoring)
          .map((pt) => (
            <circle key={pt.play_id} cx={X(pt.clock)} cy={Y(pt.home_wp)} r={2.8} fill="var(--flag)" stroke="var(--panel)" strokeWidth={1}>
              <title>{pt.desc ?? "Scoring play"}</title>
            </circle>
          ))}

        <circle cx={X(final.clock)} cy={Y(final.home_wp)} r={4} fill={final.home_wp >= 0.5 ? homeColor : awayColor} stroke="var(--panel)" strokeWidth={1.8} />
      </svg>

      {/* Keys stay together: flanking the note reads as two orphans once it wraps. */}
      <div className="flex items-center justify-between px-4 pb-1 text-[11.5px] flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1.5 text-ink-2">
            <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: homeColor }} />
            {homeAbbr}
          </span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: awayColor }} />
            {awayAbbr}
          </span>
        </span>
        <span className="text-ink-3">
          gold = scoring · dashed = fourth down decision (green agreed, red not)
        </span>
      </div>
    </div>
  );
}

/** Each drive as a bar, signed by the EPA it produced. */
export function DriveChart({
  drives,
  teamColors,
  max = 8,
}: {
  drives: { drive: number; posteam: string; result: string | null; plays: number; yards: number | null; epa: number; qtr: number }[];
  teamColors: Record<string, string>;
  max?: number;
}) {
  return (
    <div className="px-4 py-2">
      {drives.map((d) => {
        const w = Math.min(Math.abs(d.epa) / max, 1) * 50;
        const positive = d.epa >= 0;
        return (
          <div key={d.drive} className="grid grid-cols-[32px_1fr_128px] items-center gap-2.5 py-[3px]">
            <span className="flex items-center gap-1.5">
              <i className="w-2.5 h-2.5 rounded-[2px] inline-block shrink-0" style={{ background: teamColors[d.posteam] ?? "var(--ink-3)" }} />
              <span className="num text-[10px] text-ink-3">Q{d.qtr}</span>
            </span>
            <span className="relative h-[13px] bg-panel-2 rounded-[2px] block">
              <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
              <span
                className="absolute inset-y-[2px] rounded-[1px]"
                style={{
                  background: positive ? "var(--c1)" : "var(--c2)",
                  left: positive ? "50%" : `${50 - w}%`,
                  width: `${Math.max(0.5, w)}%`,
                }}
                title={`${d.epa.toFixed(2)} EPA`}
              />
            </span>
            <span className="flex justify-between text-[11px] text-ink-2">
              <span className="truncate">{d.result ?? "—"}</span>
              <b className="num">{d.epa >= 0 ? "+" : "−"}{Math.abs(d.epa).toFixed(1)}</b>
            </span>
          </div>
        );
      })}
      <div className="text-[11px] text-ink-3 pt-2 text-center">
        ← EPA lost · EPA gained →
      </div>
    </div>
  );
}
