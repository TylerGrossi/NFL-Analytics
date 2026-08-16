import "server-only";
import { ESPN_USER_AGENT } from "./espn";

/**
 * Reading a real fantasy league off Sleeper or ESPN.
 *
 * Both are read at request time and normalised to one shape, so every tool
 * downstream is written once. Neither is stored: a league id in the URL is the
 * whole of the state, which means no accounts, no database, and nothing of the
 * user's to leak.
 *
 * **Sleeper** is open — no key, no auth, 90 requests a minute per IP.
 * **ESPN** serves public leagues unauthenticated and answers 401 for private
 * ones. Private leagues need `SWID` and `espn_s2` cookies out of a logged-in
 * browser session, which this deliberately does not ask for: those cookies are
 * full account credentials, not scoped tokens.
 */

export type LeaguePlatform = "sleeper" | "espn";

export type LeagueSlot = {
  /** Our gsis id, when the player could be bridged. */
  playerId: string | null;
  name: string;
  position: string | null;
  nflTeam: string | null;
  starter: boolean;
};

export type LeagueTeam = {
  id: string;
  name: string;
  owner: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  roster: LeagueSlot[];
};

export type League = {
  platform: LeaguePlatform;
  id: string;
  name: string;
  season: number;
  week: number | null;
  teamCount: number;
  scoring: "standard" | "half" | "ppr";
  teams: LeagueTeam[];
  /** Starting slots, in order — Sleeper reports these exactly. */
  slots: string[];
  /** Players on a roster we could not bridge to the store. */
  unmatched: number;
};

/** A sane default when a platform does not report its lineup slots. */
export const DEFAULT_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

export type LeagueError = { error: string; hint?: string };

const SLEEPER = "https://api.sleeper.app/v1";
const ESPN_FF = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

async function getJson<T>(url: string, revalidate = 300): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A reception is worth 1, 0.5 or 0 — the only thing scoring formats differ on. */
function scoringFromPpr(ppr: number | undefined): League["scoring"] {
  if (ppr === undefined) return "ppr";
  if (ppr >= 0.75) return "ppr";
  if (ppr >= 0.25) return "half";
  return "standard";
}

// ------------------------------------------------------------------ sleeper

type SleeperLeague = {
  name: string; season: string; total_rosters: number;
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
  settings?: Record<string, number>;
};
type SleeperRoster = {
  roster_id: number; owner_id: string | null; players: string[] | null;
  starters: string[] | null;
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number;
               fpts_decimal?: number; fpts_against?: number; fpts_against_decimal?: number };
};
type SleeperUser = { user_id: string; display_name: string; metadata?: { team_name?: string } };

export async function fetchSleeperLeague(
  leagueId: string,
  bridge: Map<string, { playerId: string; name: string; position: string | null; team: string | null }>
): Promise<League | LeagueError> {
  const id = leagueId.replace(/[^0-9]/g, "");
  if (!id) return { error: "A Sleeper league id is all digits.", hint: "Find it in the league URL." };

  const league = await getJson<SleeperLeague>(`${SLEEPER}/league/${id}`);
  if (!league) {
    return {
      error: "Sleeper does not know that league id.",
      hint: "Open your league on sleeper.app — the id is the long number in the address bar.",
    };
  }

  const [rosters, users, state] = await Promise.all([
    getJson<SleeperRoster[]>(`${SLEEPER}/league/${id}/rosters`),
    getJson<SleeperUser[]>(`${SLEEPER}/league/${id}/users`),
    getJson<{ week: number; season_type: string }>(`${SLEEPER}/state/nfl`, 900),
  ]);

  const owner = new Map((users ?? []).map((u) => [u.user_id, u]));
  let unmatched = 0;

  const teams: LeagueTeam[] = (rosters ?? []).map((r) => {
    const starters = new Set(r.starters ?? []);
    const u = r.owner_id ? owner.get(r.owner_id) : undefined;
    const s = r.settings ?? {};
    const roster: LeagueSlot[] = (r.players ?? []).map((pid) => {
      const hit = bridge.get(pid);
      if (!hit) unmatched += 1;
      return {
        playerId: hit?.playerId ?? null,
        name: hit?.name ?? `Sleeper #${pid}`,
        position: hit?.position ?? null,
        nflTeam: hit?.team ?? null,
        starter: starters.has(pid),
      };
    });
    return {
      id: String(r.roster_id),
      name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
      owner: u?.display_name ?? null,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      pointsAgainst: (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
      roster,
    };
  });

  return {
    platform: "sleeper",
    id,
    name: league.name,
    season: Number(league.season),
    // Sleeper's state week counts preseason weeks too, so in August it reads
    // "week 2" while the regular season has not started. Only trust it once
    // the season type says regular; before that the useful week is 1.
    week: state?.season_type === "regular" ? state.week : 1,
    teamCount: league.total_rosters,
    scoring: scoringFromPpr(league.scoring_settings?.rec),
    teams,
    // "BN" is the bench and "IR" is not a lineup slot.
    slots: (league.roster_positions ?? DEFAULT_SLOTS).filter(
      (p) => p !== "BN" && p !== "IR" && p !== "TAXI"
    ),
    unmatched,
  };
}

// --------------------------------------------------------------------- espn

type EspnTeam = {
  id: number; name?: string; abbrev?: string; location?: string; nickname?: string;
  record?: { overall?: { wins?: number; losses?: number; ties?: number;
                         pointsFor?: number; pointsAgainst?: number } };
  roster?: {
    entries?: {
      lineupSlotId?: number;
      playerPoolEntry?: {
        player?: { id?: number; fullName?: string; defaultPositionId?: number;
                   proTeamId?: number };
      };
    }[];
  };
};
type EspnLeague = {
  settings?: { name?: string; scoringSettings?: { scoringItems?: { statId: number; points: number }[] } };
  seasonId?: number; scoringPeriodId?: number;
  status?: { currentMatchupPeriod?: number };
  teams?: EspnTeam[];
};

// ESPN's own position ids, which match nobody else's.
const ESPN_POS: Record<number, string> = {
  1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF",
};
// Slot 20 is bench, 21 is IR; everything else is a started lineup slot.
const ESPN_BENCH = new Set([20, 21]);

export async function fetchEspnLeague(
  leagueId: string,
  season: number,
  byEspnId: Map<string, { playerId: string; name: string; position: string | null; team: string | null }>
): Promise<League | LeagueError> {
  const id = leagueId.replace(/[^0-9]/g, "");
  if (!id) return { error: "An ESPN league id is all digits." };

  const url =
    `${ESPN_FF}/${season}/segments/0/leagues/${id}` +
    `?view=mTeam&view=mRoster&view=mSettings`;
  const data = await getJson<EspnLeague>(url);
  if (!data) {
    return {
      error: "ESPN would not serve that league.",
      hint:
        "Public leagues work with the id alone. A private league needs your account cookies, " +
        "which this site does not ask for — set the league to public in ESPN's settings, or use Sleeper.",
    };
  }

  // 53 is receptions; its value is what separates PPR from standard.
  const rec = data.settings?.scoringSettings?.scoringItems?.find((i) => i.statId === 53);
  let unmatched = 0;

  const teams: LeagueTeam[] = (data.teams ?? []).map((t) => {
    const overall = t.record?.overall ?? {};
    const roster: LeagueSlot[] = (t.roster?.entries ?? []).map((e) => {
      const p = e.playerPoolEntry?.player;
      const hit = p?.id ? byEspnId.get(String(p.id)) : undefined;
      if (!hit) unmatched += 1;
      return {
        playerId: hit?.playerId ?? null,
        name: hit?.name ?? p?.fullName ?? "Unknown",
        position: hit?.position ?? ESPN_POS[p?.defaultPositionId ?? -1] ?? null,
        nflTeam: hit?.team ?? null,
        starter: !ESPN_BENCH.has(e.lineupSlotId ?? 20),
      };
    });
    return {
      id: String(t.id),
      name: t.name || [t.location, t.nickname].filter(Boolean).join(" ") || `Team ${t.id}`,
      owner: t.abbrev ?? null,
      wins: overall.wins ?? 0,
      losses: overall.losses ?? 0,
      ties: overall.ties ?? 0,
      pointsFor: overall.pointsFor ?? 0,
      pointsAgainst: overall.pointsAgainst ?? 0,
      roster,
    };
  });

  return {
    platform: "espn",
    id,
    name: data.settings?.name ?? `ESPN league ${id}`,
    season: data.seasonId ?? season,
    week: data.status?.currentMatchupPeriod ?? data.scoringPeriodId ?? null,
    teamCount: teams.length,
    scoring: scoringFromPpr(rec?.points),
    teams,
    slots: DEFAULT_SLOTS,
    unmatched,
  };
}

export type LeagueChoice = {
  id: string; name: string; season: number; teamCount: number; avatar: string | null;
};

/**
 * The Sleeper "connect" flow: a username, not a league id.
 *
 * Sleeper has no OAuth, and does not need one — the read API is public, so a
 * username resolves to a user id and a user id lists their leagues. That is a
 * real connect flow with no credentials involved, which is why this exists for
 * Sleeper and not for ESPN.
 *
 * Falls back to the previous season when the requested one is empty: in August
 * a lot of leagues have not been recreated yet, and showing "no leagues" to
 * someone who plainly has some is worse than showing last year's.
 */
export async function fetchSleeperUserLeagues(
  username: string,
  season: number
): Promise<{ leagues: LeagueChoice[]; season: number; display: string } | LeagueError> {
  const clean = username.trim().replace(/^@/, "");
  if (!clean) return { error: "Enter your Sleeper username." };

  const user = await getJson<{ user_id?: string; display_name?: string } | null>(
    `${SLEEPER}/user/${encodeURIComponent(clean)}`,
    900
  );
  if (!user || !user.user_id) {
    return {
      error: `Sleeper has no user called "${clean}".`,
      hint: "This is your Sleeper username, not your team name or display name in one league.",
    };
  }

  for (const yr of [season, season - 1]) {
    const raw = await getJson<
      { league_id: string; name: string; season: string; total_rosters: number;
        avatar: string | null }[]
    >(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${yr}`, 300);
    if (raw && raw.length) {
      return {
        season: yr,
        display: user.display_name ?? clean,
        leagues: raw.map((l) => ({
          id: l.league_id,
          name: l.name,
          season: Number(l.season),
          teamCount: l.total_rosters,
          avatar: l.avatar,
        })),
      };
    }
  }
  return {
    error: `${user.display_name ?? clean} has no NFL leagues on Sleeper for ${season} or ${season - 1}.`,
  };
}

export type WeekScore = { week: number; rosterId: string; points: number; matchupId: number | null };

/**
 * Every completed week's score for every roster.
 *
 * Needed for all-play records, which is the honest way to rank a fantasy
 * league: your actual record depends on the schedule, and the schedule is
 * random. Scoring your week against all nine other teams instead of the one
 * you drew separates a good team from a lucky one.
 */
export async function fetchSleeperHistory(
  leagueId: string,
  maxWeek = 18
): Promise<WeekScore[]> {
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const pages = await Promise.all(
    weeks.map((w) =>
      getJson<{ roster_id: number; points: number | null; matchup_id: number | null }[]>(
        `${SLEEPER}/league/${leagueId}/matchups/${w}`,
        900
      ).then((rows) => ({ week: w, rows: rows ?? [] }))
    )
  );
  const out: WeekScore[] = [];
  for (const { week, rows } of pages) {
    // A week nobody scored in has not been played; a bye-less zero is possible
    // but a whole league at zero is not.
    if (!rows.some((r) => (r.points ?? 0) > 0)) continue;
    for (const r of rows) {
      out.push({
        week,
        rosterId: String(r.roster_id),
        points: r.points ?? 0,
        matchupId: r.matchup_id ?? null,
      });
    }
  }
  return out;
}

export type Move = {
  week: number | null;
  type: string;
  created: number;
  rosterIds: string[];
  adds: string[];
  drops: string[];
};

/** The league's transaction log, newest first. */
export async function fetchSleeperMoves(
  leagueId: string,
  maxWeek = 18,
  limit = 40
): Promise<Move[]> {
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const pages = await Promise.all(
    weeks.map((w) =>
      getJson<
        {
          type: string; status: string; created: number; leg?: number;
          roster_ids?: number[];
          adds?: Record<string, number> | null;
          drops?: Record<string, number> | null;
        }[]
      >(`${SLEEPER}/league/${leagueId}/transactions/${w}`, 900).then((rows) => ({
        week: w,
        rows: rows ?? [],
      }))
    )
  );
  const out: Move[] = [];
  for (const { week, rows } of pages) {
    for (const t of rows) {
      if (t.status !== "complete") continue;
      out.push({
        week,
        type: t.type,
        created: t.created,
        rosterIds: (t.roster_ids ?? []).map(String),
        adds: Object.keys(t.adds ?? {}),
        drops: Object.keys(t.drops ?? {}),
      });
    }
  }
  return out.sort((a, b) => b.created - a.created).slice(0, limit);
}

export function isLeagueError(v: League | LeagueError): v is LeagueError {
  return (v as LeagueError).error !== undefined;
}
