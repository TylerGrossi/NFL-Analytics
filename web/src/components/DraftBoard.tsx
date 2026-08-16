"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DraftBoardRow } from "@/lib/queries";

/**
 * A draft board that recomputes for the league you are actually in.
 *
 * Scoring formats differ only in what a catch is worth, so the whole board can
 * be re-derived from two projected quantities — PPR points and receptions —
 * rather than storing a separate projection per format. Roster settings change
 * replacement level instead: superflex does not change what a quarterback
 * scores, it changes how many are gone before the position stops being scarce,
 * which is the entire reason quarterbacks move up thirty picks.
 */

type Scoring = "ppr" | "half" | "standard";
type Roster = "1qb" | "superflex";

const RECEPTION_POINTS: Record<Scoring, number> = { ppr: 1, half: 0.5, standard: 0 };

// Starting slots per team, before the waiver wire is the alternative.
const STARTERS: Record<Roster, Record<string, number>> = {
  "1qb": { QB: 1, RB: 2, WR: 3, TE: 1 },
  superflex: { QB: 2, RB: 2, WR: 3, TE: 1 },
};

// A new tier begins when the drop to the next player exceeds this many
// projected points — roughly a point per game, which is what actually decides
// whether waiting a round costs you anything.
const TIER_GAP = 14;

const SIZES = [8, 10, 12, 14];
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

type Row = DraftBoardRow & {
  points: number;
  vor: number;
  myRank: number;
  tier: number;
  ecr: number | null;
  edge: number | null;
  price: number | null;
};

// Roster spots per team, used to work out how much of an auction budget is
// committed to minimum bids and therefore how much is actually biddable.
const ROSTER_SPOTS = 15;

export function DraftBoard({ rows, rankedOn }: { rows: DraftBoardRow[]; rankedOn: string | null }) {
  const [size, setSize] = useState(12);
  const [scoring, setScoring] = useState<Scoring>("ppr");
  const [roster, setRoster] = useState<Roster>("1qb");
  const [tePremium, setTePremium] = useState(0);
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [dynasty, setDynasty] = useState(false);
  const [budget, setBudget] = useState(0);
  const [drafted, setDrafted] = useState<Set<string>>(new Set());

  const computed = useMemo(() => {
    const recPts = RECEPTION_POINTS[scoring];
    const starters = STARTERS[roster];

    // 1. Re-score every projection under the chosen rules.
    const scored = rows
      .filter((r) => r.projected && r.proj_points !== null)
      .map((r) => {
        const receptions = r.proj_receptions ?? 0;
        const bonus = r.position === "TE" ? tePremium * receptions : 0;
        return {
          ...r,
          points: (r.proj_points ?? 0) - (1 - recPts) * receptions + bonus,
        };
      });

    // 2. Replacement level is the last startable player at each position.
    const replacement: Record<string, number> = {};
    for (const p of ["QB", "RB", "WR", "TE"]) {
      const pool = scored
        .filter((r) => r.position === p)
        .sort((a, b) => b.points - a.points);
      const slot = Math.round(size * (starters[p] ?? 1));
      replacement[p] = pool[Math.min(slot, pool.length) - 1]?.points ?? 0;
    }

    // 3. Value over that replacement is the only comparable currency.
    const withVor: Row[] = scored
      .map((r) => ({
        ...r,
        vor: r.points - (replacement[r.position] ?? 0),
        myRank: 0,
        tier: 0,
        ecr: null,
        edge: null,
        price: null,
      }))
      .sort((a, b) => b.vor - a.vor);

    withVor.forEach((r, i) => {
      r.myRank = i + 1;
      const key = dynasty
        ? roster === "superflex"
          ? r.ecr_dynasty_superflex
          : r.ecr_dynasty
        : roster === "superflex"
          ? r.ecr_superflex
          : r.ecr_redraft;
      r.ecr = key;
      // Positive means the board likes him more than the room does.
      r.edge = key === null ? null : key - (i + 1);
    });

    // 4. Tiers run within a position, since that is where the choice is made.
    for (const p of ["QB", "RB", "WR", "TE"]) {
      const pool = withVor.filter((r) => r.position === p);
      let tier = 1;
      pool.forEach((r, i) => {
        if (i > 0 && pool[i - 1].points - r.points > TIER_GAP) tier += 1;
        r.tier = tier;
      });
    }

    // 5. Auction prices, if a budget is set.
    //
    // Pricing uses a deeper baseline than the ranking does. Value over the last
    // *starter* is the right way to rank, but pricing against it concentrates
    // the whole budget in about eighty players and prints a $107 top pick. An
    // auction fills benches too, so the baseline here is the worst player at
    // each position who still gets drafted at all — the standard auction VBD
    // construction, and the one that lands top bids where they actually clear.
    if (budget > 0) {
      const rostered = size * ROSTER_SPOTS;
      const pool = withVor.slice(0, rostered);
      const floor: Record<string, number> = {};
      for (const p of ["QB", "RB", "WR", "TE"]) {
        const atPos = pool.filter((r) => r.position === p);
        floor[p] = atPos.length ? atPos[atPos.length - 1].points : 0;
      }
      const surplus = (r: Row) => Math.max(r.points - (floor[r.position] ?? 0), 0);
      const totalSurplus = pool.reduce((a, b) => a + surplus(b), 0);
      const biddable = budget * size - rostered;
      const inPool = new Set(pool.map((r) => r.player_id));
      for (const r of withVor) {
        r.price = inPool.has(r.player_id)
          ? Math.max(1, Math.round(1 + (surplus(r) / totalSurplus) * biddable))
          : null;
      }
    }

    // Where this board and the room disagree as a matter of method rather than
    // opinion. Measured over the top 100 only: deeper than that the two rank
    // scales stop being comparable, because consensus also ranks kickers and
    // defences while this board does not.
    const bias: Record<string, { mean: number; n: number }> = {};
    for (const p of ["QB", "RB", "WR", "TE"]) {
      const pool = withVor
        .slice(0, 100)
        .filter((r) => r.position === p && r.edge !== null);
      if (pool.length >= 3) {
        bias[p] = {
          mean: pool.reduce((a, b) => a + (b.edge ?? 0), 0) / pool.length,
          n: pool.length,
        };
      }
    }

    return { rows: withVor, replacement, bias };
  }, [rows, size, scoring, roster, tePremium, dynasty, budget]);

  const shown = useMemo(
    () =>
      (pos === "ALL"
        ? computed.rows
        : computed.rows.filter((r) => r.position === pos)
      ).slice(0, 150),
    [computed, pos]
  );

  const toggleDrafted = (id: string) =>
    setDrafted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] cursor-pointer transition-colors ${
      active
        ? "bg-navy border-navy text-white"
        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
    }`;

  return (
    <>
      <div className="panel px-3.5 py-3 mb-4 flex flex-col gap-2.5">
        <Control label="League size">
          {SIZES.map((s) => (
            <button key={s} onClick={() => setSize(s)} className={`num ${chip(s === size)}`}>
              {s}
            </button>
          ))}
        </Control>

        <Control label="Scoring">
          {(
            [
              ["ppr", "Full PPR"],
              ["half", "Half PPR"],
              ["standard", "Standard"],
            ] as [Scoring, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setScoring(k)} className={chip(k === scoring)}>
              {l}
            </button>
          ))}
        </Control>

        <Control label="Roster">
          {(
            [
              ["1qb", "One QB"],
              ["superflex", "Superflex"],
            ] as [Roster, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setRoster(k)} className={chip(k === roster)}>
              {l}
            </button>
          ))}
          <button onClick={() => setDynasty(!dynasty)} className={chip(dynasty)}>
            Dynasty
          </button>
        </Control>

        <Control label="TE premium">
          {[0, 0.5, 1].map((v) => (
            <button key={v} onClick={() => setTePremium(v)} className={`num ${chip(v === tePremium)}`}>
              {v === 0 ? "None" : `+${v}`}
            </button>
          ))}
        </Control>

        <Control label="Auction budget">
          {[0, 200, 300].map((v) => (
            <button key={v} onClick={() => setBudget(v)} className={`num ${chip(v === budget)}`}>
              {v === 0 ? "Snake" : `$${v}`}
            </button>
          ))}
        </Control>

        <Control label="Position">
          {POSITIONS.map((p) => (
            <button key={p} onClick={() => setPos(p)} className={chip(p === pos)}>
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </Control>

        <div className="flex gap-x-6 gap-y-1.5 flex-wrap pt-1 border-t border-rule text-[11.5px] text-ink-3">
          <span>
            Replacement level ·{" "}
            {["QB", "RB", "WR", "TE"].map((p) => (
              <span key={p} className="mr-2.5">
                {p}
                <b className="num text-ink-2 ml-1">{computed.replacement[p]?.toFixed(0) ?? "—"}</b>
              </span>
            ))}
          </span>
          <span title="Average rank difference against consensus, top 100 only">
            Vs consensus ·{" "}
            {["QB", "RB", "WR", "TE"].map((p) => {
              const b = computed.bias[p];
              return (
                <span key={p} className="mr-2.5">
                  {p}
                  <b
                    className={`num ml-1 ${
                      !b ? "text-ink-3" : b.mean > 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {!b ? "—" : b.mean > 0 ? `+${b.mean.toFixed(0)}` : b.mean.toFixed(0)}
                  </b>
                </span>
              );
            })}
          </span>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-head">
          <h2>
            {dynasty ? "Dynasty" : "Redraft"} board · {size}-team{" "}
            {scoring === "ppr" ? "PPR" : scoring === "half" ? "half-PPR" : "standard"}
            {roster === "superflex" ? " superflex" : ""}
            {tePremium > 0 ? ` · TE +${tePremium}` : ""}
          </h2>
          <span className="text-[11px] text-ink-3 flex items-center gap-2.5">
            {drafted.size > 0 && (
              <button
                onClick={() => setDrafted(new Set())}
                className="text-accent underline underline-offset-2"
              >
                clear {drafted.size} drafted
              </button>
            )}
            <span>
              {shown.length} shown{rankedOn ? ` · consensus ${rankedOn}` : ""}
            </span>
          </span>
        </div>
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th>Tier</th>
                <th>Age</th>
                <th>Proj</th>
                <th>VOR</th>
                {budget > 0 && <th>$</th>}
                <th>ECR</th>
                <th>Edge</th>
                <th>Depth</th>
                <th>SoS</th>
                <th>Bye</th>
                <th>Avail</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.player_id}
                  onClick={() => toggleDrafted(r.player_id)}
                  className={`cursor-pointer ${
                    drafted.has(r.player_id) ? "opacity-35 line-through" : ""
                  }`}
                >
                  <td className="num text-ink-3">{r.myRank}</td>
                  <td className="l">
                    <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                      {r.name}
                    </Link>
                  </td>
                  <td className="l text-ink-2">{r.position}</td>
                  <td className="num">
                    <span className="rank-chip">{r.tier}</span>
                  </td>
                  <td className="num text-ink-3">{r.age ?? "—"}</td>
                  <td className="num text-ink-2">{r.points.toFixed(0)}</td>
                  <td className="num font-semibold">{r.vor.toFixed(0)}</td>
                  {budget > 0 && (
                    <td className="num font-semibold text-pos">
                      {r.price === null ? "—" : `$${r.price}`}
                    </td>
                  )}
                  <td className="num text-ink-3">{r.ecr === null ? "—" : r.ecr.toFixed(1)}</td>
                  <td
                    className={`num font-semibold ${
                      r.edge === null ? "text-ink-3" : r.edge > 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {r.edge === null ? "—" : r.edge > 0 ? `+${r.edge.toFixed(0)}` : r.edge.toFixed(0)}
                  </td>
                  <td className="num">
                    {r.depth_rank === null ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <span
                        className="rank-chip"
                        data-tier={
                          r.depth_rank === 1
                            ? "good"
                            : r.position === "QB"
                              ? "bad"
                              : undefined
                        }
                        title={
                          r.depth_rank > 1 && r.position === "QB"
                            ? "Backup quarterback — scores nothing unless the starter goes down"
                            : undefined
                        }
                      >
                        {(r.depth_pos ?? r.position) + r.depth_rank}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {r.sos_rank === null ? (
                      "—"
                    ) : (
                      <span className="rank-chip" data-tier={sosTier(r.sos_rank)}>
                        {r.sos_rank}
                      </span>
                    )}
                  </td>
                  <td className="num text-ink-3">{r.bye ?? "—"}</td>
                  <td
                    className={`num ${
                      (r.availability ?? 1) < 0.75 ? "text-neg" : "text-ink-3"
                    }`}
                  >
                    {r.availability === null ? "—" : `${Math.round(r.availability * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-center flex-wrap">
      <span className="label w-full sm:w-[92px] shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Schedule rank 1 is the easiest, 32 the hardest. */
function sosTier(rank: number): "good" | "bad" | undefined {
  if (rank <= 10) return "good";
  if (rank >= 23) return "bad";
  return undefined;
}
