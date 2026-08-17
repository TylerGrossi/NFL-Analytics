import Link from "next/link";
import type { ReactNode } from "react";
import { rankTier } from "@/lib/format";

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
}: {
  children: ReactNode;
  className?: string;
}) {
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
export function PercentileBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-ink-3 text-[12px]">no qualifying sample</span>;
  }
  const tone =
    value >= 50
      ? `color-mix(in oklab, var(--c1) ${20 + ((value - 50) / 50) * 80}%, var(--panel-3))`
      : `color-mix(in oklab, var(--c2) ${20 + ((50 - value) / 50) * 80}%, var(--panel-3))`;
  return (
    <span className="relative block h-[18px] rounded-[2px] bg-panel-3 overflow-hidden">
      <span className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${value}%`, background: tone }} />
      <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong opacity-70" />
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-ink-3 text-[13px]">{children}</div>;
}
