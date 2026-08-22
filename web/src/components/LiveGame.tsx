"use client";

import { useEffect, useState } from "react";
import { FieldViz } from "@/components/FieldViz";
import { WinProbChart } from "@/components/WinProbChart";
import type { GameSummary, LiveState } from "@/lib/live";

type Decision = {
  wp_go: number;
  wp_fg: number | null;
  wp_punt: number | null;
  p_convert: number;
  p_fg: number | null;
  punt_to: number;
  kick_distance: number;
  isFourthDown: boolean;
  best: string | null;
  margin: number;
  snapped: { yardline: number; ydstogo: number; scoreDiff: number; seconds: number };
};

export type LivePayload = {
  game: LiveState | null;
  decision: Decision | null;
  summary: GameSummary | null;
};

const POLL_MS = 15000;

function fmt(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

const DOWNS = ["", "1st", "2nd", "3rd", "4th"];

export function LiveGame({
  eventId,
  initial,
  colors,
}: {
  eventId: string;
  initial: LivePayload;
  colors: { home: string; away: string };
}) {
  const [data, setData] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let canceled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/live/${eventId}`, { cache: "no-store" });
        if (!res.ok || canceled) return;
        const next = await res.json();
        if (!canceled) {
          setData(next);
          setUpdatedAt(new Date());
        }
      } catch {
        // transient — the next tick catches up
      }
    }
    const id = setInterval(poll, POLL_MS);
    poll();
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [eventId]);

  const { game, decision, summary } = data;
  if (!game) return null;

  const live = game.state === "in";
  const p = game.possession;
  // The call is only a real call on fourth, and a fair preview on third, where
  // a stop leaves the offense at roughly this spot. On first and second the
  // eventual fourth down happens somewhere else entirely, so we say nothing.
  const isFourth = p?.down === 4;
  const showDecision = p?.down === 3 || isFourth;
  const offenseColor = p ? (p.isHome ? colors.home : colors.away) : colors.home;
  const defenseColor = p ? (p.isHome ? colors.away : colors.home) : colors.away;

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------ scoreboard */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-rule bg-panel-2">
          <span className={`label ${live ? "!text-pos" : ""}`}>
            {live ? `● ${game.detail}` : game.detail}
          </span>
          <span className="text-[11px] text-ink-3">
            {[game.broadcast, game.venue].filter(Boolean).join(" · ")}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-4">
          <TeamBlock team={game.away} hasBall={p?.teamId === game.away.id} align="left" />
          <div className="text-center">
            <div className="num text-[34px] font-semibold leading-none tabular-nums">
              {game.away.score} <span className="text-ink-3 mx-1">–</span> {game.home.score}
            </div>
            <div className="text-[11px] text-ink-3 mt-1">{game.detail}</div>
          </div>
          <TeamBlock team={game.home} hasBall={p?.teamId === game.home.id} align="right" />
        </div>

        {p && p.yardline100 !== null && (
          <div className="px-3 pb-3">
            <FieldViz
              yardline100={p.yardline100}
              ydstogo={p.distance}
              offenseAbbr={p.abbr}
              defenseAbbr={p.isHome ? game.away.abbr : game.home.abbr}
              offenseColor={offenseColor}
              defenseColor={defenseColor}
              down={p.down}
            />
            <div className="flex items-center justify-between mt-2 text-[12px] flex-wrap gap-2">
              <span className="text-ink-2">
                <b className="text-ink">
                  {p.down ? DOWNS[p.down] : ""}
                  {p.distance !== null ? ` & ${p.distance}` : ""}
                </b>
                {p.spotText ? ` at ${p.spotText}` : ""}
              </span>
              <span className="num text-[11px] text-ink-3">
                timeouts {p.abbr} {p.timeouts} · opp {p.defenseTimeouts}
              </span>
            </div>
          </div>
        )}

        {game.lastPlay && (
          <div className="px-4 py-2.5 border-t border-rule text-[12px] text-ink-2 leading-relaxed">
            <span className="label mr-2">Last play</span>
            {game.lastPlay}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ decision */}
      {decision && p && showDecision ? (
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3>{isFourth ? "Fourth down · the call" : "If they come up short"}</h3>
            <span className="text-[11px] text-ink-3">
              4th &amp; {decision.snapped.ydstogo} · {p.spotText}
            </span>
          </div>
          <div className="p-4">
            {!isFourth && (
              <div className="text-[12px] text-ink-2 mb-3">
                Third down. If this play gains nothing, that is the call — so you have it before the
                situation arrives. A gain moves the spot and the model with it.
              </div>
            )}
            <div className="flex items-baseline gap-3 flex-wrap mb-3.5">
              <span
                className="headline text-[32px] leading-none"
                style={{
                  color:
                    decision.margin >= 2.5
                      ? "var(--pos)"
                      : decision.margin >= 1
                        ? "var(--accent)"
                        : "var(--ink-2)",
                  opacity: decision.isFourthDown ? 1 : 0.75,
                }}
              >
                {decision.margin >= 1 ? decision.best : "TOSS-UP"}
              </span>
              <span className="num text-[12.5px] text-ink-2">
                {decision.margin >= 1
                  ? `+${fmt(decision.margin)}% win probability for ${p.abbr}`
                  : `within ${fmt(decision.margin)}% — no strong opinion`}
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                { key: "GO", value: decision.wp_go, detail: `${fmt(decision.p_convert * 100, 0)}% convert` },
                {
                  key: "FIELD GOAL",
                  value: decision.wp_fg,
                  detail:
                    decision.wp_fg === null || decision.p_fg === null
                      ? `${decision.kick_distance} yds · out of range`
                      : `${decision.kick_distance} yds · ${fmt(decision.p_fg * 100, 0)}%`,
                },
                {
                  key: "PUNT",
                  value: decision.wp_punt,
                  detail:
                    decision.wp_punt === null
                      ? "not an option here"
                      : `to their ${Math.round(100 - decision.punt_to)}`,
                },
              ].map((o) => {
                const isBest = o.key === decision.best && decision.margin >= 1;
                return (
                  <div
                    key={o.key}
                    className="border border-rule rounded-[3px] px-3 py-2.5"
                    style={isBest ? { borderColor: "var(--accent)", background: "var(--accent-wash)" } : undefined}
                  >
                    <div className="label">{o.key}</div>
                    <div className="num text-[21px] font-semibold mt-0.5">
                      {o.value === null ? "—" : `${fmt(o.value)}%`}
                    </div>
                    <div className="text-[11px] text-ink-3">{o.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="px-4 py-2 border-t border-rule bg-panel-2 flex items-center justify-between text-[11px] text-ink-3">
            <span>Gridiron model · refreshed every {POLL_MS / 1000}s</span>
            <span className="num">
              {updatedAt
                ? updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
                : "…"}
            </span>
          </div>
        </div>
      ) : (
        <div className="panel px-4 py-4 text-center text-ink-3 text-[13px]">
          {game.state === "pre"
            ? "The decision model turns on at kickoff."
            : game.state === "post"
              ? "Final. Every fourth down from this game is scored in the season table."
              : p
                ? `${DOWNS[p.down ?? 1]} down — the fourth down call appears on third and fourth.`
                : "Waiting on a live possession."}
        </div>
      )}

      {/* ------------------------------------------------------ win probability */}
      {summary && summary.winProbability.length > 1 && (
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3>Win probability</h3>
            <span className="text-[11px] text-ink-3">ESPN model · {summary.winProbability.length} plays</span>
          </div>
          <div className="pt-3">
            <WinProbChart
              series={summary.winProbability}
              homeAbbr={game.home.abbr}
              awayAbbr={game.away.abbr}
              homeColor={colors.home}
              awayColor={colors.away}
              scoringIds={summary.scoringPlays.map((s) => s.id)}
            />
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ drives */}
      {summary && summary.drives.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h3>Drives</h3>
            <span className="text-[11px] text-ink-3">most recent first</span>
          </div>
          <div className="max-h-[360px] scroll-y">
            {summary.drives.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 px-4 py-2 border-b border-rule last:border-0"
              >
                {d.teamLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.teamLogo} alt="" width={18} height={18} className="shrink-0" />
                )}
                <span className="num text-[11px] text-ink-3 w-[26px] shrink-0">
                  Q{d.endPeriod ?? d.startPeriod ?? "—"}
                </span>
                <span
                  className="text-[12.5px] font-semibold w-[96px] shrink-0"
                  style={{ color: d.isScore ? "var(--pos)" : "var(--ink-2)" }}
                >
                  {d.displayResult}
                </span>
                <span className="text-[11.5px] text-ink-3 flex-1 truncate">{d.description}</span>
                <span className="num text-[11.5px] text-ink-2 shrink-0">
                  {d.plays} pl · {d.yards} yd
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamBlock({
  team,
  hasBall,
  align,
}: {
  team: { abbr: string; name: string; logo: string | null };
  hasBall: boolean;
  align: "left" | "right";
}) {
  return (
    <div className={`flex items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {team.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" width={40} height={40} className="shrink-0" />
      )}
      <div className="min-w-0">
        <div className="font-semibold text-[14px] truncate">{team.name}</div>
        <div className={`flex items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
          <span className="text-[11px] text-ink-3">{team.abbr}</span>
          {hasBall && (
            <span className="w-[12px] h-[8px] rounded-[50%/45%] bg-ink" title="Has possession" />
          )}
        </div>
      </div>
    </div>
  );
}
