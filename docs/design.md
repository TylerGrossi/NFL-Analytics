# Design and front-end conventions

The rules the interface is held to, and the scripts that enforce them.

*Split out of `README.md`; that file is the front door.*

## Text, and where it goes

Analytical pages here have a lot to say — the model choices are the interesting part, and the site
publishes what it does not know. That is worth keeping, but it had ended up in the reader's way:
eleven pages opened with a 65 to 130 word paragraph before any data, four had grown a bullet wall of
caveats under four different headings, and the WAR leaderboard sat 672px down the page behind six
methodology cards.

Two primitives fix it without deleting anything.

- **`<Deck>`** — one sentence under the page title, capped at a 68-character measure. It says what
  the page is, not how it works.
- **`<Notes>`** — a `<details>` at the foot of the page, shut by default, always titled
  *Method & limits*. Every caveat, derivation and backtest reading lives here. Columns are sized
  rather than counted (`columns: 21rem`), so the measure stays readable and collapses to one column
  on a phone with no media query.

Prose a reader meets before opening anything fell from 2,408 words to 360 across nineteen routes,
and the WAR board now starts at 298px. `web/audit-text.mjs` reports visible words, collapsed words
and first-data depth per route; run it alongside `audit-mobile.mjs` after touching a page.

The same pass fixed three layout defects worth naming, because they are the kind that read as
carelessness: two columns both headed "WAR"; a fourth-down calculator whose left track ended 260px
short of its right, leaving a hole in the middle of the page; and a 2.5px tick standing in for a
value bar, now a diverging bar filled from the zero line.

## Narrow screens

Every page is checked at 390px by `web/audit-mobile.mjs`, which loads each route and fails any whose
document scrolls wider than the viewport. Wide tables scroll inside their own panel via `.scroll-x`
rather than dragging the page sideways — which needs `min-width: 0` on grid and flex children,
since the `auto` default lets a wide table stretch its track instead of scrolling within it. Chip
rows set `shrink-0` so that same rule does not crush them below their text.

## Sharing

Every page emits a generated Open Graph card, so a link pasted into Slack, iMessage or Bluesky
renders the numbers rather than a blank rectangle: `opengraph-image` routes exist for the home page,
`/war`, `/players/[id]`, `/teams/[abbr]` and `/games/[id]`, all built from the same shell in
`web/src/lib/og.tsx`.

Two constraints shape them. **No club marks** — logos and headshots belong to the clubs and the NFL,
so a card carries only team colors, abbreviations and figures we computed; the accent stripe does
the work a crest would. And a club whose primary color is navy would vanish into the card's navy
footer, so the stripe falls back to the secondary color when the primary is too dark to separate.

Set `NEXT_PUBLIC_SITE_URL` in the deploy environment. Without it `metadataBase` falls back to
localhost and the cards resolve to nothing off your machine.

Signature charts also carry a **PNG button** on hover — the win probability chart, aging curves, the
pick value curves and the player weekly chart. The charts are server-rendered SVG, so the export
clones the node, resolves every CSS custom property to a literal (a serialized SVG has no document,
so `var(--c1)` renders black), paints the panel background, and draws to a 2× canvas with the
Gridiron Analytics mark and a caption baked in. The team efficiency quadrant is deliberately excluded: it
draws club logos with `<image href>` from a remote host, which taints the canvas.

## Season navigation

Every page that shows one season at a time takes a `?season=` parameter and renders a picker:
standings, teams, the team hub, player cards, the Lab and the fourth down page. Recent years are
laid out in full and the rest collapse into a scrollable tail, because 27 equal chips swamps a page.

Deep history surfaces gaps that a six-season window hid, and those are labeled rather than papered
over. Snap counts begin in 2012, so a 2007 team page shows "—" for snap share instead of 0%, and
the defensive playing-time table explains that it cannot be built for that season rather than
rendering empty.
