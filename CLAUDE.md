# Working agreements

## Never push unless told to, in that message

`git push` is allowed **only when the user asks for it in the request you are
answering.** Never on your own initiative, never as a tidy-up at the end of a
task, and never because it seems implied. The remote is
`github.com/TylerGrossi/NFL-Analytics` and it is public — anything pushed is
published, and unpublishing is not really possible.

Permission does not carry forward. "Push this" means push this, once. The next
task starts from no again.

Never, with or without being asked:

- add, change or remove a git remote
- force-push, or use `--force` on anything
- rewrite published history (`rebase`, `reset --hard`, amend of a pushed commit)
- open, merge or close a pull request

Committing locally is fine when asked. Before any push, check what is staged —
the working tree may hold the user's own in-flight work, which is theirs to
commit, not yours to sweep up.

## Verify before you claim

This project's credibility rests on published, reproducible numbers, so the bar
for saying something works is that it was run:

- **Check every metric against recognisable reference rankings before shipping
  it.** Team-level backtests can pass while individual attribution is broken —
  that is the lesson the WAR rebuild came from, and it is the most important
  rule here. If the running back leaderboard does not look like the actual best
  running backs, the model is wrong however good the correlation is.
- Measure constants, do not assume them. Every coefficient in the pipeline is
  fit at build time and the fit quality is published beside it.
- Publish null results. `/market` says plainly that the betting market beats
  the model, because it does.

## Gates before reporting work complete

From `web/`:

```bash
npx tsc --noEmit          # types
npx eslint src            # lint
node audit-mobile.mjs     # no page scrolls sideways at 390px
node audit-text.mjs       # prose stays out of the scan path; no column voids
```

`PORT=3111 node audit-*.mjs` if the dev server is not on 3000.

## Interface rules

- **No paragraphs above the data.** One `<Deck>` sentence under the title;
  everything else goes in `<Notes>` at the foot of the page. Targets: under ~25
  visible words per route, first table or chart within ~450px.
- A two-track grid whose columns differ by hundreds of pixels leaves a hole in
  the page — cap long reference tables with an internal scroll, or make a short
  sidebar `lg:sticky`.
- `globals.css` has a global `.grid > *, .flex > * { min-width: 0 }`. It
  overrides Tailwind `min-w-*`, so use a fixed width for dropdowns and
  `shrink-0` on chip rows.

## Things not to do

- Don't reintroduce prediction intervals anywhere. They were removed from WAR
  deliberately.
- Don't embed ESPN media. Clips are linked, never embedded — bandwidth,
  advertising and per-country licensing.
- Don't ask for ESPN `SWID` / `espn_s2` cookies. They are full account
  credentials, not scoped tokens.
- Don't ship betting picks. A model line with a published backtest is a
  credible product; a "best bet of the day" is a different site.
