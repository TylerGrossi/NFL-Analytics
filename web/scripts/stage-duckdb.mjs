#!/usr/bin/env node
/**
 * Stage DuckDB-WASM's runtime files, which have to be split across two hosts.
 *
 * The `.wasm` payloads are 34–39 MB. Workers Assets caps a single file at
 * 25 MiB, so they cannot ship with the site — they go to R2 (5 TB per object,
 * and R2 charges no egress) and are fetched cross-origin, which WASM streaming
 * handles fine.
 *
 * The worker scripts are under 1 MB, so they stay in `public/` and are served
 * same-origin. That matters: browsers refuse `new Worker(crossOriginURL)`, and
 * keeping them local avoids the usual blob-shim workaround entirely.
 *
 * Runs from `prebuild`, so the staged copies can never drift from the installed
 * package version.
 */

import fs from "node:fs/promises";
import path from "node:path";

const DIST = path.join(process.cwd(), "node_modules", "@duckdb", "duckdb-wasm", "dist");
const PUBLIC_DIR = path.join(process.cwd(), "public", "duckdb");
const STAGE_DIR = path.join(process.cwd(), ".duckdb-r2", "duckdb");

// Served same-origin from public/.
const WORKERS = ["duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"];

// Too large for Workers Assets; uploaded to R2 by sync-r2.mjs.
const WASM = ["duckdb-mvp.wasm", "duckdb-eh.wasm"];

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

async function copy(names, from, to, guard) {
  await fs.mkdir(to, { recursive: true });
  for (const name of names) {
    const src = path.join(from, name);
    const stat = await fs.stat(src);
    if (guard && stat.size > MAX_ASSET_BYTES) {
      throw new Error(
        `${name} is ${(stat.size / 1024 / 1024).toFixed(1)} MB, over the 25 MiB ` +
          `Workers Assets limit. It must be served from R2, not public/.`
      );
    }
    await fs.copyFile(src, path.join(to, name));
    console.log(`  ${name}  ${(stat.size / 1e6).toFixed(1)} MB → ${path.basename(to)}/`);
  }
}

async function main() {
  try {
    await fs.access(DIST);
  } catch {
    console.error("@duckdb/duckdb-wasm is not installed. Run `npm install` first.");
    process.exit(1);
  }

  console.log("Staging DuckDB-WASM runtime:");
  // The guard is the point: if a future release pushes a worker script over the
  // asset limit, the build fails here rather than at `wrangler deploy`.
  await copy(WORKERS, DIST, PUBLIC_DIR, true);
  await copy(WASM, DIST, STAGE_DIR, false);
  console.log("Workers staged to public/duckdb, wasm staged to .duckdb-r2/duckdb (synced to R2).");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
