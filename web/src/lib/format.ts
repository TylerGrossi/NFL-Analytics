/** Display helpers. Every number the site renders passes through one of these. */

const MINUS = "−"; // true minus sign, not a hyphen

export function signed(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  // Round before testing the sign, or −0.0001 renders as "−0.000".
  const r = Number(v.toFixed(digits));
  const s = Math.abs(r).toFixed(digits);
  return r > 0 ? `+${s}` : r < 0 ? `${MINUS}${s}` : s;
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v.toFixed(digits);
  // A value that rounds to zero from below prints "-0.00", which reads as a
  // real negative and is the sort of thing that makes a table look unfinished.
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = Math.round(v);
  return (Object.is(n, -0) ? 0 : n).toLocaleString("en-US");
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Values already stored on a 0–100 scale (PROE, CPOE). */
export function pts(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const r = Number(v.toFixed(digits));
  const s = Math.abs(r).toFixed(digits);
  return r > 0 ? `+${s}` : r < 0 ? `${MINUS}${s}` : s;
}

export function record(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** Rank tiers drive the chip color: top/bottom third of a 32-team league. */
export function rankTier(rank: number | null | undefined, of = 32): "good" | "bad" | "mid" {
  if (!rank) return "mid";
  if (rank <= of / 4) return "good";
  if (rank > of - of / 4) return "bad";
  return "mid";
}

export function ordinal(n: number | null | undefined): string {
  if (!n) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function height(inches: number | null | undefined): string {
  if (!inches) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

export function age(birthDate: string | null | undefined): string {
  if (!birthDate) return "—";
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return "—";
  const diff = Date.now() - b.getTime();
  return String(Math.floor(diff / 31557600000));
}

export function gameDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(`${d}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Color for a value on a diverging scale: navy positive, rust negative. */
export function divergingColor(v: number | null | undefined, max: number): string {
  if (v === null || v === undefined) return "var(--panel-3)";
  const t = Math.min(Math.abs(v) / max, 1);
  const hue = v >= 0 ? "var(--c1)" : "var(--c2)";
  return `color-mix(in oklab, ${hue} ${Math.round(20 + t * 80)}%, var(--panel-3))`;
}

/**
 * Betting line for one side of a game.
 *
 * nflverse stores `spread_line` as the points the *home* team is favoured by,
 * so a home favourite is positive. A posted line states the favourite as a
 * negative number, which is the opposite sign, and quietly printing the stored
 * value labels every favourite as an underdog.
 */
export function line(spreadLine: number | null, forHome = true): string {
  if (spreadLine === null || Number.isNaN(spreadLine)) return "—";
  return signed(forHome ? -spreadLine : spreadLine, 1);
}
