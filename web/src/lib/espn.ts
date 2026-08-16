import "server-only";

/**
 * ESPN's public-but-undocumented API. Used for live game state only — anything
 * historical comes from the nflverse parquet store, which is authoritative.
 *
 * There is no SLA. Every call fails soft: a null return renders the page
 * without the live strip rather than erroring.
 */

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

/**
 * Identify honestly, but without a `name/version` token.
 *
 * ESPN's edge 403s an unrecognised agent that carries one, so
 * "hashmark-analytics/0.1" was refused on every endpoint while the same string
 * minus the version is served. Verified deterministic. Exported because
 * `live.ts` calls the same API directly and drifted out of sync once already —
 * every ESPN request in the app must use this constant.
 */
export const ESPN_USER_AGENT = "hashmark-analytics (personal project)";

export type LiveTeam = {
  abbr: string | null;
  name: string | null;
  logo: string | null;
  score: number | null;
  record: string | null;
  winner: boolean;
};

export type LiveGame = {
  id: string;
  date: string;
  state: "pre" | "in" | "post";
  detail: string;
  venue: string | null;
  broadcast: string | null;
  home: LiveTeam;
  away: LiveTeam;
  downDistance: string | null;
  possession: string | null;
  lastPlay: string | null;
};

type EspnJson = Record<string, unknown>;

async function get(pathname: string, params: Record<string, string> = {}, revalidate = 30) {
  const url = new URL(`${SITE}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as EspnJson;
  } catch {
    return null;
  }
}

function team(competitor: EspnJson | undefined): LiveTeam {
  const t = (competitor?.team ?? {}) as EspnJson;
  const scoreRaw = competitor?.score;
  const score = Number(scoreRaw);
  const records = (competitor?.records ?? []) as EspnJson[];
  return {
    abbr: (t.abbreviation as string) ?? null,
    name: (t.displayName as string) ?? null,
    logo: (t.logo as string) ?? null,
    score: Number.isFinite(score) && scoreRaw !== undefined ? score : null,
    record: (records.find((r) => r.type === "total")?.summary as string) ?? null,
    winner: Boolean(competitor?.winner),
  };
}

export async function getScoreboard(params?: {
  week?: number;
  season?: number;
  seasonType?: number;
  dates?: string;
}): Promise<LiveGame[]> {
  const q: Record<string, string> = { limit: "100" };
  if (params?.week) q.week = String(params.week);
  if (params?.season) q.year = String(params.season);
  if (params?.seasonType) q.seasontype = String(params.seasonType);
  if (params?.dates) q.dates = params.dates;

  const data = await get("/scoreboard", q);
  const events = (data?.events ?? []) as EspnJson[];

  return events.map((ev): LiveGame => {
    const comp = ((ev.competitions ?? []) as EspnJson[])[0] ?? {};
    const competitors = (comp.competitors ?? []) as EspnJson[];
    const status = (ev.status ?? {}) as EspnJson;
    const statusType = (status.type ?? {}) as EspnJson;
    const situation = (comp.situation ?? {}) as EspnJson;
    const broadcasts = (comp.broadcasts ?? []) as EspnJson[];

    return {
      id: String(ev.id),
      date: String(ev.date),
      state: (statusType.state as LiveGame["state"]) ?? "pre",
      detail: (statusType.shortDetail as string) ?? "",
      venue: ((comp.venue as EspnJson)?.fullName as string) ?? null,
      broadcast: ((broadcasts[0]?.names as string[]) ?? [])[0] ?? null,
      home: team(competitors.find((c) => c.homeAway === "home")),
      away: team(competitors.find((c) => c.homeAway === "away")),
      downDistance: (situation.downDistanceText as string) ?? null,
      possession: (situation.possession as string) ?? null,
      lastPlay: ((situation.lastPlay as EspnJson)?.text as string) ?? null,
    };
  });
}

/** True when any game is actually in progress — drives the live badge. */
export function hasLiveGames(games: LiveGame[]): boolean {
  return games.some((g) => g.state === "in");
}

export type NewsItem = { headline: string; description: string; link: string; published: string };

export async function getNews(limit = 10): Promise<NewsItem[]> {
  const data = await get("/news", { limit: String(limit) }, 600);
  const articles = (data?.articles ?? []) as EspnJson[];
  return articles.map((a) => ({
    headline: (a.headline as string) ?? "",
    description: (a.description as string) ?? "",
    link: (((a.links as EspnJson)?.web as EspnJson)?.href as string) ?? "",
    published: (a.published as string) ?? "",
  }));
}

/** Full game detail: drives, scoring plays, box score, ESPN's own win probability. */
export async function getGameSummary(eventId: string) {
  return get("/summary", { event: eventId }, 30);
}

export type Highlight = {
  id: string;
  headline: string;
  description: string;
  duration: number | null;
  thumbnail: string | null;
  link: string;
  restricted: string[] | null;
};

/** mm:ss for a clip length. */
export function clipLength(seconds: number | null): string {
  if (!seconds || seconds < 0) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/**
 * Highlight clips ESPN has attached to a game.
 *
 * These are cards that link out to ESPN's player, not embedded video. The
 * payload does hand over a direct CDN mp4, but playing it here would hotlink
 * their bandwidth, skip the ad the clip is monetised by, and — since a clip
 * can be licensed to a whitelist of countries — serve it to territories it was
 * never cleared for. The link is the honest use of the feed.
 *
 * Availability is narrow and worth stating plainly: clips ride along with a
 * game for days, not years. Sampling fourteen 2025 regular-season games six
 * months on returned zero; games from the previous night returned four or five
 * each. So this renders during and just after a game, and is absent from the
 * archive by design rather than by failure.
 */
export async function getGameHighlights(eventId: string): Promise<Highlight[]> {
  const data = await get("/summary", { event: eventId }, 300);
  const videos = (data?.videos ?? []) as EspnJson[];
  const now = Date.now();

  return videos
    .map((v): Highlight | null => {
      const links = (v.links ?? {}) as EspnJson;
      const link = ((links.web as EspnJson)?.href as string) ?? "";
      if (!link) return null;

      // Respect the feed's own windows rather than showing a dead card.
      const time = (v.timeRestrictions ?? {}) as EspnJson;
      const embargo = time.embargoDate ? Date.parse(String(time.embargoDate)) : null;
      const expires = time.expirationDate ? Date.parse(String(time.expirationDate)) : null;
      if (embargo && Number.isFinite(embargo) && now < embargo) return null;
      if (expires && Number.isFinite(expires) && now > expires) return null;

      const geo = (v.geoRestrictions ?? {}) as EspnJson;
      const countries = (geo.countries as string[]) ?? [];

      return {
        id: String(v.id ?? link),
        headline: (v.headline as string) ?? "",
        description: (v.description as string) ?? "",
        duration: Number.isFinite(Number(v.duration)) ? Number(v.duration) : null,
        thumbnail: (v.thumbnail as string) ?? null,
        link,
        restricted: geo.type === "whitelist" && countries.length ? countries : null,
      };
    })
    .filter((v): v is Highlight => v !== null);
}
