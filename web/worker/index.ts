/**
 * The only dynamic surface on Cloudflare.
 *
 * Everything else on this site is prerendered into `out/` by the nightly
 * GitHub Action (where DuckDB's native binding works) and served straight from
 * the edge. The Worker exists for the one thing that cannot be baked at build
 * time: live game state from ESPN.
 *
 * Why proxy ESPN rather than call it from the browser:
 *   1. ESPN sends no CORS headers, so a direct fetch from the page is blocked.
 *   2. Their edge fingerprints the client and 403s some of them. Browsers will
 *      not let script set User-Agent, so the header has to be applied
 *      server-side. This was a silent, total outage once already — HANDOFF.md §5.
 *
 * The fingerprinting is **not** User-Agent alone. Measured 2026-08-16 from this
 * machine: identical requests to /scoreboard returned 200 from Node's fetch for
 * every User-Agent tried, and 403 from curl for every one except curl's own
 * default. So something below the header — TLS fingerprint or header ordering —
 * is doing the deciding. workerd is a third client again, so **verify the live
 * path against the deployed Worker**; neither the Node nor the curl result
 * predicts it. If live surfaces go quiet, this is the first thing to check.
 *
 * It also serves the parquet store from R2 at /data/*, which is what lets the
 * site run with no custom domain — see `serveParquet`.
 */

// `Env` is generated from wrangler.jsonc by `npm run cf:typegen` into
// worker/worker-configuration.d.ts. Regenerate it whenever bindings change.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

/**
 * Closed whitelist. An open proxy would let anyone route arbitrary traffic
 * through this Worker on our account's quota.
 */
const ALLOWED = new Set(["scoreboard", "summary", "standings", "teams", "news"]);

/** Live state moves fast but not per-request; ESPN has no SLA and no rate limit published. */
const EDGE_TTL = 20;

function cors(extra: HeadersInit = {}): Headers {
  const h = new Headers(extra);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return h;
}

async function espn(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const endpoint = url.pathname.replace(/^\/api\/espn\/?/, "").split("/")[0];

  if (!ALLOWED.has(endpoint)) {
    return new Response(JSON.stringify({ error: "unknown endpoint" }), {
      status: 404,
      headers: cors({ "content-type": "application/json" }),
    });
  }

  const target = new URL(`${ESPN}/${endpoint}`);
  // Forward only the query params ESPN actually takes, so the cache key stays
  // tight and nothing user-supplied reaches them unfiltered.
  for (const key of ["event", "dates", "week", "seasontype", "year", "limit"]) {
    const value = url.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }

  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { headers: cors(hit.headers) });

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { "User-Agent": "gridiron-analytics (personal project)" },
    });
  } catch {
    // Fail soft, exactly as the server-side client does: the page renders
    // without the live strip rather than erroring.
    return new Response(JSON.stringify({ error: "upstream unreachable" }), {
      status: 502,
      headers: cors({ "content-type": "application/json" }),
    });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "upstream error", status: upstream.status }), {
      status: 502,
      headers: cors({ "content-type": "application/json" }),
    });
  }

  const body = await upstream.arrayBuffer();
  const headers = cors({
    "content-type": "application/json",
    "cache-control": `public, max-age=${EDGE_TTL}, s-maxage=${EDGE_TTL}`,
  });

  ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: new Headers(headers) })));
  return new Response(body, { headers });
}

/**
 * Serve the parquet store (and the DuckDB-WASM payloads) straight out of the R2
 * binding, same-origin under /data/*.
 *
 * This is what lets the site ship without owning a domain. The alternatives both
 * have a catch: R2's public `r2.dev` URL is rate-limited and explicitly not for
 * production, and a custom domain needs a domain. Going through the binding
 * needs neither, and because it is same-origin there is no CORS to configure at
 * all — one less thing that fails only in the browser, at runtime, with an
 * unhelpful message.
 *
 * The cost is Worker invocations: DuckDB-WASM issues a HEAD plus several ranged
 * GETs per query, against a free-tier budget of 100k requests/day. Fine to
 * launch on. When a domain does arrive, point PARQUET_BASE at it and this route
 * stops being hit — no code change.
 */
async function serveParquet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/data\//, ""));

  // Path traversal guard. The key is attacker-controlled and goes straight to
  // the bucket.
  if (!key || key.includes("..") || key.startsWith("/")) {
    return new Response("Invalid key", { status: 400 });
  }

  const headers = new Headers({
    // Parquet is replaced wholesale by the nightly rebuild; an hour of browser
    // caching with revalidation keeps range reads cheap without serving
    // yesterday's numbers for long. The wasm is versioned and never changes.
    "cache-control": key.endsWith(".wasm")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600, must-revalidate",
    // DuckDB-WASM will not issue range requests unless it sees this.
    "accept-ranges": "bytes",
  });

  if (request.method === "HEAD") {
    const meta = await env.PARQUET.head(key);
    if (!meta) return new Response(null, { status: 404 });
    meta.writeHttpMetadata(headers);
    headers.set("etag", meta.httpEtag);
    headers.set("content-length", String(meta.size));
    return new Response(null, { headers });
  }

  const object = await env.PARQUET.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not found", { status: 404 });

  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  // A precondition that failed returns the object without a body.
  if (!("body" in object) || object.body === null) {
    return new Response(null, { status: 304, headers });
  }

  const range = object.range;
  if (range && request.headers.has("range")) {
    // R2 hands back whichever two of offset/length/suffix were requested;
    // normalise to an explicit byte window for Content-Range.
    const offset = "offset" in range && range.offset !== undefined ? range.offset : 0;
    const length =
      "length" in range && range.length !== undefined ? range.length : object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors({ "Access-Control-Max-Age": "86400" }) });
    }

    if (url.pathname.startsWith("/api/espn")) {
      return espn(request, ctx);
    }

    if (url.pathname.startsWith("/data/")) {
      return serveParquet(request, env);
    }

    // Where the browser should point DuckDB-WASM. Keeping this server-supplied
    // means the bucket can move between environments without a rebuild.
    if (url.pathname === "/api/config") {
      return new Response(JSON.stringify({ parquetBase: env.PARQUET_BASE }), {
        headers: cors({ "content-type": "application/json", "cache-control": "public, max-age=300" }),
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
