#!/usr/bin/env node
/**
 * Publish the built data store to a GitHub Release.
 *
 * Why a Release rather than the repo or the deployment bundle:
 *   - The store is ~150 MB of binary that changes nightly. In git it would bloat
 *     history permanently.
 *   - Vercel caps a serverless function at 250 MB uncompressed; the store plus
 *     the DuckDB native binding does not comfortably fit, and would be re-uploaded
 *     on every deploy.
 *   - Release assets are CDN-served, support HTTP range requests (verified), and
 *     cost nothing. DuckDB's httpfs reads them directly, pulling only the byte
 *     ranges a query touches.
 *
 * The site reads these over HTTPS via NFLX_DATA_URL — see web/src/lib/db.ts.
 *
 *   node scripts/publish-data.mjs                 # publish to the default tag
 *   node scripts/publish-data.mjs --tag data-dev  # somewhere else
 *   node scripts/publish-data.mjs --dry-run
 *
 * Auth is whatever `gh` already uses: GH_TOKEN in CI, keyring locally.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const TAG = value("tag", process.env.NFLX_DATA_TAG ?? "data-latest");
const DATA_DIR = path.resolve(value("data", process.env.NFLX_DATA_DIR ?? "data"));
const DRY = flag("dry-run");

const GH = process.platform === "win32" ? "gh.cmd" : "gh";

/**
 * Release assets are a flat namespace — there are no directories. The store on
 * disk is nested (`pbp/season=2024.parquet`), so partitions are flattened to
 * `pbp_2024.parquet` on the way up.
 *
 * `one()` in web/src/lib/db.ts reconstructs exactly these names. The two are a
 * contract: change this and you must change that.
 */
function assetName(rel) {
  const parts = rel.split(path.sep);
  if (parts.length === 1) return parts[0];
  const [dir, file] = [parts[0], parts[parts.length - 1]];
  const season = file.match(/season=(\d{4})/)?.[1];
  if (!season) throw new Error(`Cannot flatten an unrecognised partition: ${rel}`);
  return `${dir}_${season}.parquet`;
}

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ full, rel: path.relative(base, full) });
  }
  return out;
}

async function main() {
  const parquetDir = path.join(DATA_DIR, "parquet");
  const jsonDir = path.join(DATA_DIR, "json");

  try {
    await fs.access(parquetDir);
  } catch {
    console.error(`No parquet store at ${parquetDir}. Run the pipeline first.`);
    process.exit(1);
  }

  const files = [
    ...(await walk(parquetDir)).filter((f) => f.rel.endsWith(".parquet")),
    // The JSON side-files ride along. manifest.json carries the current week, so
    // it has to be republished with the data, not committed.
    ...(await walk(jsonDir).catch(() => [])).filter((f) => f.rel.endsWith(".json")),
  ];

  const staged = [];
  const seen = new Map();
  for (const f of files) {
    const name = assetName(f.rel);
    if (seen.has(name)) {
      throw new Error(`Two files flatten to '${name}': ${seen.get(name)} and ${f.rel}`);
    }
    seen.set(name, f.rel);
    staged.push({ ...f, name });
  }

  const bytes = (await Promise.all(staged.map(async (f) => (await fs.stat(f.full)).size))).reduce(
    (a, b) => a + b,
    0
  );
  console.log(
    `${staged.length} assets · ${(bytes / 1e6).toFixed(1)} MB · tag ${TAG}${DRY ? " · dry run" : ""}`
  );

  if (DRY) {
    for (const f of staged.slice(0, 8)) console.log(`  ${f.rel}  ->  ${f.name}`);
    if (staged.length > 8) console.log(`  … ${staged.length - 8} more`);
    return;
  }

  // A flat staging directory, because `gh release upload` takes the asset name
  // from the file's basename.
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "gridiron-data-"));
  try {
    for (const f of staged) await fs.copyFile(f.full, path.join(stage, f.name));

    // The release is a moving pointer, not history. Recreating the tag on each
    // run keeps exactly one copy of the data rather than accumulating 150 MB a night.
    const exists = await run(GH, ["release", "view", TAG]).then(
      () => true,
      () => false
    );
    if (!exists) {
      await run(GH, [
        "release",
        "create",
        TAG,
        "--title",
        "Data store (latest build)",
        "--notes",
        "Parquet store and JSON side-files, republished by the nightly pipeline. " +
          "Read directly over HTTPS by the site via DuckDB httpfs.",
        "--latest=false",
      ]);
      console.log(`created release ${TAG}`);
    }

    // --clobber replaces assets in place, so consumers never see a gap where a
    // file has been deleted but not yet re-uploaded.
    const names = staged.map((f) => path.join(stage, f.name));
    for (let i = 0; i < names.length; i += 25) {
      const batch = names.slice(i, i + 25);
      await run(GH, ["release", "upload", TAG, ...batch, "--clobber"], {
        maxBuffer: 64 * 1024 * 1024,
      });
      console.log(`  uploaded ${Math.min(i + batch.length, names.length)}/${names.length}`);
    }

    const { stdout } = await run(GH, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    const repo = stdout.trim();
    console.log(`\nDone. Set NFLX_DATA_URL to:`);
    console.log(`  https://github.com/${repo}/releases/download/${TAG}`);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stderr ?? err.message ?? err);
  process.exit(1);
});
