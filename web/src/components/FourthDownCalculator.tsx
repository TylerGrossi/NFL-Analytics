"use client";

import { useEffect, useState } from "react";

type Result = {
  wp_go: number;
  wp_fg: number | null;
  wp_punt: number | null;
  p_convert: number;
  p_fg: number | null;
  punt_to: number;
  kick_distance: number;
  snapped: { yardline: number; ydstogo: number; scoreDiff: number; seconds: number };
};

const QUARTERS = [
  { label: "1st", base: 2700 },
  { label: "2nd", base: 1800 },
  { label: "3rd", base: 900 },
  { label: "4th", base: 0 },
];

function fmt(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function FourthDownCalculator() {
  const [yardline, setYardline] = useState(45);
  const [ydstogo, setYdstogo] = useState(2);
  const [scoreDiff, setScoreDiff] = useState(-3);
  const [quarter, setQuarter] = useState(3); // index into QUARTERS
  const [minutes, setMinutes] = useState(6);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  const seconds = QUARTERS[quarter].base + minutes * 60;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/fourth-down?yardline=${yardline}&ydstogo=${ydstogo}&scoreDiff=${scoreDiff}&seconds=${seconds}`,
          { signal: controller.signal }
        );
        if (res.ok) setResult(await res.json());
      } catch {
        // aborted — a newer request is already in flight
      } finally {
        setLoading(false);
      }
    }, 90);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [yardline, ydstogo, scoreDiff, seconds]);

  const options = result
    ? ([
        { key: "GO FOR IT", value: result.wp_go, detail: `${fmt(result.p_convert * 100, 0)}% conversion probability` },
        {
          key: "FIELD GOAL",
          value: result.wp_fg,
          detail:
            result.wp_fg === null || result.p_fg === null
              ? `${result.kick_distance} yards · beyond field goal range`
              : `${result.kick_distance} yards · ${fmt(result.p_fg * 100, 0)}% make probability`,
        },
        {
          key: "PUNT",
          value: result.wp_punt,
          detail:
            result.wp_punt === null
              ? "not a real option this deep"
              : `opponent starts near their ${Math.round(100 - result.punt_to)}`,
        },
      ] as const)
    : [];

  const live = options.filter((o) => o.value !== null) as { key: string; value: number; detail: string }[];
  const ranked = [...live].sort((a, b) => b.value - a.value);
  const best = ranked[0];
  const gap = ranked.length > 1 ? best.value - ranked[1].value : 0;
  const verdict = gap >= 1 ? best.key : "TOSS-UP";
  const verdictColor =
    gap >= 2.5 ? "var(--pos)" : gap >= 1 ? "var(--accent)" : "var(--ink-2)";

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] items-start">
      {/* ---------------------------------------------------------- inputs */}
      {/* The derived inputs sit under the controls that produce them. They used
          to live in the right-hand column, which left the left track ending
          260px short of the right one and a hole in the middle of the page. */}
      <div className="flex flex-col gap-4">
      <div className="panel">
        <div className="panel-head">
          <h3>Situation</h3>
          <span className="text-[11px] text-ink-3">
            4th &amp; {ydstogo} · {yardline > 50 ? `own ${100 - yardline}` : `opponent ${yardline}`}
          </span>
        </div>

        <div className="p-4">
          <Field yardline={yardline} ydstogo={ydstogo} />

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 mt-5">
            <Slider
              label="Yards to go"
              value={ydstogo}
              min={1}
              max={10}
              onChange={setYdstogo}
              display={String(ydstogo)}
            />
            <Slider
              label="Yards from opponent's end zone"
              value={yardline}
              min={1}
              max={99}
              onChange={setYardline}
              display={String(yardline)}
            />
            <Slider
              label="Score differential"
              value={scoreDiff}
              min={-21}
              max={21}
              onChange={setScoreDiff}
              display={scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff < 0 ? `−${Math.abs(scoreDiff)}` : "Tied"}
            />
            <Slider
              label="Minutes left in quarter"
              value={minutes}
              min={0}
              max={15}
              onChange={setMinutes}
              display={`${minutes}:00`}
            />

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="label">Quarter</span>
              <div className="flex gap-1.5">
                {QUARTERS.map((q, i) => (
                  <button
                    key={q.label}
                    onClick={() => setQuarter(i)}
                    aria-pressed={quarter === i}
                    className={`px-3 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] transition-colors ${
                      quarter === i
                        ? "bg-navy border-navy text-white"
                        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Model inputs</h3>
          </div>
          <div className="px-4 py-2">
            {result &&
              [
                ["Conversion rate", `${fmt(result.p_convert * 100, 0)}%`],
                ["Field goal distance", `${result.kick_distance} yds`],
                [
                  "Field goal probability",
                  result.p_fg === null ? "out of range" : `${fmt(result.p_fg * 100, 0)}%`,
                ],
                ["Expected punt result", `opponent ${Math.round(100 - result.punt_to)}`],
                ["Clock", `${QUARTERS[quarter].label} · ${minutes}:00`],
                ["Timeouts", "3 / 3 (grid assumption)"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between py-[6px] border-b border-rule last:border-0 text-[12.5px]"
                >
                  <span className="text-ink-2">{k}</span>
                  <b className="num">{v}</b>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- output */}
      <div className="flex flex-col gap-4">
        <div className="panel px-4 py-5 text-center">
          <div className="label">Recommendation</div>
          <div
            className="headline text-[34px] leading-none my-1.5 tracking-[0.02em]"
            style={{ color: verdictColor, opacity: loading ? 0.55 : 1 }}
          >
            {result ? verdict : "…"}
          </div>
          <div className="num text-[12.5px] text-ink-2">
            {result && ranked.length > 1
              ? gap >= 1
                ? `+${fmt(gap)}% win probability over ${ranked[1].key.toLowerCase()}`
                : `${best.key.toLowerCase()} leads by ${fmt(gap)}% — inside the model's error`
              : " "}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Win probability by choice</h3>
          </div>
          <div className="px-4 py-2">
            {options.map((o) => {
              const isBest = best && o.key === best.key && gap >= 1;
              return (
                <div key={o.key} className="py-2 border-b border-rule last:border-0">
                  <div className="flex justify-between items-baseline text-[12.5px] mb-1.5">
                    <b className={o.value === null ? "text-ink-3" : ""}>{o.key}</b>
                    <b className="num text-[14px]">{o.value === null ? "—" : `${fmt(o.value)}%`}</b>
                  </div>
                  <div className="h-[11px] rounded-[2px] bg-panel-3 overflow-hidden">
                    <div
                      className="h-full rounded-[2px] transition-all duration-200"
                      style={{
                        width: `${Math.max(0, Math.min(100, o.value ?? 0))}%`,
                        background: isBest ? "var(--c1)" : "var(--rule-strong)",
                      }}
                    />
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1">{o.detail}</div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  display: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between items-baseline">
        <span className="label">{label}</span>
        <span className="num text-[13px] font-semibold">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}

/** Field strip: ball spot and the line to gain, drawn to scale. */
function Field({ yardline, ydstogo }: { yardline: number; ydstogo: number }) {
  // Left edge is the offense's own end zone, right edge the opponent's.
  const ballPct = 100 - yardline;
  const gainPct = Math.min(100, 100 - yardline + ydstogo);

  return (
    <div className="relative h-[62px] rounded-[3px] border border-rule bg-panel-2 overflow-hidden">
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
        <div key={y}>
          <span className="absolute inset-y-0 w-px bg-rule" style={{ left: `${y}%` }} />
          <span
            className="absolute bottom-1 -translate-x-1/2 num text-[9.5px] text-ink-3"
            style={{ left: `${y}%` }}
          >
            {y <= 50 ? y : 100 - y}
          </span>
        </div>
      ))}

      <span
        className="absolute inset-y-0 bg-[var(--accent)] opacity-[0.14]"
        style={{ left: `${ballPct}%`, width: `${Math.max(0.6, gainPct - ballPct)}%` }}
      />
      <span
        className="absolute inset-y-0 w-[2px] bg-[var(--flag)]"
        style={{ left: `${gainPct}%` }}
        title="Line to gain"
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[15px] h-[10px] rounded-[50%/45%] bg-ink border border-panel"
        style={{ left: `${ballPct}%` }}
        title="Ball"
      />
    </div>
  );
}
