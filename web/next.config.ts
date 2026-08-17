import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root sits above this app; pin it so Turbopack stops looking for a
  // lockfile in OneDrive's parent folders.
  turbopack: { root: path.join(__dirname) },
  // DuckDB ships a native .node binding per platform. Bundling it makes the
  // compiler try to resolve every platform's binary; keep it on native require.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  // The binding is two files: duckdb.node, and a ~36 MB shared library beside it
  // (libduckdb.so on Linux, duckdb.dll here). File tracing follows the require
  // of duckdb.node and bundles it, but the shared library is loaded by the OS
  // dynamic linker, so nothing in the JS graph references it and it is left out
  // of the function. The result is a deployment whose build renders fine and
  // whose every data route then dies on `libduckdb.so: cannot open shared
  // object file`. Pull in the whole package so both halves ship together.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@duckdb/**/*"],
  },
};

export default nextConfig;
