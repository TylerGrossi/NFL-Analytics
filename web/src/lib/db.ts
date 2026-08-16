import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import path from "node:path";
import fs from "node:fs";

/**
 * DuckDB reads the pipeline's parquet output directly — no database server,
 * no ORM, no import step. Queries that scan every play in a season still land
 * in tens of milliseconds because parquet is columnar and DuckDB prunes files
 * by the `season=` partition in the path.
 */

const DATA_DIR =
  process.env.NFLX_DATA_DIR ?? path.join(process.cwd(), "..", "data");

export const PARQUET_DIR = path.join(DATA_DIR, "parquet");
export const JSON_DIR = path.join(DATA_DIR, "json");

/** Absolute path to a built table, forward-slashed for DuckDB's parser. */
export function table(name: string): string {
  return path.join(PARQUET_DIR, `${name}.parquet`).replace(/\\/g, "/");
}

/** The play-by-play store is one file per season. */
export function pbpGlob(season?: number): string {
  const file = season === undefined ? "*.parquet" : `season=${season}.parquet`;
  return path.join(PARQUET_DIR, "pbp", file).replace(/\\/g, "/");
}

export function dataExists(): boolean {
  return fs.existsSync(path.join(PARQUET_DIR, "teams.parquet"));
}

// A single instance is reused across requests; dev hot-reload would otherwise
// open a new DuckDB per edit and leak file handles.
declare global {
  var __nflxDuck: Promise<DuckDBConnection> | undefined;
}

async function connection(): Promise<DuckDBConnection> {
  if (!globalThis.__nflxDuck) {
    globalThis.__nflxDuck = (async () => {
      const instance = await DuckDBInstance.create(":memory:", { threads: "4" });
      return instance.connect();
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

// The native binding is not safe for concurrent reads on one connection — a
// page firing eight queries through Promise.all crashes the worker. Queries are
// milliseconds, so funnelling them through a promise chain costs nothing and
// keeps call sites free to use Promise.all.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Run a query and return plain row objects. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const conn = await connection();
  const result = await serialize(() =>
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
