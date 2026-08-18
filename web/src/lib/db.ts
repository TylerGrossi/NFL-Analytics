import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * DuckDB reads the pipeline's parquet output directly — no database server,
 * no ORM, no import step. Queries that scan every play in a season still land
 * in tens of milliseconds because parquet is columnar and DuckDB prunes files
 * by the `season=` partition in the path.
 */

const DATA_DIR =
  process.env.NFLX_DATA_DIR ?? path.join(process.cwd(), "..", "data");

/**
 * Where the parquet store lives when it is not on local disk.
 *
 * Netlify's build and its functions both run on Linux, so the native DuckDB
 * binding works there — but a function bundle is capped at 50 MB zipped and the
 * store is ~150 MB, so the data cannot ride along. DuckDB's httpfs reads remote
 * parquet with ranged requests instead (measured: a filtered aggregate over a
 * 20 MB remote file in ~480 ms), which keeps the bundle small and the data out
 * of the repo entirely.
 *
 * Unset locally, so `npm run dev` keeps reading `../data` off disk at full
 * speed. Set in the deploy environment to the GitHub Release that the nightly
 * pipeline publishes.
 */
const DATA_URL = process.env.NFLX_DATA_URL?.replace(/\/$/, "");

/** True when reading over HTTP rather than from disk. */
export const REMOTE = Boolean(DATA_URL);

export const PARQUET_DIR = DATA_URL ?? path.join(DATA_DIR, "parquet");
export const JSON_DIR = path.join(DATA_DIR, "json");

/** First season in the play store, and first with participation charting. */
const FIRST_SEASON = 1999;
const FIRST_CHARTED_SEASON = 2016;

/**
 * One partition file, as a quoted SQL string.
 *
 * The two layouts differ on purpose. On disk the store is nested
 * (`pbp/season=2024.parquet`) because that is what the pipeline writes and what
 * lets DuckDB prune by partition. Remotely it is flat (`pbp_2024.parquet`)
 * because GitHub Release assets have no directories — an asset name is a single
 * flat string. `scripts/publish-data.mjs` does the flattening on upload, and
 * this is the other half of that contract: change one and you must change both.
 */
function one(dir: string, season: number): string {
  const p = DATA_URL
    ? `${DATA_URL}/${dir}_${season}.parquet`
    : path.join(PARQUET_DIR, dir, `season=${season}.parquet`).replace(/\\/g, "/");
  return `'${p}'`;
}

/**
 * A DuckDB source expression for a span of a partitioned store, **including its
 * quoting**.
 *
 * Locally a glob: `'.../pbp/*.parquet'`.
 * Remotely a list literal: `['https://…/season=1999.parquet', …]`, because HTTP
 * has no directory listing for DuckDB to expand a glob against.
 *
 * The list form is why this returns the quotes rather than a bare path.
 * `read_parquet('a', 'b')` is *not* a multi-file read — DuckDB reads the second
 * string as a named parameter and errors. A list literal is the only correct
 * spelling, so call sites write `read_parquet(${pbpGlob(s)})`, unquoted.
 *
 * The range must be real: naming a season the pipeline has not built is a hard
 * 404 remotely, where a glob would simply have skipped it.
 */
function span(dir: string, from: number, to: number): string {
  if (!DATA_URL && from <= FIRST_SEASON) {
    return `'${path.join(PARQUET_DIR, dir, "*.parquet").replace(/\\/g, "/")}'`;
  }
  const lo = Math.max(from, dir === "charted" ? FIRST_CHARTED_SEASON : FIRST_SEASON);
  if (to < lo) return `[]`;
  const files = Array.from({ length: to - lo + 1 }, (_, i) => one(dir, lo + i));
  return `[${files.join(", ")}]`;
}

/** Absolute path or URL of a built table, forward-slashed for DuckDB's parser. */
export function table(name: string): string {
  return DATA_URL
    ? `${DATA_URL}/${name}.parquet`
    : path.join(PARQUET_DIR, `${name}.parquet`).replace(/\\/g, "/");
}

/** One season of the play-by-play store. */
export function pbpGlob(season: number): string {
  return one("pbp", season);
}

/** One season of the charted store. */
export function chartedGlob(season: number): string {
  return one("charted", season);
}

/**
 * A season span of either store, for queries that cross seasons.
 *
 * Callers always know their range — the Lab carries `seasonFrom`/`seasonTo` —
 * so there is deliberately no "everything" form. That is what makes the remote
 * path safe: nothing has to guess which seasons exist.
 */
export function pbpSpan(from: number, to: number): string {
  return span("pbp", from, to);
}

export function chartedSpan(from: number, to: number): string {
  return span("charted", from, to);
}

/**
 * Read one of the pipeline's small JSON side-files.
 *
 * These sit beside the parquet and are equally absent from the repo, so they
 * follow the same rule: over HTTP when the store is remote, off disk otherwise.
 * `manifest.json` in particular carries the current week and has to be fresh —
 * committing a copy would show a stale week all season.
 *
 * Returns null rather than throwing; every caller already treats missing
 * validation data as "no backtest panel" rather than an error.
 */
export async function readDataJson<T>(name: string): Promise<T | null> {
  try {
    if (DATA_URL) {
      const res = await fetch(`${DATA_URL}/${name}`, { next: { revalidate: 300 } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    }
    return JSON.parse(fs.readFileSync(path.join(JSON_DIR, name), "utf-8")) as T;
  } catch {
    return null;
  }
}

export function dataExists(): boolean {
  // Nothing to check remotely — a missing file surfaces as a query error, and
  // probing every URL on boot would cost a round trip per table.
  return REMOTE || fs.existsSync(path.join(PARQUET_DIR, "teams.parquet"));
}

// A single instance is reused across requests; dev hot-reload would otherwise
// open a new DuckDB per edit and leak file handles.
declare global {
  var __nflxDuck: Promise<DuckDBConnection[]> | undefined;
}

/**
 * How many connections the pool holds.
 *
 * One connection cannot serve concurrent reads, but an instance can hand out
 * several that can. Remote reads are network-bound at ~145 ms each, so a page
 * firing six of them through `Promise.all` spent ~590 ms serialised and ~200 ms
 * across a pool — measured against the live store. Four covers the widest
 * fan-out on the site without holding open connections nothing uses.
 */
const POOL_SIZE = 4;

/**
 * Where DuckDB keeps its extensions.
 *
 * Reading `https://` parquet needs the httpfs extension, which DuckDB fetches
 * on first use and writes to `$HOME/.duckdb` by default. On a serverless
 * runtime everything except the temp directory is read-only, so that write
 * fails and every data route 500s in milliseconds — while the same code works
 * locally and in the build container, both of which have a writable home.
 *
 * `os.tmpdir()` is `/tmp` there and the system temp directory here, so one
 * setting covers both and there is no environment-specific branch to drift.
 * The path is stable rather than per-boot, so a warm instance downloads once.
 */
const EXTENSION_DIR = path.join(os.tmpdir(), "duckdb-extensions");

/**
 * DuckDB also resolves a home directory of its own, separately from the
 * extension path above, and on a serverless runtime `$HOME` is empty — which
 * fails as `IO Error: Can't find the home directory at ''` before any query
 * runs. Setting both is what the error itself prescribes; neither one alone is
 * enough.
 */
const HOME_DIR = os.tmpdir();

async function pool(): Promise<DuckDBConnection[]> {
  if (!globalThis.__nflxDuck) {
    globalThis.__nflxDuck = (async () => {
      const instance = await DuckDBInstance.create(":memory:", {
        threads: "4",
        home_directory: HOME_DIR,
        extension_directory: EXTENSION_DIR,
      });
      const conns: DuckDBConnection[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const conn = await instance.connect();
        // Load it up front rather than leaning on autoload, so a failure to
        // fetch the extension surfaces here instead of inside an unrelated
        // query. The download happens once; the rest read it off disk.
        if (REMOTE) await conn.run(i === 0 ? "INSTALL httpfs; LOAD httpfs;" : "LOAD httpfs;");
        conns.push(conn);
      }
      return conns;
    })();
  }
  return globalThis.__nflxDuck;
}

/** DuckDB returns BIGINT as bigint and DECIMAL as an object; flatten to JS. */
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  // NaN survives parquet round-trips and then fails every comparison in JS.
  // Nothing downstream wants it, so it becomes null at the boundary.
  if (typeof value === "number" && Number.isNaN(value)) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === "object" && "toString" in value && !Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const n = Number(value.toString());
      return Number.isNaN(n) ? value.toString() : n;
    }
  }
  return value;
}

// The native binding is not safe for concurrent reads on **one** connection — a
// page firing eight queries at a single connection through Promise.all crashes
// the worker. Each connection therefore runs one query at a time, and a query
// waits for whichever frees up first.
//
// Off local disk that queueing was free, because queries were milliseconds.
// Reading remote parquet they are ~145 ms apiece, so serialising the whole page
// onto one connection made every fan-out additive. Call sites are unchanged and
// still use Promise.all; the pool is what makes that actually concurrent.
const idle: DuckDBConnection[] = [];
const waiting: ((conn: DuckDBConnection) => void)[] = [];
let poolReady = false;

async function withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const conns = await pool();
  if (!poolReady) {
    poolReady = true;
    idle.push(...conns);
  }
  const conn = idle.pop() ?? (await new Promise<DuckDBConnection>((r) => waiting.push(r)));
  try {
    return await fn(conn);
  } finally {
    const next = waiting.shift();
    if (next) next(conn);
    else idle.push(conn);
  }
}

/** Run a query and return plain row objects. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await withConnection((conn) =>
    params.length ? conn.runAndReadAll(sql, params as never[]) : conn.runAndReadAll(sql)
  );
  return result.getRowObjects().map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = normalize(v);
    return out as T;
  });
}

/** Run a query expecting at most one row. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
