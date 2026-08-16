"use client";

/**
 * Live win probability, plotted from ESPN's per-play series.
 *
 * One line, not two: the chart is the home team's win probability, and the
 * away team's is its mirror image. Drawing both would double the ink to say the
 * same thing. The band above the 50% rule is shaded in the leading team's color
 * so a glance tells you who is winning.
 */

export function WinProbChart({
  series,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  scoringIds = [],
  height = 190,
}: {
  series: { homeWin: number; playId: string }[];
  homeAbbr: string;
  awayAbbr: string;
  homeColor: string;
  awayColor: string;
  scoringIds?: string[];
  height?: number;
}) {
  if (series.length < 2) {
    return (
      <div className="px-4 py-8 text-center text-ink-3 text-[13px]">
        Win probability starts once the game does.
      </div>
    );
  }

  const W = 640;
  const H = height;
  const m = { t: 10, r: 10, b: 18, l: 32 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const X = (i: number) => m.l + (i * iw) / (series.length - 1);
  const Y = (p: number) => m.t + ih - p * ih;

  const line = series
    .map((s, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(s.homeWin).toFixed(1)}`)
    .join(" ");

  const last = series[series.length - 1];
  const homeLeading = last.homeWin >= 0.5;
  const scoringSet = new Set(scoringIds);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Win probability">
        <defs>
          {/* Fill above the midline in home colors, below in away colors. */}
          <clipPath id="wp-above">
            <rect x={m.l} y={m.t} width={iw} height={Y(0.5) - m.t} />
          </clipPath>
          <clipPath id="wp-below">
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
            <text
              x={m.l - 5}
              y={Y(p) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--ink-3)"
              style={{ fontFamily: "var(--font-data)" }}
            >
              {p === 0.5 ? "50" : Math.round(p * 100)}
            </text>
          </g>
        ))}

        <path
          d={`${line} L${X(series.length - 1)} ${Y(0.5)} L${X(0)} ${Y(0.5)} Z`}
          fill={homeColor}
          opacity={0.18}
          clipPath="url(#wp-above)"
        />
        <path
          d={`${line} L${X(series.length - 1)} ${Y(0.5)} L${X(0)} ${Y(0.5)} Z`}
          fill={awayColor}
          opacity={0.18}
          clipPath="url(#wp-below)"
        />

        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" />

        {series.map((s, i) =>
          scoringSet.has(s.playId) ? (
            <circle key={s.playId} cx={X(i)} cy={Y(s.homeWin)} r={2.6} fill="var(--flag)" stroke="var(--panel)" strokeWidth={1}>
              <title>Scoring play</title>
            </circle>
          ) : null
        )}

        <circle
          cx={X(series.length - 1)}
          cy={Y(last.homeWin)}
          r={4}
          fill={homeLeading ? homeColor : awayColor}
          stroke="var(--panel)"
          strokeWidth={1.8}
        />
      </svg>

      <div className="flex items-center justify-between px-4 pb-1 text-[11.5px]">
        <span className="flex items-center gap-1.5 text-ink-2">
          <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: homeColor }} />
          {homeAbbr} {Math.round(last.homeWin * 100)}%
        </span>
        <span className="text-ink-3">gold marks are scoring plays</span>
        <span className="flex items-center gap-1.5 text-ink-2">
          {awayAbbr} {Math.round((1 - last.homeWin) * 100)}%
          <i className="w-2.5 h-2.5 rounded-[2px] inline-block" style={{ background: awayColor }} />
        </span>
      </div>
    </div>
  );
}
