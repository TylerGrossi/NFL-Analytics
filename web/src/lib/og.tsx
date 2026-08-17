import type { ReactElement } from "react";

/**
 * Shared shell for the Open Graph cards.
 *
 * A link to this site pasted into Slack, iMessage or Bluesky used to render a
 * blank rectangle. These make it render the numbers instead, which is the
 * cheapest distribution this project has: the interesting thing about a player
 * card is the data, so the data should be what travels.
 *
 * Two constraints shape the design.
 *
 * **No club marks.** Team logos and player headshots belong to the clubs and
 * the NFL — the footer says so. A card that leaves this site and lands
 * somewhere else must carry only what is ours to publish: team *colours*,
 * abbreviations, and figures we computed. That is also why the accent stripe
 * does the work a logo would.
 *
 * **Satori, not a browser.** `ImageResponse` renders through Satori, which
 * supports a subset of CSS: flexbox only, no grid, no cascade. Every element
 * with more than one child needs an explicit `display: flex`, and shorthand
 * properties are unreliable. The helpers below keep that contained.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

// The site palette, inlined — Satori cannot read CSS custom properties.
export const OG = {
  ground: "#eff2f6",
  panel: "#ffffff",
  rule: "#dde3eb",
  ink: "#0c1725",
  ink2: "#43556c",
  ink3: "#78889d",
  navy: "#0d2340",
  accent: "#1b5fa8",
  pos: "#0f6b4d",
  neg: "#a3392a",
} as const;

function normalise(hex: string | null | undefined): string | null {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return null;
  return hex.startsWith("#") ? hex : `#${hex}`;
}

/** Perceived brightness, 0–255 (ITU-R BT.601). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * A stripe colour that actually reads.
 *
 * The footer bar is navy, so a club whose primary is also navy — Seattle, the
 * Giants, Dallas — produced a stripe that vanished into it and a card that
 * looked broken. Prefer the primary, fall back to the secondary when the
 * primary is too dark to separate, and to the site accent when neither works.
 */
export function safeColor(
  hex: string | null | undefined,
  alt?: string | null
): string {
  const primary = normalise(hex);
  const secondary = normalise(alt);
  const TOO_DARK = 60;
  if (primary && luminance(primary) >= TOO_DARK) return primary;
  if (secondary && luminance(secondary) >= TOO_DARK) return secondary;
  return primary ?? secondary ?? OG.accent;
}

export function ogStat(label: string, value: string, tone?: "pos" | "neg") {
  return (
    <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 20, color: OG.ink3, letterSpacing: 0.2 }}>{label}</div>
      <div
        style={{
          fontSize: 54,
          fontWeight: 600,
          color: tone === "pos" ? OG.pos : tone === "neg" ? OG.neg : OG.ink,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The card frame: accent stripe, title block, a row of figures, and a footer
 * carrying attribution and the data-freshness stamp so the image is
 * self-describing wherever it ends up.
 */
export function ogCard({
  eyebrow,
  title,
  subtitle,
  stats,
  accent,
  accentAlt,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  stats: ReactElement[];
  accent?: string;
  accentAlt?: string;
  footer: string;
}) {
  const stripe = safeColor(accent, accentAlt);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.ground,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", height: 14, background: stripe }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: "54px 64px 0 64px",
        }}
      >
        <div style={{ display: "flex", fontSize: 22, color: OG.ink3, letterSpacing: 0.4 }}>
          {eyebrow}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: title.length > 26 ? 68 : 86,
            fontWeight: 700,
            color: OG.ink,
            letterSpacing: -1.6,
            marginTop: 8,
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>

        {subtitle && (
          <div style={{ display: "flex", fontSize: 26, color: OG.ink2, marginTop: 10 }}>
            {subtitle}
          </div>
        )}

        <div style={{ display: "flex", flex: 1 }} />

        <div style={{ display: "flex", gap: 64, paddingBottom: 40 }}>{stats}</div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 64px",
          background: OG.navy,
          color: "#ffffff",
          fontSize: 21,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", width: 10, height: 22, background: stripe }} />
          <div style={{ display: "flex", fontWeight: 700, letterSpacing: -0.3 }}>Gridiron Analytics</div>
        </div>
        <div style={{ display: "flex", color: "#9fb2ca" }}>{footer}</div>
      </div>
    </div>
  );
}
