# Deploying

*Vercel for the app, a GitHub Release for the data. Written 2026-08-17.*

## Why the data is not in the deployment

The app itself deploys with no changes at all: Vercel runs Node, so
`@duckdb/node-api`'s native binding works and every route keeps rendering
server-side. `next.config.ts` already marks it `serverExternalPackages`, which is
what keeps the `.node` binary out of the bundler's way.

The store is the problem, not the app. It is ~150 MB of parquet that is rebuilt
nightly:

- **In git** it would bloat history permanently — binary, large, and changing
  every day.
- **In the function bundle** it does not comfortably fit. Vercel caps a
  serverless function at 250 MB uncompressed and the DuckDB binding already
  takes a chunk of that. It would also be re-uploaded on every deploy.

So it lives on a GitHub Release, and DuckDB reads it over HTTPS with `httpfs`,
pulling only the byte ranges a query touches. Release assets are CDN-served,
support range requests, and cost nothing.

Measured on this machine before committing to the approach:

| | |
|---|---|
| `count(*)` over a 20 MB remote parquet | 505 ms cold |
| Filtered `GROUP BY` aggregate, one season | 32 ms warm |
| Range support on Release assets | 206 + correct `Content-Range` |

## The two layouts

This is the one piece of hidden coupling, so it is worth stating plainly.

| | On disk | On the Release |
|---|---|---|
| Flat table | `teams.parquet` | `teams.parquet` |
| Partition | `pbp/season=2024.parquet` | `pbp_2024.parquet` |

Release assets are a **flat namespace** — there are no directories — so
partitions are flattened on upload. `assetName()` in `scripts/publish-data.mjs`
does the flattening and `one()` in `web/src/lib/db.ts` reconstructs it. **Change
one and you must change the other.**

## Setup

### 1. Publish the data

```bash
node scripts/publish-data.mjs --dry-run   # check the flattening first
node scripts/publish-data.mjs
```

Needs `gh` authenticated. It prints the `NFLX_DATA_URL` value when it finishes.

For the nightly Action to do this, the repo must allow it: **Settings → Actions →
General → Workflow permissions → Read and write permissions.** Without it the
`publish` job cannot create the release, and the failure is a 403 on
`gh release create`.

### 2. Point Vercel at `web/`

The Next app is not at the repo root. **Root Directory must be `web`**, set in
the Vercel project settings — `vercel.json` cannot express it.

### 3. Set the environment variable

`NFLX_DATA_URL` = `https://github.com/<owner>/<repo>/releases/download/data-latest`

Set it for Production and Preview. Leave it **unset** locally so `npm run dev`
keeps reading `../data` off disk.

## What the nightly Action does

`.github/workflows/pipeline.yml` has two jobs:

- `build` — runs the Python pipeline, uploads `data/` as a workflow artifact.
- `publish` — downloads that artifact and republishes it to the `data-latest`
  release with `--clobber`.

Vercel is not involved. It redeploys from git on its own, and because the data is
read at request time, new data appears without a redeploy.

The release is a **moving pointer**, not history — assets are replaced in place so
there is one copy of the store rather than 150 MB accumulating nightly.

## Local development

Unchanged. `npm run dev` reads `../data` directly.

To exercise the remote path locally:

```bash
NFLX_DATA_URL=https://github.com/<owner>/<repo>/releases/download/data-latest npm run dev
```

## Not yet verified

Honest list. None of this has run against a real deployment.

- **The DuckDB native binding on Vercel's runtime.** It should work — Vercel
  installs dependencies on Linux and `serverExternalPackages` is already set —
  but "should" is not "does". This is the single highest-risk item; if it fails,
  the fallback is prerendering at build time instead of querying at request time.
- **Per-page latency with remote reads.** Individual queries measured well, but
  several routes fire multiple queries and some fan out with `Promise.all`.
  `db.ts` funnels queries through a promise chain because the native binding is
  not safe for concurrent reads on one connection — so those fan-outs serialise,
  and remote latency stacks where it previously did not. Worth measuring per
  route before trusting it.
- **Cold-start cost** of loading the binding plus the first `httpfs` read.
- **The 60s `maxDuration` and 1769 MB memory** in `web/vercel.json` are reasoned
  guesses, not tuned numbers.

## Known gap

`readDataJson()` fetches `manifest.json` with `revalidate: 300`. The manifest
carries the current week, so during the season a stale copy shows the wrong week
for up to five minutes after a rebuild. That is deliberate — the alternative is
an uncached fetch on every render.
