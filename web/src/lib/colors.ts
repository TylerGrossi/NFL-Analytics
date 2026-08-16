/**
 * Team colors are chosen by clubs, not by us, and plenty of matchups collide —
 * New England and Seattle both list #002244, which turns a two-team chart into
 * one flat band. This picks a pair that a reader can actually tell apart.
 */

const FALLBACK = ["#1f5fa8", "#c2622d"];

function toRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Plain RGB distance is enough to catch collisions; max is ~441. */
export function colorDistance(a: string, b: string): number {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return 999;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

const MIN_DISTANCE = 70;

export type TeamPalette = { home: string; away: string };

/**
 * Returns two visually separable colors, preferring the clubs' own.
 * Falls back to a secondary team color, then to the chart palette.
 */
export function distinguishTeamColors(
  home: { color?: string | null; color2?: string | null },
  away: { color?: string | null; color2?: string | null }
): TeamPalette {
  const h = home.color || FALLBACK[0];
  const a = away.color || FALLBACK[1];

  if (colorDistance(h, a) >= MIN_DISTANCE) return { home: h, away: a };

  // Try the away club's secondary before reaching for a generic palette.
  if (away.color2 && colorDistance(h, away.color2) >= MIN_DISTANCE) {
    return { home: h, away: away.color2 };
  }
  if (home.color2 && colorDistance(home.color2, a) >= MIN_DISTANCE) {
    return { home: home.color2, away: a };
  }
  return { home: FALLBACK[0], away: FALLBACK[1] };
}
