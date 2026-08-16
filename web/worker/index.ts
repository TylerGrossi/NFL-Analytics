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
 *   2. Their edge 403s an unrecognised User-Agent that carries a `name/version`
 *      token. Browsers will not let script set User-Agent, so the header has to
 *      be applied server-side. This was a silent, total outage once already —
 *      see HANDOFF.md §5.
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
      headers: { "User-Agent": "hashmark-analytics (personal project)" },
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors({ "Access-Control-Max-Age": "86400" }) });
    }

    if (url.pathname.startsWith("/api/espn")) {
      return espn(request, ctx);
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
