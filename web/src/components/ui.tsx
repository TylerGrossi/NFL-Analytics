import Link from "next/link";
import type { ReactNode } from "react";
import { ordinal, rankTier } from "@/lib/format";

/** Shared surface + label primitives. Kept small on purpose — pages compose these. */

export function Panel({
  title,
  meta,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h3>{title}</h3>
          {meta && <div className="text-[11px] text-ink-3">{meta}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/**
 * The title of a page, as distinct from the title of a section on it.
 *
 * Every page used to open with a `SectionRule`, which meant the page title and
 * the headings beneath it were set identically — so a reader landing on /market
 * saw four things all claiming to be the top of the hierarchy. A page gets one
 * `h1`, at a size nothing else on the page uses.
 */
export function PageHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="headline text-[clamp(23px,2.7vw,31px)] leading-[1.08] text-navy">
        {children}
      </h1>
      {aside && <div className="text-[11.5px] text-ink-3 shrink-0">{aside}</div>}
    </div>
  );
}

export function SectionRule({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-rule mt-7 first:mt-0">
      <h2 className="headline text-[16px] text-ink">{children}</h2>
      {aside && <p className="section-note">{aside}</p>}
    </div>
  );
}

/**
 * The one line under a page title.
 *
 * Pages used to open with a paragraph of methodology, which put 65 to 130
 * words between the reader and the first number. A deck says what the page is
 * and gets out of the way; the reasoning lives in `Notes` at the foot of the
 * page for the reader who wants it.
 */
export function Deck({ children }: { children: ReactNode }) {
  return <p className="deck">{children}</p>;
}

/**
 * The qualifier that applies to a table, set under it.
 *
 * This used to ride on the section heading as `aside` — out at the right
 * margin, past a hairline, which in a two-column layout put it nearer the
 * *next* column's heading than its own. A qualifier read before the table
 * is preamble; the same sentence read after it is a footnote, which is what
 * it always was.
 */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="footnote">{children}</p>;
}

/**
 * Method and caveats, collapsed.
 *
 * This site publishes what it does not know, which is the point of it — but
 * four pages had grown a bullet wall under four different headings, each
 * sitting in the primary scan path. Same content, one name, shut by default.
 */
export function Notes({
  title = "Method & limits",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="notes">
      <summary>{title}</summary>
      <div className="notes-body">{children}</div>
    </details>
  );
}

/**
 * A row of figures, as one object rather than several.
 *
 * These used to be individual bordered cards laid out in a grid. Six identical
 * boxes in a line is the single most recognisable shape in generated UI: it
 * gives every figure the same weight, so the reader gets no help deciding
 * which one matters, and it draws twenty-four borders to separate things a
 * hairline could. One sheet with dividers reads as a considered summary.
 */
export function StatRow({
  children,
  className = "",
  spaced = false,
}: {
  children: ReactNode;
  className?: string;
  /** Separate sheets with real gaps, rather than one sheet ruled into cells. */
  spaced?: boolean;
}) {
  if (spaced) return <div className={`stat-row-spaced ${className}`}>{children}</div>;
  return (
    <div
      className={`panel grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px bg-rule overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  tone,
  standalone = false,
}: {
  label: string;
  value: ReactNode;
  /**
   * No longer rendered. The definition line under each figure put a third
   * piece of text in a tile whose job is to show one number, and six of them
   * across a row read as a wall of footnotes. Still accepted so the call sites
   * that pass it keep compiling; the content belongs in `Notes` instead.
   */
  meta?: ReactNode;
  tone?: "good" | "bad" | "neutral";
  /** Set when the tile is not inside a `StatRow` and needs its own surface. */
  standalone?: boolean;
}) {
  const color = tone === "good" ? "text-pos" : tone === "bad" ? "text-neg" : "text-ink";
  return (
    <div className={`text-center ${standalone ? "panel px-4 py-4" : "bg-panel px-4 py-4"}`}>
      <div className="label">{label}</div>
      <div className={`num text-[26px] leading-none font-semibold mt-2 ${color}`}>{value}</div>
    </div>
  );
}

export function RankChip({ rank, of = 32 }: { rank: number | null | undefined; of?: number }) {
  if (!rank) return <span className="text-ink-3">—</span>;
  return (
    <span className="rank-chip" data-tier={rankTier(rank, of)}>
      {rank}
    </span>
  );
}

export function Tag({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "good" | "bad" | "accent" | "flag";
}) {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

/** Team logo + abbreviation. Logos come from the nflverse teams table (ESPN CDN). */
export function TeamMark({
  team,
  logo,
  size = 20,
  showAbbr = true,
  href,
  name,
}: {
  team: string;
  logo?: string | null;
  size?: number;
  showAbbr?: boolean;
  href?: string;
  name?: string;
}) {
  const inner = (
    <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          className="shrink-0 object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="shrink-0 rounded-[2px] bg-panel-3 num text-[10px] grid place-items-center"
          style={{ width: size, height: size }}
        >
          {team}
        </span>
      )}
      {showAbbr && <span className="font-semibold">{name ?? team}</span>}
    </span>
  );
  return href ? (
    <Link href={href} className="link-cell">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** A value bar that reads left-negative / right-positive around a center rule. */
export function DivergingBar({
  value,
  max,
  width = 74,
}: {
  value: number | null | undefined;
  max: number;
  width?: number;
}) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  const t = Math.min(Math.abs(value) / max, 1) * 50;
  const positive = value >= 0;
  return (
    <span
      className="relative inline-block h-[11px] rounded-[2px] bg-panel-3 align-middle"
      style={{ width }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
      <span
        className="absolute inset-y-[1px] rounded-[1px]"
        style={{
          background: positive ? "var(--c1)" : "var(--c2)",
          left: positive ? "50%" : `${50 - t}%`,
          width: `${t}%`,
        }}
      />
    </span>
  );
}

/** Percentile ramp used on player cards. */
/**
 * The percentile scale: blue at the bottom, red at the top, a light neutral
 * through the middle.
 *
 * A percentile has a meaningful centre — the 50th is the league — so this is a
 * diverging scale rather than a single ramp, and the midpoint is grey so that
 * "average" reads as nothing in particular. The poles were checked rather than
 * chosen by eye: blue #1b5fa8 against red #b3332a separates at ΔE 19.6 under
 * protanopia and 29.5 under tritanopia, and both clear 3:1 on white. Each arm
 * runs monotonically light-to-dark out from the middle, so rank survives as
 * lightness alone in greyscale or print.
 *
 * The number is drawn inside the bubble, so colour never carries the value on
 * its own.
 */
const P_LOW: [number, number, number] = [27, 95, 168]; // #1b5fa8
const P_MID: [number, number, number] = [217, 212, 204]; // #d9d4cc
const P_HIGH: [number, number, number] = [179, 51, 42]; // #b3332a

function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function percentileColor(value: number): { fill: string; ink: string } {
  const v = Math.max(0, Math.min(100, value));
  const [from, to, raw] =
    v >= 50 ? [P_MID, P_HIGH, (v - 50) / 50] : [P_LOW, P_MID, 1 - v / 50];
  // Eased rather than linear. On a straight interpolation the whole upper half
  // of the scale sits in washed terracotta — a 74th percentile looked no more
  // red than a 60th, which is the one distinction the scale exists to draw.
  // The exponent pulls saturation toward the poles and leaves only the genuine
  // middle grey.
  const t = raw ** 0.62;
  const ends = v >= 50 ? [from, to] : [to, from];
  const rgb = ends[0].map((c, i) => Math.round(c + (ends[1][i] - c) * t)) as [
    number,
    number,
    number,
  ];

  // Pick whichever label colour actually has more contrast on this fill, rather
  // than switching at a fixed lightness — near the middle of each arm the naive
  // threshold chose white where dark ink reads better.
  const L = luminance(rgb);
  const onWhite = 1.05 / (L + 0.05);
  const onInk = (L + 0.05) / (0.0074 + 0.05);
  return {
    fill: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
    ink: onWhite > onInk ? "#fff" : "var(--ink)",
  };
}

/**
 * One percentile row: a bar filled to the rank, coloured on the diverging scale,
 * with the figure set at the filled end.
 *
 * The bar carries the value twice — length and colour — which is what lets a
 * column of them be read down at a glance rather than one at a time.
 */
export function PercentileBar({
  value,
  label,
}: {
  value: number | null | undefined;
  label?: string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-ink-3 text-[12px]">no qualifying sample</span>;
  }
  const v = Math.max(0, Math.min(100, value));
  const { fill, ink } = percentileColor(v);
  // Below this the fill is too short to hold its own number, so the figure sits
  // just outside it in body ink instead of being squeezed against the edge.
  const inside = v >= 16;
  return (
    <span
      className="relative block h-[20px] rounded-[3px] bg-panel-3 overflow-hidden"
      title={label ? `${label}: ${ordinal(Math.round(v))} of qualifying players at the position` : undefined}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-[3px] flex items-center justify-end"
        style={{ width: `${v}%`, background: fill, paddingRight: inside ? 6 : 0 }}
      >
        {inside && (
          <span className="num font-semibold" style={{ color: ink, fontSize: 10.5 }}>
            {Math.round(v)}
          </span>
        )}
      </span>
      {!inside && (
        <span
          className="absolute inset-y-0 num font-semibold flex items-center text-ink-2"
          style={{ left: `calc(${v}% + 6px)`, fontSize: 10.5 }}
        >
          {Math.round(v)}
        </span>
      )}
      {/* The league marker. A percentile plot with no 50 has no anchor. */}
      <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong opacity-70" />
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-ink-3 text-[13px]">{children}</div>;
}
