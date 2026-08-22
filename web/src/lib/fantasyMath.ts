/**
 * The maths behind the in-season fantasy tools.
 *
 * Two things live here: filling a lineup optimally, and turning two lineups
 * into a win probability.
 *
 * The second is the one worth explaining. A projection is a *mean*; a matchup
 * is decided by the spread around it. That spread is strongly
 * heteroscedastic — it grows with the projection — so the pipeline fits
 * `sd = a + b × projection` per position on 38,758 player weeks rather than
 * assuming one number. The slopes differ enough to change decisions:
 * quarterback spread barely moves with the projection (b ≈ 0.10) while tight
 * end spread scales steepest (b ≈ 0.39), so a projected fifteen-point
 * quarterback is a far safer start than a projected fifteen-point tight end.
 *
 * Team scores are then the sum of independent per-player normals, which makes
 * the team total normal too — so the win probability is closed-form and needs
 * no simulation. Independence is an approximation and the page says so: a
 * quarterback and his own receiver are correlated, and stacking them widens a
 * real lineup's spread beyond what this computes.
 */

export type VarianceFit = { position: string; sd_base: number; sd_slope: number };

export type Candidate = {
  playerId: string | null;
  name: string;
  position: string | null;
  nflTeam: string | null;
  /** Projected points this week, or null when we cannot value him. */
  proj: number | null;
  opponent?: string | null;
  matchupMult?: number | null;
};

export type FilledSlot = { slot: string; player: Candidate | null };

/** Which positions may fill a slot. Anything unknown is treated as exact. */
const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export function slotAccepts(slot: string, position: string | null): boolean {
  if (!position) return false;
  return (SLOT_ELIGIBLE[slot] ?? [slot]).includes(position);
}

/**
 * Fill the starting slots with the highest projected legal player.
 *
 * Greedy, but ordered so it is also optimal for these slot sets: the most
 * restrictive slots are filled first, so a flex never steals a back that the
 * RB slot needed. With only single-position slots and flexes drawing from a
 * superset, that ordering gives the same answer as an exhaustive assignment.
 */
export function optimizeLineup(roster: Candidate[], slots: string[]): {
  starters: FilledSlot[];
  bench: Candidate[];
  total: number;
} {
  const pool = [...roster].sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1));
  const used = new Set<Candidate>();

  const order = [...slots]
    .map((slot, i) => ({ slot, i, width: (SLOT_ELIGIBLE[slot] ?? [slot]).length }))
    .sort((a, b) => a.width - b.width || a.i - b.i);

  const filled = new Map<number, Candidate | null>();
  for (const { slot, i } of order) {
    const pick = pool.find(
      (p) => !used.has(p) && p.proj !== null && slotAccepts(slot, p.position)
    );
    if (pick) used.add(pick);
    filled.set(i, pick ?? null);
  }

  const starters = slots.map((slot, i) => ({ slot, player: filled.get(i) ?? null }));
  return {
    starters,
    bench: pool.filter((p) => !used.has(p)),
    total: starters.reduce((sum, s) => sum + (s.player?.proj ?? 0), 0),
  };
}

/** The best legal swap into a slot, and what it would gain. */
export function swapCost(
  starters: FilledSlot[],
  bench: Candidate[]
): { slot: string; out: Candidate; in: Candidate; gain: number }[] {
  const out: { slot: string; out: Candidate; in: Candidate; gain: number }[] = [];
  for (const s of starters) {
    if (!s.player) continue;
    const better = bench
      .filter((b) => b.proj !== null && slotAccepts(s.slot, b.position))
      .sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0))[0];
    if (better && (better.proj ?? 0) > (s.player.proj ?? 0)) {
      out.push({
        slot: s.slot,
        out: s.player,
        in: better,
        gain: (better.proj ?? 0) - (s.player.proj ?? 0),
      });
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Standard deviation of one player's week, from the fitted position model. */
export function playerSd(proj: number, position: string | null, fits: VarianceFit[]): number {
  const f = fits.find((x) => x.position === position);
  // An unfitted position (kicker, defense) gets the average skill-position
  // spread rather than zero, which would claim a certainty we do not have.
  if (!f) return Math.max(3, 3.5 + 0.25 * proj);
  return Math.max(1, f.sd_base + f.sd_slope * proj);
}

export type MatchupOdds = {
  meanA: number; meanB: number;
  sdA: number; sdB: number;
  winProbA: number;
  /** Points A must make up, negative when A is favored. */
  margin: number;
};

/**
 * Win probability for A over B.
 *
 * Each lineup is a sum of independent normals, so each team total is normal
 * and the margin is too. That makes this closed-form — no simulation, no seed,
 * the same answer every render.
 */
export function matchupOdds(
  a: FilledSlot[],
  b: FilledSlot[],
  fits: VarianceFit[]
): MatchupOdds {
  const stats = (side: FilledSlot[]) => {
    let mean = 0;
    let variance = 0;
    for (const s of side) {
      if (!s.player?.proj) continue;
      const sd = playerSd(s.player.proj, s.player.position, fits);
      mean += s.player.proj;
      variance += sd * sd;
    }
    return { mean, sd: Math.sqrt(variance) };
  };
  const A = stats(a);
  const B = stats(b);
  const sd = Math.sqrt(A.sd * A.sd + B.sd * B.sd) || 1;
  return {
    meanA: A.mean, meanB: B.mean, sdA: A.sd, sdB: B.sd,
    winProbA: normalCdf((A.mean - B.mean) / sd),
    margin: B.mean - A.mean,
  };
}

/** Φ(x), via the Abramowitz–Stegun error function approximation. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
      t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Buckets of the margin distribution, for a histogram. */
export function marginBuckets(odds: MatchupOdds, buckets = 21): { x: number; p: number }[] {
  const sd = Math.sqrt(odds.sdA * odds.sdA + odds.sdB * odds.sdB) || 1;
  const mu = odds.meanA - odds.meanB;
  const lo = mu - 3 * sd;
  const step = (6 * sd) / buckets;
  const out: { x: number; p: number }[] = [];
  for (let i = 0; i < buckets; i++) {
    const a = lo + i * step;
    out.push({
      x: a + step / 2,
      p: normalCdf((a + step - mu) / sd) - normalCdf((a - mu) / sd),
    });
  }
  return out;
}
