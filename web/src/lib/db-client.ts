"use client";

import * as duckdb from "@duckdb/duckdb-wasm";

/**
 * The browser-side twin of `db.ts`.
 *
 * On Cloudflare there is no server that can run DuckDB — the native binding is
 * a `.node` addon and Workers are V8 isolates. So anything the build cannot
 * prerender is queried here instead: DuckDB-WASM range-reads the same parquet
 * files over HTTP from R2, and the columnar layout means a filter over a season
 * of plays pulls a few hundred KB rather than the whole file.
 *
 * The exported surface deliberately mirrors `db.ts` — `query`, `queryOne`,
 * `table`, `pbpGlob` — so a query written against the server layer ports over
 * without being rewritten.
 */

// Where the parquet store lives. Supplied by the Worker at /api/config so the
// bucket can move between environments without rebuilding the site.
let base: string | null = process.env.NEXT_PUBLIC_PARQUET_BASE ?? null;
let basePromise: Promise<string> | null = null;

async function parquetBase(): Promise<string> {
  if (base) return base;
  if (!basePromise) {
    basePromise = (async () => {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const cfg = (await res.json()) as { parquetBase?: string };
          if (cfg.parquetBase) return cfg.parquetBase.replace(/\/$/, "");
        }
      } catch {
        // fall through
      }
      // The Worker serves the store same-origin from R2 at /data/*, so this is
      // the right answer whenever /api/config is unreachable — including under
      // plain `next dev`, where a dev-only route can stand in for it.
      return "/data";
    })();
    base = await basePromise;
  }
  return basePromise;
}

/** Absolute URL of a built table. Mirrors `table()` in db.ts. */
export async function table(name: string): Promise<string> {
  return `${await parquetBase()}/${name}.parquet`;
}

/** The play-by-play store is one file per season. Mirrors `pbpGlob()` in db.ts. */
export async function pbpGlob(season?: number): Promise<string> {
  const root = await parquetBase();
  // DuckDB-WASM cannot glob over HTTP — there is no directory listing to walk —
  // so an unqualified request has to name each season explicitly. Callers
  // should pass a season wherever they can.
  if (season === undefined) {
    throw new Error("pbpGlob() needs a season in the browser: HTTP has no directory listing.");
  }
  return `${root}/pbp/season=${season}.parquet`;
}

let dbPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function connection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const root = await parquetBase();

    // Worker scripts are served same-origin from public/ — browsers block
    // `new Worker()` against a cross-origin URL. The wasm payloads are over the
    // 25 MiB Workers Assets limit and come from R2 instead; cross-origin is
    // fine for those because they are fetched, not spawned.
    const bundles: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: `${root}/duckdb/duckdb-mvp.wasm`,
        mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
      },
      eh: {
        mainModule: `${root}/duckdb/duckdb-eh.wasm`,
        mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
      },
    };

    const bundle = await duckdb.selectBundle(bundles);
    const worker = new Worker(bundle.mainWorker!);
    // Silence the default console logger; failures surface as thrown errors.
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    const conn = await db.connect();
    // Range requests over the parquet footer are what make this cheap; without
    // direct IO DuckDB buffers whole files before reading them.
    await conn.query("SET enable_http_metadata_cache = true;");
    return conn;
  })();

  return dbPromise;
}

/**
 * Flatten DuckDB's Arrow types to plain JS.
 *
 * Kept byte-for-byte equivalent to `normalize()` in db.ts — if these two drift,
 * the same query returns subtly different values depending on whether it ran at
 * build time or in the browser, which is exactly the kind of silent data bug
 * this project has been bitten by before.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
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

/** Run a query and return plain row objects. Mirrors `query()` in db.ts. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const conn = await connection();

  const result = params.length
    ? await (async () => {
        const stmt = await conn.prepare(sql);
        try {
          return await stmt.query(...(params as never[]));
        } finally {
          await stmt.close();
        }
      })()
    : await conn.query(sql);

  return result.toArray().map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.toJSON())) out[k] = normalize(v);
    return out as T;
  });
}

/** Run a query expecting at most one row. Mirrors `queryOne()` in db.ts. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Warm the engine. The first query pays for a ~10 MB wasm download and
 * instantiation; calling this on mount of an interactive page means the cost is
 * spent while the reader is still looking at the prerendered numbers.
 */
export function preload(): void {
  void connection().catch(() => {
    /* preload is best-effort; the real query surfaces the error */
  });
}
