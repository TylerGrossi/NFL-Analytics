/**
 * Site identity.
 *
 * Not quite the only place a rename touches — the mark lives in `public/`, the
 * ESPN user-agent in `lib/espn.ts` and `sources/espn.py`, and the CSV export
 * filename in the stats route. Everything user-facing reads from here.
 */

export const SITE = {
  name: "Gridiron Analytics",
  tagline: "Every snap, measured",
  description:
    "Opponent-adjusted team efficiency, player cards and advanced NFL metrics built on open play-by-play data.",
} as const;

/**
 * Grouped navigation.
 *
 * Fourteen links in a row is a site map, not a menu — it forces the reader to
 * scan every option every time and leaves no room for the section names to
 * mean anything. Five groups named after the question being asked ("how did
 * they do", "who is good") each hold a handful of related pages.
 */
export type NavItem = { href: string; label: string; blurb?: string };
export type NavGroup = { label: string; href: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Games",
    href: "/",
    items: [
      { href: "/", label: "Today", blurb: "Live scores and league averages" },
      { href: "/week", label: "The week", blurb: "Biggest swings, worst decisions, upsets" },
      { href: "/scores", label: "Scores", blurb: "Every week, played and projected" },
      { href: "/standings", label: "Standings", blurb: "Records, luck and real tiebreakers" },
      { href: "/playoffs", label: "Playoffs", blurb: "Seeding and simulated odds" },
    ],
  },
  {
    label: "Teams",
    href: "/teams",
    items: [
      { href: "/teams", label: "All teams", blurb: "Efficiency landscape and table" },
      { href: "/draft", label: "The draft", blurb: "What each pick is really worth" },
      { href: "/coaches", label: "Coaches", blurb: "Aggressiveness, tendency, predictability" },
      { href: "/tools/armchair-gm", label: "Armchair GM", blurb: "Cap sheet with real cut math" },
    ],
  },
  {
    label: "Players",
    href: "/stats",
    items: [
      { href: "/stats", label: "Stats explorer", blurb: "Every stored column, sortable" },
      { href: "/war", label: "Wins above replacement", blurb: "Value in wins, every position" },
      { href: "/separation", label: "Separation & coverage", blurb: "Receivers against corners" },
    ],
  },
  {
    label: "Fantasy",
    href: "/fantasy/draft",
    items: [
      { href: "/fantasy/draft", label: "Draft board", blurb: "Re-ranked for your league" },
      { href: "/fantasy/league", label: "Your league", blurb: "Sync Sleeper or ESPN" },
      { href: "/fantasy/week", label: "Start / sit", blurb: "This week, rest of season, waivers" },
      { href: "/fantasy/espn", label: "ESPN value", blurb: "Where ESPN drafters are late" },
      { href: "/fantasy", label: "Season values", blurb: "Value over replacement, usage" },
    ],
  },
  {
    label: "Research",
    href: "/lab",
    items: [
      { href: "/lab", label: "The Lab", blurb: "Ask your own question of the plays" },
      { href: "/market", label: "Model vs market", blurb: "Backtested against the closing line" },
      { href: "/tools/fourth-down", label: "Fourth down", blurb: "Go, kick or punt" },
      { href: "/glossary", label: "Glossary", blurb: "Every definition, formula and constant" },
    ],
  },
];
