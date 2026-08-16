#!/usr/bin/env node
/**
 * Push the built parquet store to R2.
 *
 * DuckDB-WASM in the browser range-reads these files directly over R2's public
 * custom domain, so the Worker is never in the data path — which is what keeps
 * the interactive surfaces (/lab, /stats, every season switch) free to run.
 *
 *   node scripts/sync-r2.mjs                  # sync everything that changed
 *   node scripts/sync-r2.mjs --bucket X       # override the target bucket
 *   node scripts/sync-r2.mjs --force          # re-upload regardless of hash
 *   node scripts/sync-r2.mjs --dry-run        # list what would move
 *
 * Uploads run through `wrangler r2 object put`, so authentication is whatever
 * wrangler already uses: CLOUDFLARE_API_TOKEN in CI, OAuth locally.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BUCKET = value("bucket", process.env.R2_BUCKET ?? "hashmark-parquet");
const DATA_DIR = path.resolve(
  value("data", process.env.NFLX_DATA_DIR ?? path.join(process.cwd(), "..", "data"))
);
const PARQUET_DIR = path.join(DATA_DIR, "parquet");
const DRY = flag("dry-run");
const FORCE = flag("force");

// Parquet is immutable per build but the whole store is replaced nightly.
// An hour of browser caching with revalidation keeps range reads cheap without
// serving yesterday's numbers for long.
const CACHE_CONTROL = "public, max-age=3600, must-revalidate";

// wrangler spawns a process per object; too much parallelism just thrashes.
const CONCURRENCY = 6;

// Call the npx shim directly rather than going through a shell. `shell: true`
// concatenates arguments unescaped, which breaks on the spaces in this repo's
// own path ("NFL Analytics") and is a command-injection shape besides.
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/** Files under a directory matching an extension, as POSIX-style keys. */
async function walk(dir, ext, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, ext, base)));
    } else if (entry.name.endsWith(ext)) {
      out.push({ full, key: path.relative(base, full).split(path.sep).join("/") });
    }
  }
  return out;
}

/**
 * DuckDB-WASM's `.wasm` payloads ride along in the same bucket. They are 34–39 MB,
 * over the 25 MiB Workers Assets ceiling, so R2 is the only place they can live.
 * `scripts/stage-duckdb.mjs` puts them here during `prebuild`.
 */
const DUCKDB_STAGE = path.join(process.cwd(), ".duckdb-r2");

async function md5(file) {
  return createHash("md5")
    .update(await fs.readFile(file))
    .digest("hex");
}

/**
 * What is already up there. R2 returns the md5 as the ETag for single-part
 * uploads, which is every file here — the largest is a few MB against a 5 GB
 * single-part ceiling.
 */
async function remoteManifest() {
  if (FORCE) return new Map();
  try {
    const { stdout } = await run(
      NPX,
      ["wrangler", "r2", "object", "get", `${BUCKET}/_manifest.json`, "--pipe"],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return new Map(Object.entries(JSON.parse(stdout)));
  } catch {
    // No manifest yet (first run) — treat everything as new.
    return new Map();
  }
}

async function put(file, key, extra = []) {
  if (DRY) return;
  await run(
    NPX,
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET}/${key}`,
      "--file",
      file,
      "--cache-control",
      CACHE_CONTROL,
      ...extra,
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  );
}

async function main() {
  try {
    await fs.access(PARQUET_DIR);
  } catch {
    console.error(`No parquet store at ${PARQUET_DIR}. Run the pipeline first.`);
    process.exit(1);
  }

  const files = await walk(PARQUET_DIR, ".parquet");
  if (files.length === 0) {
    console.error(`No .parquet files under ${PARQUET_DIR}.`);
    process.exit(1);
  }

  // The wasm runtime is versioned with the npm package and changes rarely, but
  // it has to be in the bucket before the first browser query can run.
  try {
    await fs.access(DUCKDB_STAGE);
    files.push(...(await walk(DUCKDB_STAGE, ".wasm")));
  } catch {
    console.warn(
      "No .duckdb-r2/ staging directory — run `npm run prebuild` if the browser " +
        "query layer is expected to work."
    );
  }

  const remote = await remoteManifest();
  const manifest = {};
  const queue = [];

  for (const f of files) {
    const hash = await md5(f.full);
    manifest[f.key] = hash;
    if (remote.get(f.key) !== hash) queue.push(f);
  }

  const totalMb = (
    (await Promise.all(queue.map(async (f) => (await fs.stat(f.full)).size))).reduce(
      (a, b) => a + b,
      0
    ) / 1e6
  ).toFixed(1);

  console.log(
    `${files.length} files in store · ${queue.length} changed (${totalMb} MB) · bucket ${BUCKET}` +
      (DRY ? " · dry run" : "")
  );

  const total = queue.length;
  let done = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      // WASM must be served as application/wasm or the browser refuses to
      // stream-compile it and falls back to a slower path — or fails outright.
      const type = f.key.endsWith(".wasm")
        ? "application/wasm"
        : "application/vnd.apache.parquet";
      await put(f.full, f.key, ["--content-type", type]);
      done += 1;
      console.log(`  ${done}/${total}  ${f.key}`);
    }
  });
  await Promise.all(workers);

  // The manifest goes up last, so an interrupted sync re-uploads rather than
  // claiming files landed that did not.
  if (!DRY) {
    const tmp = path.join(os.tmpdir(), `hashmark-manifest-${process.pid}.json`);
    await fs.writeFile(tmp, JSON.stringify(manifest));
    await put(tmp, "_manifest.json", ["--content-type", "application/json"]);
    await fs.unlink(tmp);
  }

  console.log(DRY ? "Dry run complete." : "Sync complete.");
}

main().catch((err) => {
  console.error(err.stderr ?? err.message ?? err);
  process.exit(1);
});
