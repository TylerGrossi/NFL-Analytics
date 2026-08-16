import "server-only";
import { ESPN_USER_AGENT } from "./espn";

/**
 * Translating a live ESPN game into the state our models take.
 *
 * The subtle part is field position. ESPN's `situation.yardLine` is measured
 * from the HOME team's goal line, not from whoever has the ball — verified
 * against live games where the home team on its own 40 reads 40, while a road
 * team on its own 29 reads 71. Our models use `yardline_100`: yards from the
 * possessing team to the end zone it is attacking.
 */

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export type LiveState = {
  eventId: string;
  state: "pre" | "in" | "post";
  detail: string;
  period: number | null;
  clock: string | null;
  home: { id: string; abbr: string; name: string; logo: string | null; score: number };
  away: { id: string; abbr: string; name: string; logo: string | null; score: number };
  /** Null when nobody has the ball — halftime, between possessions, pregame. */
  possession: {
    teamId: string;
    abbr: string;
    isHome: boolean;
    down: number | null;
    distance: number | null;
    yardline100: number | null;
    spotText: string | null;
    scoreDifferential: number;
    secondsRemaining: number;
    timeouts: number;
    defenseTimeouts: number;
    isRedZone: boolean;
  } | null;
  lastPlay: string | null;
  venue: string | null;
  broadcast: string | null;
};

type Json = Record<string, unknown>;

function clockToSeconds(display: string | null | undefined): number {
  if (!display) return 0;
  const [m, s] = display.split(":").map(Number);
  if (Number.isNaN(m)) return 0;
  return m * 60 + (Number.isNaN(s) ? 0 : s);
}

/** Seconds left in regulation. Overtime reports zero — the models stop there. */
export function gameSecondsRemaining(period: number | null, clock: string | null): number {
  if (!period || period < 1) return 3600;
  if (period > 4) return 0;
  return (4 - period) * 900 + clockToSeconds(clock);
}

export async function fetchLiveGame(eventId: string): Promise<LiveState | null> {
  let data: Json | null = null;
  try {
    const res = await fetch(`${SITE}/scoreboard?limit=100`, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    data = (await res.json()) as Json;
  } catch {
    return null;
  }

  const events = (data.events ?? []) as Json[];
  const event = events.find((e) => String(e.id) === String(eventId));
  if (!event) return null;
  return shapeEvent(event);
}

export async function fetchLiveScoreboard(): Promise<LiveState[]> {
  try {
    const res = await fetch(`${SITE}/scoreboard?limit=100`, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Json;
    return ((data.events ?? []) as Json[]).map(shapeEvent).filter((g): g is LiveState => g !== null);
  } catch {
    return [];
  }
}

function shapeEvent(event: Json): LiveState | null {
  const comp = ((event.competitions ?? []) as Json[])[0];
  if (!comp) return null;

  const status = (event.status ?? {}) as Json;
  const statusType = (status.type ?? {}) as Json;
  const competitors = (comp.competitors ?? []) as Json[];
  const situation = (comp.situation ?? {}) as Json;

  const side = (which: string) => {
    const c = competitors.find((x) => x.homeAway === which) ?? {};
    const team = (c.team ?? {}) as Json;
    return {
      id: String(team.id ?? ""),
      abbr: String(team.abbreviation ?? ""),
      name: String(team.displayName ?? ""),
      logo: (team.logo as string) ?? null,
      score: Number(c.score ?? 0),
    };
  };

  const home = side("home");
  const away = side("away");
  const period = (status.period as number) ?? null;
  const clock = (status.displayClock as string) ?? null;

  const possessionId = situation.possession ? String(situation.possession) : null;
  let possession: LiveState["possession"] = null;

  if (possessionId && (possessionId === home.id || possessionId === away.id)) {
    const isHome = possessionId === home.id;
    const offense = isHome ? home : away;
    const defense = isHome ? away : home;

    // yardLine is measured from the home goal line; flip it for the home team.
    const rawYardLine = situation.yardLine;
    const yardline100 =
      typeof rawYardLine === "number"
        ? Math.max(1, Math.min(99, isHome ? 100 - rawYardLine : rawYardLine))
        : null;

    possession = {
      teamId: possessionId,
      abbr: offense.abbr,
      isHome,
      down: (situation.down as number) ?? null,
      distance: (situation.distance as number) ?? null,
      yardline100,
      spotText: (situation.possessionText as string) ?? null,
      scoreDifferential: offense.score - defense.score,
      secondsRemaining: gameSecondsRemaining(period, clock),
      timeouts: Number((isHome ? situation.homeTimeouts : situation.awayTimeouts) ?? 3),
      defenseTimeouts: Number((isHome ? situation.awayTimeouts : situation.homeTimeouts) ?? 3),
      isRedZone: Boolean(situation.isRedZone),
    };
  }

  return {
    eventId: String(event.id),
    state: (statusType.state as LiveState["state"]) ?? "pre",
    detail: (statusType.shortDetail as string) ?? "",
    period,
    clock,
    home,
    away,
    possession,
    lastPlay: ((situation.lastPlay as Json)?.text as string) ?? null,
    venue: ((comp.venue as Json)?.fullName as string) ?? null,
    broadcast:
      (((comp.broadcasts ?? []) as Json[])[0]?.names as string[] | undefined)?.[0] ?? null,
  };
}

// ---------------------------------------------------------------- summary

export type DriveSummary = {
  id: string;
  team: string;
  teamLogo: string | null;
  result: string;
  displayResult: string;
  isScore: boolean;
  yards: number;
  plays: number;
  description: string;
  startText: string | null;
  startPeriod: number | null;
  endPeriod: number | null;
  endClock: string | null;
};

export type TeamStat = { name: string; label: string; home: string; away: string };

export type LeaderLine = {
  category: string;
  team: string;
  name: string;
  headshot: string | null;
  playerId: string | null;
  value: string;
};

export type ScoringPlay = {
  id: string;
  team: string;
  text: string;
  period: number | null;
  clock: string | null;
  homeScore: number;
  awayScore: number;
};

export type GameSummary = {
  winProbability: { homeWin: number; playId: string }[];
  drives: DriveSummary[];
  teamStats: TeamStat[];
  leaders: LeaderLine[];
  scoringPlays: ScoringPlay[];
};

/** Stats worth showing side by side; ESPN returns ~25 and most are noise. */
const HEADLINE_STATS = [
  "totalYards",
  "yardsPerPlay",
  "firstDowns",
  "thirdDownEff",
  "fourthDownEff",
  "netPassingYards",
  "rushingYards",
  "turnovers",
  "totalPenaltiesYards",
  "possessionTime",
];

export async function fetchGameSummary(eventId: string): Promise<GameSummary | null> {
  let data: Json;
  try {
    const res = await fetch(`${SITE}/summary?event=${eventId}`, {
      headers: { "User-Agent": ESPN_USER_AGENT },
      next: { revalidate: 15 },
    });
    if (!res.ok) return null;
    data = (await res.json()) as Json;
  } catch {
    return null;
  }

  // --- win probability
  const winProbability = ((data.winprobability ?? []) as Json[])
    .map((w) => ({
      homeWin: Number(w.homeWinPercentage ?? 0),
      playId: String(w.playId ?? ""),
    }))
    .filter((w) => Number.isFinite(w.homeWin));

  // --- drives, newest first
  const driveBlock = (data.drives ?? {}) as Json;
  const rawDrives = [
    ...(((driveBlock.previous ?? []) as Json[]) ?? []),
    ...(driveBlock.current ? [driveBlock.current as Json] : []),
  ];
  const seenDrives = new Set<string>();
  const drives: DriveSummary[] = rawDrives
    .filter((d) => {
      // The in-progress drive shows up in both `previous` and `current`.
      const key = String(d.id ?? "");
      if (seenDrives.has(key)) return false;
      seenDrives.add(key);
      return true;
    })
    .map((d) => {
      const team = (d.team ?? {}) as Json;
      const start = (d.start ?? {}) as Json;
      const end = (d.end ?? {}) as Json;
      const logos = (team.logos ?? []) as Json[];
      return {
        id: String(d.id ?? ""),
        team: String(team.abbreviation ?? ""),
        teamLogo: (logos[0]?.href as string) ?? null,
        result: String(d.result ?? ""),
        displayResult: String(d.displayResult ?? d.result ?? ""),
        isScore: Boolean(d.isScore),
        yards: Number(d.yards ?? 0),
        plays: Number(d.offensivePlays ?? 0),
        description: String(d.description ?? ""),
        startText: (start.text as string) ?? null,
        startPeriod: ((start.period as Json)?.number as number) ?? null,
        endPeriod: ((end.period as Json)?.number as number) ?? null,
        endClock: ((end.clock as Json)?.displayValue as string) ?? null,
      };
    })
    .reverse();

  // --- team stats
  const boxTeams = ((data.boxscore as Json)?.teams ?? []) as Json[];
  const statsFor = (which: string) => {
    const t = boxTeams.find((x) => x.homeAway === which);
    const list = ((t?.statistics ?? []) as Json[]) ?? [];
    return new Map(list.map((s) => [String(s.name), String(s.displayValue ?? "")]));
  };
  const homeStats = statsFor("home");
  const awayStats = statsFor("away");
  const labels = new Map(
    boxTeams
      .flatMap((t) => ((t.statistics ?? []) as Json[]) ?? [])
      .map((s) => [String(s.name), String(s.label ?? s.name)])
  );
  const teamStats: TeamStat[] = HEADLINE_STATS.filter(
    (n) => homeStats.has(n) || awayStats.has(n)
  ).map((n) => ({
    name: n,
    label: labels.get(n) ?? n,
    home: homeStats.get(n) ?? "—",
    away: awayStats.get(n) ?? "—",
  }));

  // --- leaders
  const leaders: LeaderLine[] = [];
  for (const block of (data.leaders ?? []) as Json[]) {
    const teamAbbr = String(((block.team ?? {}) as Json).abbreviation ?? "");
    for (const cat of (block.leaders ?? []) as Json[]) {
      const top = ((cat.leaders ?? []) as Json[])[0];
      if (!top) continue;
      const athlete = (top.athlete ?? {}) as Json;
      leaders.push({
        category: String(cat.displayName ?? cat.name ?? ""),
        team: teamAbbr,
        name: String(athlete.displayName ?? ""),
        headshot: ((athlete.headshot as Json)?.href as string) ?? null,
        playerId: (athlete.id as string) ?? null,
        value: String(top.displayValue ?? ""),
      });
    }
  }

  // --- scoring plays
  const scoringPlays: ScoringPlay[] = ((data.scoringPlays ?? []) as Json[]).map((s) => ({
    id: String(s.id ?? ""),
    team: String(((s.team ?? {}) as Json).abbreviation ?? ""),
    text: String(s.text ?? ""),
    period: ((s.period as Json)?.number as number) ?? null,
    clock: ((s.clock as Json)?.displayValue as string) ?? null,
    homeScore: Number(s.homeScore ?? 0),
    awayScore: Number(s.awayScore ?? 0),
  }));

  return { winProbability, drives, teamStats, leaders, scoringPlays };
}
