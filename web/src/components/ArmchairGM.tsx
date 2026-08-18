"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CapRow, DepthChartRow } from "@/lib/queries";

type Move = "keep" | "cut" | "restructure";

function money(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(digits)}M`;
}

/** Depth chart positions in the order a coach would read them, by unit. */
const UNITS: { name: string; positions: string[] }[] = [
  { name: "Offense", positions: ["QB", "RB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"] },
  {
    name: "Defense",
    positions: ["LDE", "LDT", "NT", "RDT", "RDE", "SLB", "MLB", "LILB", "RILB", "WLB",
      "LCB", "NB", "RCB", "FS", "SS"],
  },
  { name: "Specialists", positions: ["PK", "P", "LS", "KR", "PR"] },
];

/** Short chip for an injury designation: the letter plus the measured play odds. */
function injuryChip(status: string | null, pPlay: number | null): string | null {
  if (!status || status === "None") return null;
  const letter = status === "Questionable" ? "Q" : status === "Doubtful" ? "D" : "OUT";
  return pPlay === null ? letter : `${letter} ${Math.round(pPlay * 100)}%`;
}

function injuryTone(status: string | null): string {
  if (status === "Out" || status === "Doubtful") return "var(--neg)";
  if (status === "Questionable") return "var(--flag)";
  return "var(--ink-3)";
}

/**
 * The cap sheet as a working document: cut or restructure anyone and every
 * total moves with it. Cut math uses real accounting — remaining proration
 * accelerates, guaranteed salary stays owed — so releasing a heavily prorated
 * contract correctly *costs* you room instead of creating it.
 *
 * The depth chart underneath answers the question the money alone cannot: who
 * actually plays on Sunday after the move. Cut a starter and the next man up
 * is promoted in place, with the value you just handed the job to.
 */
export function ArmchairGM({
  rows,
  depth,
  capLimit,
  team,
  season,
  warSeason,
}: {
  rows: CapRow[];
  depth: DepthChartRow[];
  capLimit: number;
  team: string;
  season: number;
  warSeason: number;
}) {
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [sort, setSort] = useState<"cap" | "value" | "savings">("cap");

  // Key off object identity rather than array position: the table re-sorts and
  // a positional key would stop matching the row it was made for.
  const keys = useMemo(
    () => new Map(rows.map((r, i) => [r, `${r.player_id ?? r.player}-${i}`] as const)),
    [rows]
  );
  const key = (r: CapRow) => keys.get(r) ?? `${r.player_id ?? r.player}`;

  const { committed, dead, totalPar, freed, cutIds, startersCut } = useMemo(() => {
    let committed = 0;
    let dead = 0;
    let totalPar = 0;
    let freed = 0;
    let startersCut = 0;
    const cutIds = new Set<string>();
    rows.forEach((r) => {
      const move = moves[key(r)] ?? "keep";
      if (move === "cut") {
        committed += r.dead_if_cut;
        dead += r.dead_if_cut;
        freed += r.cut_savings;
        if (r.player_id) cutIds.add(r.player_id);
        if (r.depth_rank === 1) startersCut += 1;
      } else if (move === "restructure") {
        committed += r.cap_hit - r.restructure_savings;
        freed += r.restructure_savings;
        totalPar += r.par ?? 0;
      } else {
        committed += r.cap_hit;
        totalPar += r.par ?? 0;
      }
    });
    return { committed, dead, totalPar, freed, cutIds, startersCut };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves, rows, keys]);

  const space = capLimit - committed;

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "value") {
      copy.sort(
        (a, b) =>
          (b.par ?? -999) / Math.max(b.cap_hit, 1) - (a.par ?? -999) / Math.max(a.cap_hit, 1)
      );
    } else if (sort === "savings") {
      copy.sort((a, b) => b.cut_savings - a.cut_savings);
    }
    return copy;
  }, [rows, sort]);

  const setMove = (k: string, move: Move) =>
    setMoves((m) => ({ ...m, [k]: m[k] === move ? "keep" : move }));

  const changed = Object.values(moves).filter((m) => m !== "keep").length;

  return (
    <>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))] mb-4">
        <Tile
          label="Cap space"
          value={money(space)}
          tone={space < 0 ? "bad" : "good"}
        />
        <Tile label="Committed" value={money(committed)} />
        <Tile label="Dead money" value={money(dead)} />
        <Tile label="Freed" value={money(freed)} />
        <Tile
          label="Roster PAR"
          value={totalPar.toFixed(0)}
        />
        <Tile
          label="PAR per $10M"
          value={committed > 0 ? ((totalPar / committed) * 10).toFixed(1) : "—"}
        />
        {depth.length > 0 && (
          <Tile
            label="Starters cut"
            value={String(startersCut)}
            tone={startersCut > 0 ? "bad" : undefined}
          />
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-head">
          <h3>
            {team} cap sheet · {season}
          </h3>
          <div className="flex gap-1.5 items-center">
            {(["cap", "value", "savings"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                aria-pressed={sort === s}
                className={`px-2 py-0.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[11px] transition-colors ${
                  sort === s
                    ? "bg-navy border-navy text-white"
                    : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
                }`}
              >
                {s === "cap" ? "Cap hit" : s === "value" ? "Value" : "Cut savings"}
              </button>
            ))}
            {changed > 0 && (
              <button
                onClick={() => setMoves({})}
                className="px-2 py-0.5 rounded-[3px] border whitespace-nowrap shrink-0 border-rule text-[11px] text-ink-2 hover:border-rule-strong ml-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th className="l">Depth</th>
                <th>Yrs</th>
                <th>Cap hit</th>
                <th>Base</th>
                <th>Dead if cut</th>
                <th>Cut saves</th>
                <th>Restr. saves</th>
                <th>PAR</th>
                <th>PAR/$10M</th>
                <th className="l">Move</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const k = key(r);
                const move = moves[k] ?? "keep";
                const perTen = r.par !== null && r.cap_hit > 0 ? (r.par / r.cap_hit) * 10 : null;
                const chip = injuryChip(r.status, r.p_play);
                return (
                  <tr key={k} style={move === "cut" ? { opacity: 0.5 } : undefined}>
                    <td className="l">
                      {r.player_id ? (
                        <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                          {r.player}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.player}</span>
                      )}
                      {chip && (
                        <span
                          className="ml-1.5 text-[10px] font-medium"
                          style={{ color: injuryTone(r.status) }}
                          title={r.injury ?? undefined}
                        >
                          {chip}
                        </span>
                      )}
                    </td>
                    <td className="l text-ink-3 text-[11.5px]">{r.position}</td>
                    <td className="l text-[11.5px]">
                      {r.depth_pos ? (
                        <span className={r.depth_rank === 1 ? "font-semibold" : "text-ink-3"}>
                          {r.depth_pos}
                          {r.depth_rank}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="num text-ink-3">{r.years_remaining}</td>
                    <td className="num font-semibold">
                      {money(
                        move === "cut"
                          ? r.dead_if_cut
                          : move === "restructure"
                            ? r.cap_hit - r.restructure_savings
                            : r.cap_hit
                      )}
                    </td>
                    <td className="num text-ink-2">{money(r.base_salary)}</td>
                    <td className="num text-ink-2">{money(r.dead_if_cut)}</td>
                    <td
                      className="num"
                      style={{ color: r.cut_savings > 0 ? "var(--pos)" : "var(--neg)" }}
                    >
                      {money(r.cut_savings)}
                    </td>
                    <td className="num text-ink-2">
                      {r.restructure_savings > 0.05 ? money(r.restructure_savings) : "—"}
                    </td>
                    <td className="num text-ink-2">{r.par !== null ? r.par.toFixed(0) : "—"}</td>
                    <td
                      className="num"
                      style={{
                        color:
                          perTen === null
                            ? undefined
                            : perTen >= 3
                              ? "var(--pos)"
                              : perTen < 0
                                ? "var(--neg)"
                                : undefined,
                      }}
                    >
                      {perTen === null ? "—" : perTen.toFixed(1)}
                    </td>
                    <td className="l">
                      <span className="flex gap-1">
                        <button
                          onClick={() => setMove(k, "cut")}
                          className={`btn-move ${move === "cut" ? "is-cut" : ""}`}
                        >
                          Cut
                        </button>
                        <button
                          onClick={() => setMove(k, "restructure")}
                          disabled={r.restructure_savings <= 0.05}
                          className={`btn-move ${move === "restructure" ? "is-restr" : ""}`}
                          style={r.restructure_savings <= 0.05 ? { opacity: 0.35 } : undefined}
                        >
                          Restr
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {depth.length > 0 && <DepthBoard depth={depth} cutIds={cutIds} warSeason={warSeason} />}

      <style>{`
        .btn-move {
          border: 1px solid var(--rule);
          background: var(--panel);
          border-radius: 3px;
          padding: 1px 7px;
          font-size: 11px;
          color: var(--ink-2);
          transition: 0.14s;
        }
        .btn-move:hover:not(:disabled) { border-color: var(--rule-strong); }
        .btn-move.is-cut {
          background: var(--neg-wash);
          border-color: var(--neg);
          color: var(--neg);
        }
        .btn-move.is-restr {
          background: var(--accent-wash);
          border-color: var(--accent);
          color: var(--accent);
        }
      `}</style>
    </>
  );
}

/**
 * The depth chart, reacting to the cap sheet above it.
 *
 * A cut player stays visible but struck through, because the useful information
 * is not that he is gone — it is who is standing behind him and what that costs
 * the position.
 */
function DepthBoard({
  depth,
  cutIds,
  warSeason,
}: {
  depth: DepthChartRow[];
  cutIds: Set<string>;
  warSeason: number;
}) {
  const asOf = depth[0]?.depth_as_of?.slice(0, 10) ?? null;

  const byPos = useMemo(() => {
    const m = new Map<string, DepthChartRow[]>();
    for (const r of depth) {
      const list = m.get(r.depth_pos);
      if (list) list.push(r);
      else m.set(r.depth_pos, [r]);
    }
    for (const list of m.values()) list.sort((a, b) => a.depth_rank - b.depth_rank);
    return m;
  }, [depth]);

  const known = new Set(UNITS.flatMap((u) => u.positions));
  const units = UNITS.map((u) => ({
    name: u.name,
    positions: u.positions.filter((p) => byPos.has(p)),
  })).filter((u) => u.positions.length > 0);
  const other = [...byPos.keys()].filter((p) => !known.has(p)).sort();
  if (other.length) units.push({ name: "Other", positions: other });

  // What the cuts cost, in the currency the rest of the page already uses.
  const holes = useMemo(() => {
    const out: { pos: string; lost: DepthChartRow; next: DepthChartRow | null }[] = [];
    for (const [pos, list] of byPos) {
      const starter = list[0];
      if (!starter || !cutIds.has(starter.player_id)) continue;
      const next = list.find((r) => !cutIds.has(r.player_id)) ?? null;
      out.push({ pos, lost: starter, next });
    }
    return out.sort((a, b) => (b.lost.par ?? 0) - (a.lost.par ?? 0));
  }, [byPos, cutIds]);

  const parLost = holes.reduce(
    (sum, h) => sum + ((h.lost.par ?? 0) - (h.next?.par ?? 0)),
    0
  );

  return (
    <div className="panel overflow-hidden mt-4">
      <div className="panel-head">
        <h3>Depth chart</h3>
        <span className="text-[11px] text-ink-3">
          {asOf ? `as of ${asOf}` : "latest published"} · PAR from {warSeason}
        </span>
      </div>

      {holes.length > 0 && (
        <div className="px-4 py-3 border-b border-rule">
          <div className="label mb-1.5">
            {holes.length} starting {holes.length === 1 ? "job" : "jobs"} opened ·{" "}
            <span style={{ color: parLost > 0 ? "var(--neg)" : "var(--pos)" }}>
              {parLost > 0 ? "−" : "+"}
              {Math.abs(parLost).toFixed(0)} PAR
            </span>{" "}
            against the next man up
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            {holes.map((h) => (
              <span key={h.pos} className="shrink-0">
                <span className="text-ink-3">{h.pos}</span>{" "}
                <span className="line-through text-ink-3">{h.lost.name ?? "—"}</span>{" "}
                <span className="text-ink-3">→</span>{" "}
                <span className="font-medium">{h.next?.name ?? "nobody"}</span>
                {h.next?.par !== null && h.next?.par !== undefined && (
                  <span className="text-ink-3"> ({h.next.par.toFixed(0)})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 space-y-3">
        {units.map((unit) => (
          <section key={unit.name}>
            <div className="label mb-1.5">{unit.name}</div>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {unit.positions.map((pos) => (
                <PositionCard key={pos} pos={pos} list={byPos.get(pos)!} cutIds={cutIds} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PositionCard({
  pos,
  list,
  cutIds,
}: {
  pos: string;
  list: DepthChartRow[];
  cutIds: Set<string>;
}) {
  const starterCut = cutIds.has(list[0]?.player_id ?? "");
  const effective = list.find((r) => !cutIds.has(r.player_id)) ?? null;

  return (
    <div
      className="border border-rule rounded-[3px] px-2.5 py-2"
      style={starterCut ? { borderColor: "var(--neg)", background: "var(--neg-wash)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11px] font-semibold">{pos}</span>
        {starterCut && (
          <span className="text-[10px]" style={{ color: "var(--neg)" }}>
            {effective ? "promoted" : "empty"}
          </span>
        )}
      </div>
      <ol className="m-0 p-0 list-none space-y-0.5">
        {list.map((r) => {
          const cut = cutIds.has(r.player_id);
          const isStarter = effective?.player_id === r.player_id;
          const chip = injuryChip(r.status, r.p_play);
          return (
            <li
              key={r.player_id}
              className="flex items-baseline justify-between gap-1.5 text-[11.5px]"
              style={cut ? { opacity: 0.45 } : undefined}
            >
              <span className="truncate">
                <span className="text-ink-3 num mr-1">{r.depth_rank}</span>
                {r.name ? (
                  <Link
                    href={`/players/${r.player_id}`}
                    className={`link-cell ${isStarter ? "font-semibold" : "text-ink-2"}`}
                    style={cut ? { textDecoration: "line-through" } : undefined}
                  >
                    {r.name}
                  </Link>
                ) : (
                  <span className="text-ink-3">unknown</span>
                )}
                {chip && (
                  <span className="ml-1 text-[10px]" style={{ color: injuryTone(r.status) }}>
                    {chip}
                  </span>
                )}
              </span>
              <span className="num text-ink-3 shrink-0">
                {r.par !== null ? r.par.toFixed(0) : "—"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Tile({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="panel px-3.5 py-3">
      <div className="label">{label}</div>
      <div
        className="num text-[24px] leading-tight font-semibold mt-1"
        style={{ color: tone === "bad" ? "var(--neg)" : tone === "good" ? "var(--pos)" : undefined }}
      >
        {value}
      </div>
      {meta && <div className="text-[11px] text-ink-2 mt-0.5">{meta}</div>}
    </div>
  );
}
