"use client";

import { useMemo, useState } from "react";
import type { ScatterPoint } from "@/lib/queries";

/**
 * Two metrics against each other, for teams or for players.
 *
 * The axes are the point: a fixed scatter answers one question, and the reader
 * usually arrives with a different one. Everything is computed in the browser
 * from a payload sent once, so changing an axis is instant rather than a round
 * trip — the whole season is 32 rows for teams and a few hundred for players.
 */

export type Metric = { key: string; label: string; digits?: number; invert?: boolean };

const PAD = { t: 16, r: 18, b: 42, l: 56 };
const W = 1000;
const H = 520;

function fmt(v: number, digits = 2) {
  return v.toFixed(digits).replace(/^-/, "−");
}

/** Nice round ticks, so the axis reads 0.10 rather than 0.0934. */
function ticks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = first; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function Scatter({
  points,
  metrics,
  initialX,
  initialY,
  logos = {},
  entity,
}: {
  points: ScatterPoint[];
  metrics: Metric[];
  initialX: string;
  initialY: string;
  logos?: Record<string, string | null | undefined>;
  entity: "team" | "player";
}) {
  const [xKey, setXKey] = useState(initialX);
  const [yKey, setYKey] = useState(initialY);

  const xMeta = metrics.find((m) => m.key === xKey) ?? metrics[0];
  const yMeta = metrics.find((m) => m.key === yKey) ?? metrics[1];

  const data = useMemo(() => {
    return points
      .map((p) => ({
        id: String(p.id),
        name: String(p.name),
        team: String(p.team ?? ""),
        position: p.position ? String(p.position) : undefined,
        x: Number(p[xKey]),
        y: Number(p[yKey]),
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [points, xKey, yKey]);

  const bounds = useMemo(() => {
    if (data.length === 0) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const px = (Math.max(...xs) - Math.min(...xs)) * 0.08 || 0.5;
    const py = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 0.5;
    return {
      x0: Math.min(...xs) - px,
      x1: Math.max(...xs) + px,
      y0: Math.min(...ys) - py,
      y1: Math.max(...ys) + py,
    };
  }, [data]);

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  // Metrics where less is better get their axis reversed, so "up and to the
  // right" means better on every pairing rather than only on some of them —
  // otherwise the best defense in the league plots at the bottom of the chart.
  const fx = (v: number) => (bounds.x1 === bounds.x0 ? 0.5 : (v - bounds.x0) / (bounds.x1 - bounds.x0));
  const fy = (v: number) => (bounds.y1 === bounds.y0 ? 0.5 : (v - bounds.y0) / (bounds.y1 - bounds.y0));
  const X = (v: number) => PAD.l + (xMeta.invert ? 1 - fx(v) : fx(v)) * iw;
  const Y = (v: number) => PAD.t + (1 - (yMeta.invert ? 1 - fy(v) : fy(v))) * ih;

  const meanX = data.reduce((s, d) => s + d.x, 0) / Math.max(1, data.length);
  const meanY = data.reduce((s, d) => s + d.y, 0) / Math.max(1, data.length);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="label">Horizontal</span>
          <select
            value={xKey}
            onChange={(e) => setXKey(e.target.value)}
            className="border border-rule rounded-[3px] bg-panel px-2 py-1 text-[12px] w-[210px]"
          >
            {metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="label">Vertical</span>
          <select
            value={yKey}
            onChange={(e) => setYKey(e.target.value)}
            className="border border-rule rounded-[3px] bg-panel px-2 py-1 text-[12px] w-[210px]"
          >
            {metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11.5px] text-ink-3">
          {data.length} {entity === "team" ? "teams" : "players"} · dashed lines are the average
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label={`${yMeta.label} against ${xMeta.label}`}>
        {ticks(bounds.y0, bounds.y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
            <text x={PAD.l - 8} y={Y(v) + 3.5} textAnchor="end" fontSize={11} fill="var(--ink-3)"
                  style={{ fontFamily: "var(--font-data)" }}>
              {fmt(v, yMeta.digits ?? 2)}
            </text>
          </g>
        ))}
        {ticks(bounds.x0, bounds.x1).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--rule)" />
            <text x={X(v)} y={PAD.t + ih + 16} textAnchor="middle" fontSize={11} fill="var(--ink-3)"
                  style={{ fontFamily: "var(--font-data)" }}>
              {fmt(v, xMeta.digits ?? 2)}
            </text>
          </g>
        ))}

        <line x1={X(meanX)} x2={X(meanX)} y1={PAD.t} y2={PAD.t + ih}
              stroke="var(--rule-strong)" strokeDasharray="3 3" />
        <line x1={PAD.l} x2={W - PAD.r} y1={Y(meanY)} y2={Y(meanY)}
              stroke="var(--rule-strong)" strokeDasharray="3 3" />

        {/* The arrow says which way is better, which is not always which way
            the number grows. */}
        <text x={PAD.l + iw / 2} y={H - 6} textAnchor="middle" fontSize={11.5} fill="var(--ink-2)">
          {xMeta.label}{xMeta.invert ? " (less is better) →" : " →"}
        </text>
        <text transform={`translate(14, ${PAD.t + ih / 2}) rotate(-90)`} textAnchor="middle"
              fontSize={11.5} fill="var(--ink-2)">
          {yMeta.label}{yMeta.invert ? " (less is better) →" : " →"}
        </text>

        {data.map((d) => (
          <g key={d.id}>
            {entity === "team" && logos[d.team] ? (
              <image href={logos[d.team]!} x={X(d.x) - 12} y={Y(d.y) - 12} width={24} height={24}>
                <title>{`${d.name} — ${xMeta.label} ${fmt(d.x, xMeta.digits ?? 2)}, ${yMeta.label} ${fmt(d.y, yMeta.digits ?? 2)}`}</title>
              </image>
            ) : (
              <circle cx={X(d.x)} cy={Y(d.y)} r={5} fill="var(--accent)" fillOpacity={0.75}
                      stroke="var(--panel)" strokeWidth={1.5}>
                <title>{`${d.name}${d.position ? ` (${d.position})` : ""} — ${xMeta.label} ${fmt(d.x, xMeta.digits ?? 2)}, ${yMeta.label} ${fmt(d.y, yMeta.digits ?? 2)}`}</title>
              </circle>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
