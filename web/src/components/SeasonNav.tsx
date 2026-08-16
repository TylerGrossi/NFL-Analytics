import Link from "next/link";

/**
 * Season picker for pages that hold one season at a time.
 *
 * There are 27 seasons in the store, which is too many to lay out as equal
 * chips without swamping the page. Recent years are shown in full because they
 * are what people actually want; the rest collapse into a scrollable tail with
 * decade markers so the row stays one line tall.
 */
export function SeasonNav({
  seasons,
  active,
  href,
  recent = 8,
  label = "Season",
}: {
  seasons: number[];
  active: number;
  /** Builds the link for a season — pages own their own query strings. */
  href: (season: number) => string;
  recent?: number;
  label?: string;
}) {
  const sorted = [...seasons].sort((a, b) => b - a);
  const head = sorted.slice(0, recent);
  const tail = sorted.slice(recent);
  const activeInTail = tail.includes(active);

  const chip = (s: number) =>
    `num px-2 py-1 rounded-[3px] border text-[12px] no-underline whitespace-nowrap shrink-0 transition-colors ${
      s === active
        ? "bg-navy border-navy text-white"
        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
    }`;

  return (
    <div className="flex gap-1.5 items-center mb-4 flex-wrap">
      <span className="label shrink-0">{label}</span>
      {head.map((s) => (
        <Link key={s} href={href(s)} className={chip(s)}>
          {s}
        </Link>
      ))}
      {tail.length > 0 && (
        <>
          <span aria-hidden className="w-px h-4 bg-rule shrink-0" />
          <div className="flex gap-1 items-center overflow-x-auto max-w-full py-0.5">
            {tail.map((s) => (
              <Link
                key={s}
                href={href(s)}
                className={`num px-1.5 py-1 rounded-[3px] text-[11.5px] no-underline whitespace-nowrap shrink-0 ${
                  s === active
                    ? "bg-navy text-white"
                    : "text-ink-3 hover:text-accent hover:bg-panel-2"
                }`}
              >
                {activeInTail || s % 5 === 0 || s === tail[0] ? s : `’${String(s).slice(2)}`}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
