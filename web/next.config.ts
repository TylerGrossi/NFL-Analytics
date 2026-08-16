import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root sits above this app; pin it so Turbopack stops looking for a
  // lockfile in OneDrive's parent folders.
  turbopack: { root: path.join(__dirname) },
  // DuckDB ships a native .node binding per platform. Bundling it makes the
  // compiler try to resolve every platform's binary; keep it on native require.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
