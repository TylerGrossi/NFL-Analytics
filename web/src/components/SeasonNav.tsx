import { SeasonSelect } from "./SeasonSelect";

/**
 * Season picker for pages that hold one season at a time.
 *
 * There are 27 seasons in the store. Laid out as chips that was a row of 27
 * controls — eight in full and the rest shrunk into an abbreviated scrolling
 * tail, so the same list was rendered at two sizes with two hit-target sizes
 * and a decade rule to explain itself. A select holds 27 options at the cost
 * of one control, and every year is then equally reachable rather than the
 * older ones being second-class.
 *
 * This stays a server component: callers pass `href` as a function, which
 * cannot be handed to a client component, so the URLs are resolved here.
 */
export function SeasonNav({
  seasons,
  active,
  href,
  label = "Season",
  inline = false,
}: {
  seasons: number[];
  active: number;
  /** Builds the link for a season — pages own their own query strings. */
  href: (season: number) => string;
  /**
   * How many seasons used to be shown at full size before the rest collapsed.
   * The select shows all of them, so this no longer does anything; it is still
   * accepted so the call sites that pass it keep compiling.
   */
  recent?: number;
  label?: string;
  /** Drops the picker's own bottom margin when it shares a row with other controls. */
  inline?: boolean;
}) {
  const options = [...seasons]
    .sort((a, b) => b - a)
    .map((season) => ({ season, href: href(season) }));

  return <SeasonSelect options={options} active={active} label={label} inline={inline} />;
}
