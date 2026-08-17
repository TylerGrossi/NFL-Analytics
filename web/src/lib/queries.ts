import { cache } from "react";
import {
  chartedSpan,
  pbpGlob,
  pbpSpan,
  query,
  queryOne,
  readDataJson,
  table,
} from "./db";

/** Every page's data access lives here so SQL never leaks into components. */

// ----------------------------------------------------------------- types

export type Manifest = {
  generated_at: string;
  stats_season: number;
  scheduled_season: number;
  seasons: number[];
  season_state: { season: number; state: string; current_week: number; games_played: number; games_total: number };
  prev_season_state: { season: number; state: string; current_week: number; games_played: number; games_total: number };
  coverage?: { plays: number; games: number; players: number; teams: number };
};

export type Team = {
  team: string;
  name: string;
  nick: string;
  conf: string;
  division: string;
  color: string;
  color2: string;
  logo: string;
  logo_square: string;
  wordmark: string;
  espn_id: string;
};

export type StandingsRow = {
  season: number; team: string; name: string; nick: string; conf: string; division: string;
  games: number; w: number; l: number; t: number; pf: number; pa: number; diff: number;
  pct: number; ppg: number; papg: number; pyth_w: number; luck: number; streak: string;
  div_w: number; div_l: number; conf_w: number; conf_l: number;
  off_rank: number; def_rank: number; net_rank: number; net_adj: number; sos: number;
  div_place: number; seed: number; in_playoffs: boolean;
};

export type TeamSeason = Record<string, number | string | null> & {
  team: string; season: number;
  off_epa: number; def_epa: number; off_adj: number; def_adj: number; net_adj: number;
  off_rank: number; def_rank: number; net_rank: number;
};

export type Game = {
  game_id: string; season: number; game_type: string; week: number; gameday: string;
  weekday: string; gametime: string; away_team: string; home_team: string;
  away_score: number | null; home_score: number | null; result: number | null;
  played: boolean; winner: string | null; spread_line: number | null; total_line: number | null;
  roof: string | null; stadium: string | null; espn: string | null;
  away_qb_name: string | null; home_qb_name: string | null;
  away_coach: string | null; home_coach: string | null;
  div_game: number | null; overtime: number | null;
};

export type PlayerSeasonRow = Record<string, number | string | boolean | null> & {
  player_id: string; player_display_name: string; position: string; recent_team: string;
  season: number; headshot: string | null;
};

// ----------------------------------------------------------------- manifest

export const getManifest = cache(async (): Promise<Manifest> => {
  const m = await readDataJson<Manifest>("manifest.json");
  if (!m) throw new Error("manifest.json is missing — run the pipeline, or check NFLX_DATA_URL");
  return m;
});

/** Every season with team efficiency built — drives the season pickers. */
export const getBuiltSeasons = cache(async (): Promise<number[]> => {
  const rows = await query<{ season: number }>(
    `select distinct season from read_parquet('${table("team_season")}') order by season desc`
  );
  return rows.map((r) => r.season);
});

/** One club's full history, for the franchise trend. */
export const getTeamHistory = cache(async (team: string) => {
  return query<{
    season: number; off_adj: number; def_adj: number; net_adj: number;
    off_rank: number; def_rank: number; net_rank: number;
    w: number; l: number; t: number; pf: number; pa: number;
    seed: number | null; in_playoffs: boolean | null;
  }>(
    `select ts.season, ts.off_adj, ts.def_adj, ts.net_adj,
            ts.off_rank, ts.def_rank, ts.net_rank,
            s.w, s.l, s.t, s.pf, s.pa, s.seed, s.in_playoffs
     from read_parquet('${table("team_season")}') ts
     left join read_parquet('${table("standings")}') s
       on s.season = ts.season and s.team = ts.team
     where ts.team = $1
     order by ts.season desc`,
    [team.toUpperCase()]
  );
});

/** Career WAR total for one player. */
export const getPlayerCareerWar = cache(async (playerId: string) => {
  return queryOne<{
    career_war: number; career_par: number; seasons: number;
    best_season: number; best_season_war: number; career_plays: number;
  }>(
    `select career_war, career_par, seasons, best_season, best_season_war, career_plays
     from read_parquet('${table("war_career")}') where player_id = $1`,
    [playerId]
  );
});

// ----------------------------------------------------------------- teams

export const getTeams = cache(async (): Promise<Team[]> => {
  return query<Team>(`select * from read_parquet('${table("teams")}') order by team`);
});

export const getTeamMap = cache(async (): Promise<Record<string, Team>> => {
  const teams = await getTeams();
  return Object.fromEntries(teams.map((t) => [t.team, t]));
});

export const getTeam = cache(async (abbr: string): Promise<Team | null> => {
  return queryOne<Team>(
    `select * from read_parquet('${table("teams")}') where team = $1`,
    [abbr.toUpperCase()]
  );
});

// ----------------------------------------------------------------- standings

export const getStandings = cache(async (season: number): Promise<StandingsRow[]> => {
  return query<StandingsRow>(
    `select * from read_parquet('${table("standings")}')
     where season = $1 order by conf, seed`,
    [season]
  );
});

// ----------------------------------------------------------------- efficiency

export const getTeamSeasons = cache(async (season: number): Promise<TeamSeason[]> => {
  return query<TeamSeason>(
    `select * from read_parquet('${table("team_season")}')
     where season = $1 order by net_rank`,
    [season]
  );
});

export const getTeamSeason = cache(
  async (team: string, season: number): Promise<TeamSeason | null> => {
    return queryOne<TeamSeason>(
      `select * from read_parquet('${table("team_season")}')
       where season = $1 and team = $2`,
      [season, team.toUpperCase()]
    );
  }
);

// ----------------------------------------------------------------- games

export const getWeeks = cache(async (season: number) => {
  return query<{ week: number; game_type: string; played: number; total: number }>(
    `select week, any_value(game_type) as game_type,
            sum(case when played then 1 else 0 end)::INT as played,
            count(*)::INT as total
     from read_parquet('${table("games")}')
     where season = $1 group by week order by week`,
    [season]
  );
});

export const getGames = cache(async (season: number, week?: number): Promise<Game[]> => {
  const where = week === undefined ? "" : " and week = $2";
  const params: unknown[] = week === undefined ? [season] : [season, week];
  return query<Game>(
    `select * from read_parquet('${table("games")}')
     where season = $1${where} order by gameday, gametime`,
    params
  );
});

// ----------------------------------------------------------------- rolling EPA

/** Per-week offensive and defensive EPA/play for one team — powers the team chart. */
export const getTeamWeeklyEpa = cache(async (season: number, team: string) => {
  return query<{ week: number; off_epa: number | null; def_epa: number | null; plays: number }>(
    `with plays as (
       select week, posteam, defteam, epa
       from read_parquet(${pbpGlob(season)})
       where play_type in ('pass','run') and epa is not null and season_type='REG'
     )
     select week,
            avg(case when posteam = $1 then epa end) as off_epa,
            avg(case when defteam = $1 then epa end) as def_epa,
            count(*)::INT as plays
     from plays
     where posteam = $1 or defteam = $1
     group by week order by week`,
    [team.toUpperCase()]
  );
});

// ----------------------------------------------------------------- players

export const getPlayerSeason = cache(
  async (playerId: string, season: number): Promise<PlayerSeasonRow | null> => {
    return queryOne<PlayerSeasonRow>(
      `select * from read_parquet('${table("player_season")}')
       where player_id = $1 and season = $2`,
      [playerId, season]
    );
  }
);

export const getPlayerBio = cache(async (playerId: string) => {
  return queryOne<Record<string, string | number | null>>(
    `select * from read_parquet('${table("players")}') where player_id = $1`,
    [playerId]
  );
});

export const getPlayerCareer = cache(async (playerId: string) => {
  return query<PlayerSeasonRow>(
    `select * from read_parquet('${table("player_season")}')
     where player_id = $1 order by season desc`,
    [playerId]
  );
});

export const getPlayerGameLog = cache(async (playerId: string, season: number) => {
  return query<Record<string, number | string | null>>(
    `select w.*, g.gameday, g.home_team, g.away_team, g.home_score, g.away_score
     from read_parquet('${table("player_week")}') w
     left join read_parquet('${table("games")}') g using (game_id)
     where w.player_id = $1 and w.season = $2
     order by w.week`,
    [playerId, season]
  );
});

export const searchPlayers = cache(async (q: string, limit = 25) => {
  return query<{ player_id: string; name: string; position: string; team: string; headshot: string | null; last_season: number }>(
    `select player_id, name, position, team, headshot, last_season
     from read_parquet('${table("players")}')
     where lower(name) like lower($1) and last_season is not null
     order by last_season desc, name limit ${Number(limit)}`,
    [`%${q}%`]
  );
});

/** Roster for a team-season, ordered by how much they actually played. */
export const getTeamRoster = cache(async (team: string, season: number) => {
  return query<PlayerSeasonRow>(
    `select player_id, player_display_name, position, position_group, headshot,
            games, off_snaps, def_snaps, off_snap_pct,
            passing_yards, passing_tds, rushing_yards, receiving_yards, receptions,
            targets, total_epa, epa_per_db, epa_per_rush, epa_per_target,
            def_sacks, def_interceptions, def_tackles_solo
     from read_parquet('${table("player_season")}')
     where recent_team = $1 and season = $2
     order by coalesce(off_snaps, 0) + coalesce(def_snaps, 0) desc`,
    [team.toUpperCase(), season]
  );
});

// ----------------------------------------------------------------- leaders

export type LeaderCategory = {
  key: string;
  label: string;
  unit: string;
  metric: string;
  qualifier: string;
  positions: string[];
  digits: number;
  columns: { key: string; label: string; digits?: number }[];
};

export const LEADER_CATEGORIES: LeaderCategory[] = [
  {
    key: "qb-epa", label: "QB · EPA per dropback", unit: "EPA/DB", metric: "epa_per_db",
    qualifier: "dropbacks >= 150", positions: ["QB"], digits: 3,
    columns: [
      { key: "dropbacks", label: "DB" }, { key: "epa_per_db", label: "EPA/DB", digits: 3 },
      { key: "cpoe", label: "CPOE", digits: 1 }, { key: "play_success", label: "Succ%", digits: 3 },
      { key: "passing_yards", label: "Yds" }, { key: "passing_tds", label: "TD" },
      { key: "passing_interceptions", label: "INT" }, { key: "sack_rate", label: "Sack%", digits: 3 },
    ],
  },
  {
    key: "qb-volume", label: "QB · total EPA", unit: "EPA", metric: "total_qb_epa",
    qualifier: "dropbacks >= 150", positions: ["QB"], digits: 1,
    columns: [
      { key: "dropbacks", label: "DB" }, { key: "total_qb_epa", label: "Total EPA", digits: 1 },
      { key: "wpa", label: "WPA", digits: 2 }, { key: "passing_yards", label: "Yds" },
      { key: "passing_tds", label: "TD" }, { key: "deep_epa", label: "Deep EPA", digits: 3 },
    ],
  },
  {
    key: "rb-epa", label: "RB · EPA per rush", unit: "EPA/rush", metric: "epa_per_rush",
    qualifier: "carries >= 80", positions: ["RB", "FB"], digits: 3,
    columns: [
      { key: "carries", label: "Att" }, { key: "epa_per_rush", label: "EPA/rush", digits: 3 },
      { key: "yards_per_carry", label: "YPC", digits: 2 }, { key: "rush_success", label: "Succ%", digits: 3 },
      { key: "rushing_yards", label: "Yds" }, { key: "rushing_tds", label: "TD" },
      { key: "explosive_rush_rate", label: "Expl%", digits: 3 }, { key: "stuff_rate", label: "Stuff%", digits: 3 },
    ],
  },
  {
    key: "wr-epa", label: "WR/TE · EPA per target", unit: "EPA/tgt", metric: "epa_per_target",
    qualifier: "targets >= 50", positions: ["WR", "TE"], digits: 3,
    columns: [
      { key: "targets", label: "Tgt" }, { key: "epa_per_target", label: "EPA/tgt", digits: 3 },
      { key: "receptions", label: "Rec" }, { key: "receiving_yards", label: "Yds" },
      { key: "receiving_tds", label: "TD" }, { key: "wopr", label: "WOPR", digits: 2 },
      { key: "avg_separation", label: "Sep", digits: 2 },
      { key: "avg_yac_above_expectation", label: "YAC+", digits: 2 },
    ],
  },
  {
    key: "wr-separation", label: "WR/TE · average separation", unit: "yards", metric: "avg_separation",
    qualifier: "targets >= 50", positions: ["WR", "TE"], digits: 2,
    columns: [
      { key: "targets", label: "Tgt" }, { key: "avg_separation", label: "Sep", digits: 2 },
      { key: "avg_cushion", label: "Cushion", digits: 2 },
      { key: "avg_intended_air_yards", label: "aDOT", digits: 1 },
      { key: "receptions", label: "Rec" }, { key: "receiving_yards", label: "Yds" },
    ],
  },
  {
    key: "pass-rush", label: "Defense · sacks", unit: "sacks", metric: "def_sacks",
    qualifier: "def_sacks >= 1", positions: [], digits: 1,
    columns: [
      { key: "def_sacks", label: "Sacks", digits: 1 }, { key: "def_qb_hits", label: "QB hits" },
      { key: "def_tackles_for_loss", label: "TFL" },
      { key: "def_tackles_solo", label: "Solo" }, { key: "def_snaps", label: "Snaps" },
    ],
  },
  {
    key: "coverage", label: "Defense · interceptions & PBUs", unit: "INT", metric: "def_interceptions",
    qualifier: "def_pass_defended >= 1", positions: [], digits: 0,
    columns: [
      { key: "def_interceptions", label: "INT" }, { key: "def_pass_defended", label: "PBU" },
      { key: "def_tackles_solo", label: "Solo" }, { key: "def_snaps", label: "Snaps" },
    ],
  },
];

export const getLeaders = cache(
  async (categoryKey: string, season: number, limit = 40): Promise<PlayerSeasonRow[]> => {
    const cat = LEADER_CATEGORIES.find((c) => c.key === categoryKey) ?? LEADER_CATEGORIES[0];
    const posFilter = cat.positions.length
      ? `and position in (${cat.positions.map((p) => `'${p}'`).join(",")})`
      : "";
    return query<PlayerSeasonRow>(
      `select * from read_parquet('${table("player_season")}')
       where season = $1 and ${cat.qualifier} ${posFilter}
         and ${cat.metric} is not null
       order by ${cat.metric} desc
       limit ${Number(limit)}`,
      [season]
    );
  }
);

// ----------------------------------------------------------------- league

/** League-wide rates used on the home page. */
export const getLeaguePulse = cache(async (season: number) => {
  return queryOne<{
    plays: number; pass_epa: number; rush_epa: number; success: number;
    explosive_rate: number; pass_rate: number;
  }>(
    `select count(*)::INT as plays,
            avg(case when play_type='pass' then epa end) as pass_epa,
            avg(case when play_type='run' then epa end) as rush_epa,
            avg(success) as success,
            avg(case when (play_type='pass' and yards_gained>=20)
                       or (play_type='run' and yards_gained>=10) then 1.0 else 0.0 end) as explosive_rate,
            avg(case when play_type='pass' then 1.0 else 0.0 end) as pass_rate
     from read_parquet(${pbpGlob(season)})
     where play_type in ('pass','run') and epa is not null and season_type='REG'`
  );
});

// ----------------------------------------------------------------- fourth down

export type FourthDownPoint = {
  yardline_100: number; ydstogo: number; score_differential: number;
  game_seconds_remaining: number; wp_go: number; wp_fg: number; wp_punt: number | null;
};

/** Grid resolution — inputs snap to these before lookup. */
export const GRID = { seconds: 120, maxScore: 21, maxYtg: 10 };

export function snapToGrid(input: {
  yardline: number; ydstogo: number; scoreDiff: number; seconds: number;
}) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return {
    yardline: clamp(input.yardline, 1, 99),
    ydstogo: clamp(input.ydstogo, 1, GRID.maxYtg),
    scoreDiff: clamp(input.scoreDiff, -GRID.maxScore, GRID.maxScore),
    seconds: clamp(Math.round(input.seconds / GRID.seconds) * GRID.seconds, 0, 3600),
  };
}

export const getFourthDownPoint = cache(
  async (yardline: number, ydstogo: number, scoreDiff: number, seconds: number) => {
    return queryOne<FourthDownPoint>(
      `select * from read_parquet('${table("fourth_down_grid")}')
       where yardline_100 = $1 and ydstogo = $2
         and score_differential = $3 and game_seconds_remaining = $4`,
      [yardline, ydstogo, scoreDiff, seconds]
    );
  }
);

export type FourthDownRates = {
  p_convert: number;
  /** Null when the kick is beyond the model's range (past ~68 yards). */
  p_fg: number | null;
  punt_to: number;
  kick_distance: number;
};

export const getFourthDownRates = cache(
  async (yardline: number, ydstogo: number): Promise<FourthDownRates> => {
  const [conv, kick] = await Promise.all([
    queryOne<{ p_convert: number }>(
      `select p_convert from read_parquet('${table("fourth_down_convert_rates")}')
       where yardline_100 = $1 and ydstogo = $2`,
      [yardline, ydstogo]
    ),
    queryOne<{ p_fg: number | null; punt_to: number; kick_distance: number }>(
      `select p_fg, punt_to, kick_distance from read_parquet('${table("fourth_down_kick_rates")}')
       where yardline_100 = $1`,
      [yardline]
    ),
  ]);
  // The grid always has a row for a valid spot; defaults keep the type honest
  // rather than leaking undefined into the UI.
  return {
    p_convert: conv?.p_convert ?? 0,
    p_fg: kick?.p_fg ?? null,
    punt_to: kick?.punt_to ?? 0,
    kick_distance: kick?.kick_distance ?? yardline + 17,
  };
});

export type FourthDownTeam = {
  season: number; team: string; coach: string | null;
  situations: number; went: number; go_optimal: number; went_when_optimal: number;
  go_rate: number; go_rate_when_optimal: number | null; optimal_rate: number;
  wp_lost: number; clear_errors: number; conversions: number;
};

export const getFourthDownTeams = cache(async (season: number) => {
  return query<FourthDownTeam>(
    `select * from read_parquet('${table("fourth_down_teams")}')
     where season = $1 order by wp_lost`,
    [season]
  );
});

/** Biggest single decisions of a season, by win probability surrendered. */
export const getWorstFourthDowns = cache(async (season: number, limit = 12) => {
  return query<Record<string, string | number | null>>(
    `select f.*, g.gameday, g.week as gweek
     from read_parquet('${table("fourth_downs")}') f
     left join read_parquet('${table("games")}') g using (game_id)
     where f.season = $1 and f.live and f.wp_lost > 0
     order by f.wp_lost desc limit ${Number(limit)}`,
    [season]
  );
});

// ----------------------------------------------------------------- formations

export type FormationSplit = {
  season: number; team: string; side: string; dimension: string; value: string;
  plays: number; rate: number; epa: number | null; success: number | null; pass_rate: number | null;
};

export const getFormationSplits = cache(
  async (season: number, team?: string, dimension?: string) => {
    const where = ["season = $1"];
    const params: unknown[] = [season];
    if (team) {
      params.push(team.toUpperCase());
      where.push(`team = $${params.length}`);
    }
    if (dimension) {
      params.push(dimension);
      where.push(`dimension = $${params.length}`);
    }
    return query<FormationSplit>(
      `select * from read_parquet('${table("formation_splits")}')
       where ${where.join(" and ")} order by dimension, plays desc`,
      params
    );
  }
);

export const getParticipationTeam = cache(async (season: number, team?: string) => {
  const where = team ? " and team = $2" : "";
  const params: unknown[] = team ? [season, team.toUpperCase()] : [season];
  return query<Record<string, number | string | null>>(
    `select * from read_parquet('${table("participation_team")}')
     where season = $1${where} order by team`,
    params
  );
});

// ----------------------------------------------------------------- one game

const NFLVERSE_ID = /^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/;

export function isNflverseGameId(id: string): boolean {
  return NFLVERSE_ID.test(id);
}

export const getGameById = cache(async (gameId: string): Promise<Game | null> => {
  return queryOne<Game>(
    `select * from read_parquet('${table("games")}') where game_id = $1`,
    [gameId]
  );
});

/** Our schedule carries ESPN's event id, so a live page can hand off to analytics. */
export const getGameByEspnId = cache(async (espnId: string): Promise<Game | null> => {
  return queryOne<Game>(
    `select * from read_parquet('${table("games")}') where espn = $1`,
    [String(espnId)]
  );
});

/**
 * Win probability for every play, from the home team's perspective.
 * pbp stores WP for the team in possession, so it flips on change of possession.
 */
export const getGameWinProbability = cache(async (season: number, gameId: string) => {
  return query<{
    play_id: number; qtr: number; clock: number; home_wp: number;
    posteam: string | null; desc: string | null; wpa: number | null; epa: number | null;
    scoring: boolean;
  }>(
    `select play_id, qtr,
            game_seconds_remaining as clock,
            case when posteam = home_team then wp else 1 - wp end as home_wp,
            posteam, "desc", wpa, epa,
            coalesce(touchdown, 0) = 1
              or coalesce(field_goal_result, '') = 'made'
              as scoring
     from read_parquet(${pbpGlob(season)})
     where game_id = $1 and wp is not null
       -- Timeouts, "END QUARTER" and "GAME" rows carry a win probability but no
       -- possession team. \`posteam = home_team\` is then NULL, which is not true,
       -- so the CASE fell through and flipped them: a Seattle timeout at 0.001
       -- was charted as 0.999 and the Super Bowl line spiked to 100 and back.
       and posteam is not null
     order by play_id`,
    [gameId]
  );
});

export const getGameDrives = cache(async (season: number, gameId: string) => {
  return query<{
    drive: number; posteam: string; result: string | null; plays: number;
    yards: number | null; epa: number; start_yardline: number | null; qtr: number;
  }>(
    `select fixed_drive as drive,
            any_value(posteam) as posteam,
            any_value(fixed_drive_result) as result,
            count(*) filter (where play_type in ('pass','run'))::INT as plays,
            max(yardline_100) - min(yardline_100) as yards,
            sum(case when play_type in ('pass','run') then epa else 0 end) as epa,
            max(yardline_100) as start_yardline,
            min(qtr) as qtr
     from read_parquet(${pbpGlob(season)})
     where game_id = $1 and fixed_drive is not null and posteam is not null
     group by fixed_drive
     order by fixed_drive`,
    [gameId]
  );
});

/** The plays that actually swung the game, by win probability added. */
export const getGameTopPlays = cache(async (season: number, gameId: string, limit = 10) => {
  return query<{
    play_id: number; qtr: number; posteam: string; desc: string;
    epa: number; wpa: number; down: number | null; ydstogo: number | null;
  }>(
    `select play_id, qtr, posteam, "desc", epa, wpa, down, ydstogo
     from read_parquet(${pbpGlob(season)})
     where game_id = $1 and wpa is not null and play_type in ('pass','run','field_goal','punt')
     order by abs(wpa) desc limit ${Number(limit)}`,
    [gameId]
  );
});

export const getGameFourthDowns = cache(async (gameId: string) => {
  return query<Record<string, string | number | boolean | null>>(
    `select qtr, posteam, ydstogo, yardline_100, choice, best, wp_lost, optimal,
            wp_go, wp_fg, wp_punt, "desc", game_seconds_remaining
     from read_parquet('${table("fourth_downs")}')
     where game_id = $1 order by play_id`,
    [gameId]
  );
});

/** Team totals computed from the plays themselves, not a box score feed. */
export const getGameTeamSummary = cache(async (season: number, gameId: string) => {
  return query<{
    team: string; plays: number; epa: number; success: number;
    pass_epa: number | null; rush_epa: number | null; explosive: number;
    dropbacks: number; sacks: number; third_conv: number | null;
  }>(
    `select posteam as team,
            count(*)::INT as plays,
            avg(epa) as epa,
            avg(success) as success,
            avg(case when play_type='pass' then epa end) as pass_epa,
            avg(case when play_type='run' then epa end) as rush_epa,
            avg(case when (play_type='pass' and yards_gained>=20)
                       or (play_type='run' and yards_gained>=10) then 1.0 else 0.0 end) as explosive,
            sum(coalesce(qb_dropback,0))::INT as dropbacks,
            sum(coalesce(sack,0))::INT as sacks,
            avg(case when down=3 then coalesce(third_down_converted,0) end) as third_conv
     from read_parquet(${pbpGlob(season)})
     where game_id = $1 and play_type in ('pass','run') and epa is not null
     group by posteam`,
    [gameId]
  );
});

export const getGameBoxScore = cache(async (season: number, gameId: string) => {
  return query<Record<string, string | number | null>>(
    `select player_id, player_display_name, position, team,
            completions, attempts, passing_yards, passing_tds, passing_interceptions,
            carries, rushing_yards, rushing_tds,
            receptions, targets, receiving_yards, receiving_tds,
            passing_epa, rushing_epa, receiving_epa, epa_per_db, dropbacks
     from read_parquet('${table("player_week")}')
     where game_id = $1
       and (coalesce(attempts,0) > 0 or coalesce(carries,0) > 0 or coalesce(targets,0) > 0)
     order by coalesce(passing_yards,0) + coalesce(rushing_yards,0)
              + coalesce(receiving_yards,0) desc`,
    [gameId]
  );
});

// ----------------------------------------------------------------- WAR

export type WarRow = {
  player_id: string; season: number; name: string | null; position: string | null;
  pos_group: string | null; team: string | null; headshot: string | null;
  plays: number; war: number; role_war?: number; role_pct?: number;
  par: number; par_coverage: number | null; par_rush: number | null;
  war_passing: number; war_rushing: number; war_receiving: number;
  war_defense: number; war_line: number;
  war_kicking: number; war_punting: number; war_returns: number;
  plays_passing: number; plays_rushing: number; plays_receiving: number;
  plays_defense: number; plays_line: number;
  plays_kicking: number; plays_punting: number; plays_returns: number;
};

export type CareerWarRow = {
  player_id: string; name: string | null; position: string | null; team: string | null;
  headshot: string | null; career_war: number; career_par: number; career_plays: number;
  seasons: number; first_season: number; last_season: number;
  best_season_war: number; best_season: number; war_per_season: number;
  war_passing: number; war_rushing: number; war_receiving: number;
  war_defense: number; war_line: number;
  war_kicking: number; war_punting: number; war_returns: number;
};

export type WarValidation = {
  points_per_win: number;
  par_note?: string;
  qb_year_over_year_r?: number;
  qb_year_over_year_n?: number;
  team_war_vs_wins_r?: number;
  team_war_vs_wins_r_full_coverage?: number;
  team_war_vs_pythagorean_r_full_coverage?: number;
  full_coverage_from?: number;
  full_coverage_team_seasons?: number;
  team_war_vs_pythagorean_r?: number;
  pythagorean_vs_wins_r?: number;
  team_seasons?: number;
  stability_benchmarks?: Record<string, number>;
  top_seasons?: string[];
  mean_war_by_position?: Record<string, number>;
};

export const getWarValidation = cache(async (): Promise<WarValidation | null> => {
  return readDataJson<WarValidation>("war_validation.json");
});

/**
 * Usage floors, the way every stats site sets a qualifier.
 *
 * Baseball has a plate-appearance minimum for the batting title for exactly
 * this reason: without one, the leaderboard fills with men who had a hot
 * fortnight. A back with 130 carries is a committee piece, not a lead back,
 * and putting him above a 300-carry starter fails the first thing a reader
 * checks. Roughly a starter's half-season at each position.
 */
const WAR_MIN_PLAYS: Record<string, number> = {
  ALL: 150, QB: 250, RB: 200, WR: 90, TE: 65, DEF: 300, OL: 350, ST: 25,
};

export const getWarLeaders = cache(
  async (season: number, position = "ALL", limit = 50): Promise<WarRow[]> => {
    const floor = WAR_MIN_PLAYS[position] ?? 60;
    const posFilter =
      position === "ALL"
        ? ""
        : position === "WR"
          ? "and position in ('WR','TE')"
          : position === "DEF"
            ? "and coalesce(plays_defense, 0) > 0"
            : position === "OL"
              ? "and coalesce(plays_line, 0) > 0"
              : position === "ST"
                ? "and (coalesce(plays_kicking,0) + coalesce(plays_punting,0) + coalesce(plays_returns,0)) > 0"
            : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    // Rank by the value the filter is asking about. Ordering a receiver list
    // by total WAR floats kick returners who happen to be listed at receiver
    // above the men who actually caught the ball.
    const ORDER: Record<string, string> = {
      QB: "coalesce(war_passing, 0)",
      RB: "coalesce(war_rushing, 0) + coalesce(war_receiving, 0)",
      WR: "coalesce(war_receiving, 0)",
      TE: "coalesce(war_receiving, 0)",
      DEF: "coalesce(war_defense, 0)",
      OL: "coalesce(war_line, 0)",
      ST: "coalesce(war_kicking,0) + coalesce(war_punting,0) + coalesce(war_returns,0)",
    };
    const orderBy = ORDER[position] ?? "war";
    // The number beside a player has to be the number the board is about. A
    // running back list that ranks on rushing and receiving but prints total
    // WAR still shows a kick returner carrying a positive figure, which is the
    // thing the ranking was meant to stop.
    //
    // The percentile is computed over the qualified pool before the limit, so
    // it answers "against everyone with a starter's sample at this position
    // this season" rather than "against the fifty rows we chose to show". It
    // exists because the WAR scale is not readable across positions: a back's
    // best season is about a fifth of a win, so 0.13 and 0.05 look like noise
    // until you know one is the best in the league and the other is average.
    return query<WarRow>(
      `select *, percent_rank() over (order by role_war) as role_pct
       from (
         select *, ${orderBy} as role_war
         from read_parquet('${table("war_season")}')
         where season = $1 and plays >= ${Number(floor)} ${posFilter}
       ) q
       order by role_war desc limit ${Number(limit)}`,
      [season]
    );
  }
);

export const getPlayerWar = cache(async (playerId: string) => {
  return query<WarRow>(
    `select * from read_parquet('${table("war_season")}')
     where player_id = $1 order by season desc`,
    [playerId]
  );
});

// ----------------------------------------------------------------- stats explorer

export type StatsQuery = {
  mode: "players" | "teams";
  source?: string;
  season: number;
  columns: string[];
  qualifierColumn: string;
  qualifierMin: number;
  positions?: string[];
  position?: string;
  team?: string;
  sort: string;
  dir: "asc" | "desc";
  limit: number;
};

/** Only registry-declared identifiers ever reach the SQL string. */
const IDENT = /^[a-z_][a-z0-9_]*$/;

export const runStatsQuery = cache(
  async (q: StatsQuery): Promise<Record<string, string | number | null>[]> => {
    const safe = (c: string) => (IDENT.test(c) ? c : null);
    const cols = q.columns.map(safe).filter((c): c is string => c !== null);
    const sort = safe(q.sort) ?? cols[0];
    const qualifier = safe(q.qualifierColumn) ?? "games";

    const params: unknown[] = [q.season];
    const where = [`season = $1`, `coalesce(${qualifier}, 0) >= ${Number(q.qualifierMin)}`];

    if (q.mode === "players") {
      if (q.positions?.length) {
        where.push(
          `position in (${q.positions.map((p) => `'${p.replace(/[^A-Z]/g, "")}'`).join(",")})`
        );
      }
      if (q.position && q.position !== "ALL") {
        params.push(q.position);
        where.push(`position = $${params.length}`);
      }
      if (q.team && q.team !== "ALL") {
        params.push(q.team);
        where.push(`recent_team = $${params.length}`);
      }
      const select = [
        "player_id",
        "player_display_name as name",
        "position",
        "recent_team as team",
        "headshot",
        ...cols,
      ].join(", ");
      return query(
        `select ${select}
         from read_parquet('${table("player_season")}')
         where ${where.join(" and ")}
           and ${sort} is not null
         order by ${sort} ${q.dir === "asc" ? "asc" : "desc"} nulls last
         limit ${Number(q.limit)}`,
        params
      );
    }

    if (q.team && q.team !== "ALL") {
      params.push(q.team);
      where.push(`team = $${params.length}`);
    }
    const teamTable = q.source && /^[a-z_]+$/.test(q.source) ? q.source : "team_season";
    return query(
      `select team, ${cols.join(", ")}
       from read_parquet('${table(teamTable)}')
       where ${where.join(" and ")}
         and ${sort} is not null
       order by ${sort} ${q.dir === "asc" ? "asc" : "desc"} nulls last
       limit ${Number(q.limit)}`,
      params
    );
  }
);

// ----------------------------------------------------------------- playoffs

export type PlayoffOdds = {
  season: number; team: string; conf: string; division: string; sims: number;
  expected_wins: number; playoff_odds: number; division_odds: number; top_seed_odds: number;
  seed_1_odds: number; seed_2_odds: number; seed_3_odds: number; seed_4_odds: number;
  seed_5_odds: number; seed_6_odds: number; seed_7_odds: number;
};

export type PlayoffSeed = {
  season: number; conf: string; team: string; seed: number;
  division_winner: boolean; in_playoffs: boolean;
};

export const getPlayoffOdds = cache(async (season: number): Promise<PlayoffOdds[]> => {
  return query<PlayoffOdds>(
    `select * from read_parquet('${table("playoff_odds")}')
     where season = $1 order by conf, playoff_odds desc`,
    [season]
  );
});

export const getPlayoffSeeds = cache(async (season: number): Promise<PlayoffSeed[]> => {
  return query<PlayoffSeed>(
    `select * from read_parquet('${table("playoff_seeds")}')
     where season = $1 order by conf, seed`,
    [season]
  );
});

export const getOddsSeasons = cache(async (): Promise<number[]> => {
  const rows = await query<{ season: number }>(
    `select distinct season from read_parquet('${table("playoff_odds")}') order by season desc`
  );
  return rows.map((r) => r.season);
});

// ----------------------------------------------------------------- cap

export type CapRow = {
  player_id: string | null; player: string; position: string; team: string; season: number;
  cap_hit: number; base_salary: number; prorated_bonus: number; guaranteed_salary: number;
  dead_if_cut: number; cut_savings: number; restructure_savings: number;
  years_remaining: number; apy: number; value: number; guaranteed: number;
  war: number | null; par: number | null; name: string | null; pos_group: string | null;
  depth_pos: string | null; depth_rank: number | null;
  status: string | null; practice: string | null; p_play: number | null; injury: string | null;
};

export type CapSummary = {
  team: string; season: number; committed: number; contracts: number;
  big_hits: number; cap_limit: number; space: number;
};

export const getCapSummary = cache(async (season: number): Promise<CapSummary[]> => {
  return query<CapSummary>(
    `select * from read_parquet('${table("cap_summary")}')
     where season = $1 order by space desc`,
    [season]
  );
});

/**
 * A team's cap sheet with last season's value attached, for surplus, plus where
 * each contract sits on the depth chart and whatever the injury report says.
 *
 * Both joins are gated on the league year being viewed. A depth chart or an
 * injury designation from a season other than this one is not current status,
 * and showing a Super Bowl "Questionable" against next year's cap sheet would
 * be worse than showing nothing.
 */
export const getCapTable = cache(
  async (team: string, season: number, warSeason: number): Promise<CapRow[]> => {
    return query<CapRow>(
      `select c.*, w.war, w.par, w.name, w.pos_group,
              d.depth_pos, d.depth_rank,
              i.status, i.practice, i.p_play, i.injury
       from read_parquet('${table("contracts")}') c
       left join (
         select player_id, war, par, name, pos_group
         from read_parquet('${table("war_season")}')
         where season = $3
       ) w on w.player_id = c.player_id
       left join (
         select player_id, depth_pos, depth_rank
         from read_parquet('${table("depth_charts")}')
         where season = $2
       ) d on d.player_id = c.player_id
       left join (
         select player_id, status, practice, p_play, injury
         from read_parquet('${table("injury_reports")}')
         where report_season = $2 and status <> 'None'
       ) i on i.player_id = c.player_id
       where c.team = $1 and c.season = $2
       order by c.cap_hit desc`,
      [team.toUpperCase(), season, warSeason]
    );
  }
);

export type DepthChartRow = {
  player_id: string; name: string | null; headshot: string | null;
  depth_pos: string; depth_rank: number; depth_as_of: string;
  par: number | null; pos_group: string | null;
  cap_hit: number | null; contract_pos: string | null;
  status: string | null; practice: string | null; p_play: number | null; injury: string | null;
};

/**
 * The full depth chart for one club, with value and money attached.
 *
 * This is the roster, not the cap sheet: rookies and minimum signings appear
 * here with no contract row, which is exactly the population a GM tool needs
 * when it asks who inherits the job after a cut.
 */
export const getTeamDepth = cache(
  async (team: string, season: number, warSeason: number, maxRank = 4):
    Promise<DepthChartRow[]> => {
    return query<DepthChartRow>(
      `select d.player_id, p.name, p.headshot,
              d.depth_pos, d.depth_rank, d.depth_as_of,
              w.par, w.pos_group,
              c.cap_hit, c.position as contract_pos,
              i.status, i.practice, i.p_play, i.injury
       from read_parquet('${table("depth_charts")}') d
       left join read_parquet('${table("players")}') p on p.player_id = d.player_id
       left join (
         select player_id, par, pos_group
         from read_parquet('${table("war_season")}')
         where season = $3
       ) w on w.player_id = d.player_id
       left join (
         select player_id, cap_hit, position
         from read_parquet('${table("contracts")}')
         where season = $2
       ) c on c.player_id = d.player_id
       left join (
         select player_id, status, practice, p_play, injury
         from read_parquet('${table("injury_reports")}')
         where report_season = $2 and status <> 'None'
       ) i on i.player_id = d.player_id
       where d.team = $1 and d.season = $2 and d.depth_rank <= ${Number(maxRank)}
       order by d.depth_pos, d.depth_rank`,
      [team.toUpperCase(), season, warSeason]
    );
  }
);

/** Best and worst value contracts league-wide: PAR against cap dollars. */
export const getSurplusValue = cache(
  async (season: number, warSeason: number, limit = 20) => {
    return query<Record<string, string | number | null>>(
      `select c.player, c.position, c.team, c.cap_hit, c.apy, w.war, w.par,
              w.par / nullif(c.cap_hit, 0) as par_per_million
       from read_parquet('${table("contracts")}') c
       join (
         select player_id, war, par, name from read_parquet('${table("war_season")}')
         where season = $2
       ) w on w.player_id = c.player_id
       where c.season = $1 and c.cap_hit >= 2 and w.par is not null
       order by par_per_million desc
       limit ${Number(limit)}`,
      [season, warSeason]
    );
  }
);

// ----------------------------------------------------------------- separation

export type SeparationRow = {
  player_id: string | null; name: string; position: string; team: string; season: number;
  targets: number; receptions: number; yards: number;
  avg_separation: number; avg_cushion: number; avg_intended_air_yards: number;
  avg_yac_above_expectation: number | null; catch_percentage: number | null;
  expected_separation: number; separation_over_expected: number; separation_score: number;
};

export type CoverageRow = {
  player_id: string | null; pfr_id: string; name: string; position: string; team: string;
  season: number; headshot: string | null;
  tgt: number; cmp: number; cmp_percent: number; yds: number; yds_tgt: number; yds_cmp: number;
  td: number; int: number; rat: number; dadot: number; air: number; yac: number;
  m_tkl_percent: number | null;
  expected_yds_per_target: number; yards_over_expected: number; coverage_score: number;
};

export const getSeparationLeaders = cache(
  async (season: number, limit = 60): Promise<SeparationRow[]> => {
    return query<SeparationRow>(
      `select * from read_parquet('${table("separation_receivers")}')
       where season = $1 order by separation_score desc limit ${Number(limit)}`,
      [season]
    );
  }
);

export const getCoverageLeaders = cache(
  async (season: number, limit = 60): Promise<CoverageRow[]> => {
    return query<CoverageRow>(
      `select * from read_parquet('${table("coverage_defenders")}')
       where season = $1 order by coverage_score desc limit ${Number(limit)}`,
      [season]
    );
  }
);

// ---------------------------------------------------------------------- draft

export type DraftPick = {
  season: number; round: number; pick: number; team: string;
  position: string | null; category: string | null; side: string | null;
  college: string | null; age: number | null;
  games: number; seasons_started: number; probowls: number; allpro: number; hof: boolean | null;
  value: number; value_with_team: number;
  player_id: string | null; pfr_id: string | null; name: string;
  forty: number | null; bench: number | null; vertical: number | null;
  broad_jump: number | null; cone: number | null; shuttle: number | null;
  headshot: string | null; pos_now: string | null;
  career_war: number | null; career_par: number | null;
  pick_expected: number | null; over_expected: number | null;
};

export type DraftCurvePoint = {
  pick: number; raw_value: number; n: number;
  contributor_rate: number; probowl_rate: number;
  value: number; relative: number;
};

export type DraftTeam = {
  team: string; picks: number; value: number; expected: number;
  contributor_rate: number; probowlers: number;
  first_round_value: number | null; late_round_value: number | null;
  surplus: number; surplus_per_pick: number;
};

export const getDraftCurve = cache(async (): Promise<DraftCurvePoint[]> => {
  return query<DraftCurvePoint>(
    `select * from read_parquet('${table("draft_curve")}') order by pick`
  );
});

export const getDraftTeams = cache(async (): Promise<DraftTeam[]> => {
  return query<DraftTeam>(
    `select * from read_parquet('${table("draft_teams")}') order by surplus_per_pick desc`
  );
});

export const getDraftClass = cache(async (season: number): Promise<DraftPick[]> => {
  return query<DraftPick>(
    `select * from read_parquet('${table("draft_picks")}')
     where season = $1 order by pick`,
    [season]
  );
});

/** Best and worst picks against what their slot was worth. */
export const getDraftOutliers = cache(
  async (best: boolean, limit = 20): Promise<DraftPick[]> => {
    return query<DraftPick>(
      `select * from read_parquet('${table("draft_picks")}')
       where over_expected is not null
       order by over_expected ${best ? "desc" : "asc"} limit ${Number(limit)}`
    );
  }
);

export const getDraftSeasons = cache(async (): Promise<number[]> => {
  const rows = await query<{ season: number }>(
    `select distinct season from read_parquet('${table("draft_picks")}') order by season desc`
  );
  return rows.map((r) => r.season);
});

// -------------------------------------------------------------------- fantasy

export type FantasyRow = {
  season: number; player_id: string; name: string; position: string; games: number;
  points: number; points_standard: number; ppg: number;
  targets: number; carries: number; receptions: number;
  target_share: number | null; air_yards_share: number | null;
  replacement_ppg: number; replacement_rank: number;
  vor: number; vor_per_game: number;
  expected_points: number | null; opportunity_points: number | null;
  points_over_expected: number | null;
  weekly_sd: number | null; best_week: number | null; median_week: number | null;
  pos_rank: number; overall_rank: number;
};

export type FantasyReplacement = {
  season: number; position: string; replacement_ppg: number; replacement_rank: number;
};

export const getFantasySeason = cache(
  async (season: number, position: string | null, limit = 60): Promise<FantasyRow[]> => {
    const where = position ? "and position = $2" : "";
    const args: (number | string)[] = position ? [season, position] : [season];
    return query<FantasyRow>(
      `select * from read_parquet('${table("fantasy_season")}')
       where season = $1 ${where}
       order by vor desc nulls last limit ${Number(limit)}`,
      args
    );
  }
);

/** Biggest gaps between points scored and points the usage was worth. */
export const getFantasyRegression = cache(
  async (season: number, over: boolean, limit = 12): Promise<FantasyRow[]> => {
    return query<FantasyRow>(
      `select * from read_parquet('${table("fantasy_season")}')
       where season = $1 and points_over_expected is not null and games >= 8
       order by points_over_expected ${over ? "desc" : "asc"} limit ${Number(limit)}`,
      [season]
    );
  }
);

export const getFantasyReplacement = cache(
  async (season: number): Promise<FantasyReplacement[]> => {
    return query<FantasyReplacement>(
      `select * from read_parquet('${table("fantasy_replacement")}')
       where season = $1 order by position`,
      [season]
    );
  }
);

export const getFantasySeasons = cache(async (): Promise<number[]> => {
  const rows = await query<{ season: number }>(
    `select distinct season from read_parquet('${table("fantasy_season")}') order by season desc`
  );
  return rows.map((r) => r.season);
});

export type DraftBoardRow = {
  season: number; player_id: string; name: string; position: string;
  age: number | null; games_last: number | null;
  ppg_last: number | null; points_last: number | null;
  proj_ppg: number | null; proj_rec_pg: number | null;
  proj_points: number | null; proj_receptions: number | null;
  ecr_redraft: number | null; ecr_superflex: number | null;
  ecr_dynasty: number | null; ecr_dynasty_superflex: number | null;
  ecr_best_ball: number | null; ecr_rookie: number | null;
  ecr_sd_redraft: number | null;
  headshot: string | null; team: string | null;
  ranked_on: string | null; projected: boolean;
  sos_index: number | null; sos_rank: number | null; playoff_rank: number | null;
  bye: number | null; availability: number | null;
  depth_rank: number | null; depth_pos: string | null; depth_as_of: string | null;
  status: string | null; practice: string | null; p_play: number | null; injury: string | null;
  espn_rank: number | null; espn_adp: number | null; espn_pct_owned: number | null;
};

export type EspnValueRow = DraftBoardRow & { gap: number };

/**
 * Players whose ESPN draft position disagrees with the wider consensus.
 * Ownership filters out the tail sitting just above ESPN's undrafted floor,
 * where the ADP is barely distinguishable from the sentinel value.
 */
export const getEspnValue = cache(
  async (minOwned = 20): Promise<EspnValueRow[]> => {
    return query<EspnValueRow>(
      `select *, espn_adp - ecr_redraft as gap
       from read_parquet('${table("fantasy_draft")}')
       where espn_adp is not null
         and ecr_redraft is not null
         and espn_pct_owned >= $1
       order by gap desc`,
      [minOwned]
    );
  }
);

export type InjuryRate = {
  status: string; practice: string | null;
  p_play: number | null; n: number | null;
  p_play_status: number; n_status: number;
};

export const getInjuryRates = cache(async (): Promise<InjuryRate[]> => {
  return query<InjuryRate>(
    `select * from read_parquet('${table("injury_rates")}')
     where practice is not null order by status, p_play desc`
  );
});

// -------------------------------------------------------- in-season fantasy

export type WeeklyRow = {
  season: number; player_id: string; name: string; position: string;
  team: string; headshot: string | null;
  week: number; opponent: string; home: boolean;
  fpa_index: number | null; fpa_rank: number | null; beta: number | null;
  matchup_mult: number; rate: number; proj_week: number;
  games_ytd: number; ppg_ytd: number | null; proj_ppg: number;
  availability: number | null; espn_pct_owned: number | null;
  depth_rank: number | null; depth_pos: string | null;
};

export type RosRow = {
  season: number; player_id: string; name: string; position: string;
  team: string; headshot: string | null;
  ros_points: number; ros_ppg: number; games_left: number; ros_matchup: number;
  games_ytd: number; ppg_ytd: number | null; proj_ppg: number;
  availability: number | null; espn_pct_owned: number | null;
  depth_rank: number | null;
  pos_rank: number; overall_rank: number;
  wire_gap?: number; value_pct?: number;
};

/** Which weeks the in-season table actually covers. */
export const getFantasyWeeks = cache(async (): Promise<number[]> => {
  try {
    const rows = await query<{ week: number }>(
      `select distinct week from read_parquet('${table("fantasy_weekly")}') order by week`
    );
    return rows.map((r) => r.week);
  } catch {
    return [];
  }
});

/** One week's board: every projected player with a game, best start first. */
export const getFantasyWeek = cache(
  async (week: number, position = "ALL", limit = 60): Promise<WeeklyRow[]> => {
    const posFilter =
      position === "ALL" ? "" : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    try {
      return await query<WeeklyRow>(
        `select * from read_parquet('${table("fantasy_weekly")}')
         where week = $1 ${posFilter}
         order by proj_week desc limit ${Number(limit)}`,
        [week]
      );
    } catch {
      return [];
    }
  }
);

export const getRestOfSeason = cache(
  async (position = "ALL", limit = 60): Promise<RosRow[]> => {
    const posFilter =
      position === "ALL" ? "" : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    try {
      return await query<RosRow>(
        `select * from read_parquet('${table("fantasy_ros")}')
         where true ${posFilter}
         order by ros_points desc limit ${Number(limit)}`
      );
    } catch {
      return [];
    }
  }
);

/**
 * Wire candidates: worth more from here than their ownership implies.
 *
 * Preseason this is ownership doing all the work, which is worth saying on the
 * page — it becomes a real scan only once played weeks pull the rate away from
 * the projection everyone drafted off.
 */
export const getWaiverTargets = cache(
  async (position = "ALL", limit = 40): Promise<RosRow[]> => {
    const posFilter =
      position === "ALL" ? "" : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    try {
      return await query<RosRow>(
        `select * from read_parquet('${table("fantasy_waivers")}')
         where true ${posFilter}
         order by wire_gap desc limit ${Number(limit)}`
      );
    } catch {
      return [];
    }
  }
);

export type SosRow = {
  season: number; team: string; position: string;
  sos_index: number; sos_rank: number;
  playoff_index: number | null; playoff_rank: number | null;
  opp_rank_avg: number; games: number;
};

export const getFantasySos = cache(async (): Promise<SosRow[]> => {
  return query<SosRow>(
    `select * from read_parquet('${table("fantasy_sos")}') order by position, sos_rank`
  );
});

export const getDraftBoard = cache(async (): Promise<DraftBoardRow[]> => {
  return query<DraftBoardRow>(
    `select * from read_parquet('${table("fantasy_draft")}')
     order by proj_ppg desc nulls last`
  );
});

/** Ranked but unprojectable — rookies, and returners without a prior season. */
export const getUnprojected = cache(async (limit = 30): Promise<DraftBoardRow[]> => {
  return query<DraftBoardRow>(
    `select * from read_parquet('${table("fantasy_draft")}')
     where not projected and ecr_redraft is not null
     order by ecr_redraft limit ${Number(limit)}`
  );
});

// ------------------------------------------------- depth charts and injuries

export type DepthRow = {
  player_id: string; team: string; depth_pos: string; depth_rank: number;
  depth_as_of: string; season: number; name?: string | null; headshot?: string | null;
};

export type InjuryRow = {
  player_id: string; report_season: number; week: number; team: string;
  position: string; status: string; practice: string;
  p_play: number | null; injury: string | null; name?: string | null;
};

/** Projected starters for one club, by position. */
export const getDepthChart = cache(
  async (team: string, positions: string[] = ["QB", "RB", "WR", "TE"], maxRank = 3):
    Promise<DepthRow[]> => {
    const allow = positions.map((p) => `'${p.replace(/[^A-Z]/g, "")}'`).join(",");
    return query<DepthRow>(
      `select d.*, p.name, p.headshot
       from read_parquet('${table("depth_charts")}') d
       left join read_parquet('${table("players")}') p on p.player_id = d.player_id
       where d.team = $1 and d.depth_pos in (${allow}) and d.depth_rank <= ${Number(maxRank)}
       order by d.depth_pos, d.depth_rank`,
      [team.toUpperCase()]
    );
  }
);

/** Current injury designations for one club, newest report only. */
export const getTeamInjuries = cache(
  async (team: string, season: number): Promise<InjuryRow[]> => {
    return query<InjuryRow>(
      `select i.*, p.name
       from read_parquet('${table("injury_reports")}') i
       left join read_parquet('${table("players")}') p on p.player_id = i.player_id
       where i.team = $1 and i.report_season = $2 and i.status <> 'None'
       order by i.p_play`,
      [team.toUpperCase(), season]
    );
  }
);

// ---------------------------------------------------------- league bridge

export type BridgeEntry = {
  playerId: string; name: string; position: string | null; team: string | null;
};

/** Sleeper player id → our player, built by `build/league_ids.py`. */
export const getSleeperBridge = cache(
  async (): Promise<Map<string, BridgeEntry>> => {
    try {
      const rows = await query<{
        sleeper_id: string; player_id: string; sleeper_name: string;
        sleeper_pos: string | null; sleeper_team: string | null;
      }>(
        `select b.sleeper_id, b.player_id,
                coalesce(p.name, b.sleeper_name) as sleeper_name,
                coalesce(p.position, b.sleeper_pos) as sleeper_pos,
                coalesce(p.team, b.sleeper_team) as sleeper_team
         from read_parquet('${table("player_ids")}') b
         left join read_parquet('${table("players")}') p on p.player_id = b.player_id`
      );
      return new Map(
        rows.map((r) => [
          r.sleeper_id,
          { playerId: r.player_id, name: r.sleeper_name,
            position: r.sleeper_pos, team: r.sleeper_team },
        ])
      );
    } catch {
      return new Map();
    }
  }
);

/** ESPN player id → our player, straight off the index. */
export const getEspnBridge = cache(async (): Promise<Map<string, BridgeEntry>> => {
  try {
    const rows = await query<{
      espn_id: string; player_id: string; name: string;
      position: string | null; team: string | null;
    }>(
      `select espn_id, player_id, name, position, team
       from read_parquet('${table("players")}')
       where espn_id is not null and last_season >= 2024`
    );
    return new Map(
      rows.map((r) => [
        String(r.espn_id),
        { playerId: r.player_id, name: r.name, position: r.position, team: r.team },
      ])
    );
  } catch {
    return new Map();
  }
});

export type VarianceRow = {
  position: string; sd_base: number; sd_slope: number; fit_r: number;
  player_weeks: number;
};

/** The fitted weekly spread per position, for matchup odds. */
export const getFantasyVariance = cache(async (): Promise<VarianceRow[]> => {
  try {
    return await query<VarianceRow>(
      `select * from read_parquet('${table("fantasy_variance")}')`
    );
  } catch {
    return [];
  }
});

export type WeekProj = {
  player_id: string; name: string; position: string; team: string;
  week: number; opponent: string; proj_week: number; matchup_mult: number;
  fpa_rank: number | null;
};

/** One week's projection for every player, keyed for roster lookups. */
export const getWeekProjections = cache(
  async (week: number): Promise<Map<string, WeekProj>> => {
    try {
      const rows = await query<WeekProj>(
        `select player_id, name, position, team, week, opponent,
                proj_week, matchup_mult, fpa_rank
         from read_parquet('${table("fantasy_weekly")}') where week = $1`,
        [week]
      );
      return new Map(rows.map((r) => [r.player_id, r]));
    } catch {
      return new Map();
    }
  }
);

export type RosPoint = {
  player_id: string; ros_points: number; ros_ppg: number;
  games_left: number; pos_rank: number; position: string;
};

/** Rest-of-season projections keyed by player, for valuing a synced roster. */
export const getRosByPlayer = cache(async (): Promise<Map<string, RosPoint>> => {
  try {
    const rows = await query<RosPoint>(
      `select player_id, ros_points, ros_ppg, games_left, pos_rank, position
       from read_parquet('${table("fantasy_ros")}')`
    );
    return new Map(rows.map((r) => [r.player_id, r]));
  } catch {
    return new Map();
  }
});

// --------------------------------------------------------------- coaches

export type CoachCareer = {
  coach: string; first_season: number; last_season: number;
  seasons: number; clubs: number; last_team: string;
  games: number; wins: number; losses: number; ties: number; win_pct: number;
  pass_rate: number | null; proe: number | null; entropy: number | null;
  shotgun_rate: number | null; no_huddle_rate: number | null;
  early_pass_rate: number | null; penalty_rate: number | null;
  go_rate: number | null; go_rate_when_optimal: number | null;
  optimal_rate: number | null; wp_lost: number | null;
  net_adj: number | null; plays: number;
};

export type CoachSeason = CoachCareer & { team: string; season: number };

const COACH_SORTS: Record<string, string> = {
  games: "games desc",
  wins: "win_pct desc",
  aggressive: "go_rate_when_optimal desc nulls last",
  conservative: "go_rate_when_optimal asc nulls last",
  unpredictable: "entropy desc nulls last",
  predictable: "entropy asc nulls last",
  pass: "proe desc nulls last",
  run: "proe asc nulls last",
  tempo: "no_huddle_rate desc nulls last",
};

/**
 * Career coaching records, following a coach across every club he has led.
 *
 * `minGames` keeps the interesting sorts honest — a three-week interim spell
 * will top an aggressiveness table on four fourth downs otherwise.
 */
export const getCoachCareers = cache(
  async (sort = "games", minGames = 32, limit = 60): Promise<CoachCareer[]> => {
    const order = COACH_SORTS[sort] ?? COACH_SORTS.games;
    try {
      return await query<CoachCareer>(
        `select * from read_parquet('${table("coach_careers")}')
         where games >= ${Number(minGames)}
         order by ${order} limit ${Number(limit)}`
      );
    } catch {
      return [];
    }
  }
);

/**
 * The extremes across every qualifying coach.
 *
 * Computed separately rather than off the displayed rows: the table is sorted
 * and limited, so deriving "least predictable" from what happens to be on
 * screen made the headline figures change every time the sort changed.
 */
export const getCoachExtremes = cache(
  async (minGames = 32): Promise<Record<string, { coach: string; value: number }>> => {
    const pick = async (col: string, dir: "desc" | "asc") => {
      const row = await queryOne<{ coach: string; value: number }>(
        `select coach, ${col} as value from read_parquet('${table("coach_careers")}')
         where games >= ${Number(minGames)} and ${col} is not null
         order by ${col} ${dir} limit 1`
      );
      return row;
    };
    try {
      const [unpredictable, predictable, boldest, timid] = await Promise.all([
        pick("entropy", "desc"),
        pick("entropy", "asc"),
        pick("go_rate_when_optimal", "desc"),
        pick("go_rate_when_optimal", "asc"),
      ]);
      const out: Record<string, { coach: string; value: number }> = {};
      if (unpredictable) out.unpredictable = unpredictable;
      if (predictable) out.predictable = predictable;
      if (boldest) out.boldest = boldest;
      if (timid) out.timid = timid;
      return out;
    } catch {
      return {};
    }
  }
);

/** League averages, so a coach's number can be read against something. */
export const getCoachBaseline = cache(async (): Promise<Record<string, number>> => {
  try {
    const row = await queryOne<Record<string, number>>(
      `select avg(entropy) as entropy, avg(proe) as proe,
              avg(go_rate_when_optimal) as go_rate_when_optimal,
              avg(no_huddle_rate) as no_huddle_rate,
              avg(penalty_rate) as penalty_rate
       from read_parquet('${table("coach_careers")}') where games >= 32`
    );
    return row ?? {};
  } catch {
    return {};
  }
});

// --------------------------------------------------------- weekly digest

/** Weeks that actually have completed games, newest first. */
export const getPlayedWeeks = cache(
  async (): Promise<{ season: number; week: number }[]> => {
    return query<{ season: number; week: number }>(
      `select distinct season, week from read_parquet('${table("games")}')
       where played order by season desc, week desc`
    );
  }
);

export type BigPlay = {
  play_id: number; game_id: string; posteam: string; defteam: string;
  qtr: number; desc: string; wpa: number; epa: number;
};

/** The plays that moved win probability most, either direction. */
export const getWeekBigPlays = cache(
  async (season: number, week: number, limit = 10): Promise<BigPlay[]> => {
    return query<BigPlay>(
      `select play_id, game_id, posteam, defteam, qtr, "desc", wpa, epa
       from read_parquet(${pbpGlob(season)})
       where season = $1 and week = $2 and wpa is not null and "desc" is not null
       order by abs(wpa) desc limit ${Number(limit)}`,
      [season, week]
    );
  }
);

export type TeamWeek = {
  team: string; plays: number; epa: number; season_epa: number; delta: number;
};

/**
 * How each side played that week against its own season baseline.
 *
 * Deliberately measured against the club's own average rather than the
 * league's: the interesting thing in a weekly digest is who deviated from
 * themselves, not who is good, which the season tables already answer.
 */
export const getWeekTeamSwings = cache(
  async (season: number, week: number): Promise<TeamWeek[]> => {
    return query<TeamWeek>(
      `with plays as (
         select posteam as team, week, epa
         from read_parquet(${pbpGlob(season)})
         where season = $1 and posteam is not null and epa is not null
           and play_type in ('pass','run')
       ),
       season_avg as (select team, avg(epa) as season_epa from plays group by 1),
       this_week as (
         select team, count(*) as plays, avg(epa) as epa
         from plays where week = $2 group by 1
       )
       select t.team, t.plays, t.epa, s.season_epa, t.epa - s.season_epa as delta
       from this_week t join season_avg s using (team)
       where t.plays >= 20
       order by delta desc`,
      [season, week]
    );
  }
);

export type FourthMiss = {
  game_id: string; posteam: string; qtr: number; ydstogo: number;
  yardline_100: number; choice: string; best: string; wp_lost: number; desc: string;
};

/** Fourth downs where the choice cost the most win probability. */
export const getWeekFourthMisses = cache(
  async (season: number, week: number, limit = 8): Promise<FourthMiss[]> => {
    return query<FourthMiss>(
      `select game_id, posteam, qtr, ydstogo, yardline_100, choice, best, wp_lost, "desc"
       from read_parquet('${table("fourth_downs")}')
       where season = $1 and week = $2 and not optimal and wp_lost is not null
       order by wp_lost desc limit ${Number(limit)}`,
      [season, week]
    );
  }
);

export type WeekUpset = {
  game_id: string; home_team: string; away_team: string;
  home_score: number; away_score: number;
  spread_line: number | null; margin: number; market_err: number;
  proj_margin: number; model_err: number;
};

/** Results that surprised the closing line most. */
export const getWeekUpsets = cache(
  async (season: number, week: number, limit = 6): Promise<WeekUpset[]> => {
    try {
      return await query<WeekUpset>(
        `select game_id, home_team, away_team, home_score, away_score,
                spread_line, margin, market_err, proj_margin, model_err
         from read_parquet('${table("market_games")}')
         where season = $1 and week = $2 and spread_line is not null
         order by abs(market_err) desc limit ${Number(limit)}`,
        [season, week]
      );
    } catch {
      return [];
    }
  }
);

export type PlayerWeek = {
  player_id: string; player_display_name: string; position: string;
  team: string; fantasy_points_ppr: number | null; wpa: number | null;
  epa_per_db: number | null; dropbacks: number | null;
};

/**
 * The best individual weeks, across the skill positions.
 *
 * Ranked on PPR rather than win probability added because `wpa` in the weekly
 * player table is only populated for passers — in a sample week it covered 32
 * of 34 quarterbacks and one receiver out of 128. Ranking on it produced a
 * "best individual weeks" list that was ten quarterbacks by construction. WPA
 * is still carried as a column where it exists.
 */
export const getWeekPlayers = cache(
  async (season: number, week: number, limit = 12): Promise<PlayerWeek[]> => {
    return query<PlayerWeek>(
      `select player_id, player_display_name, position, team,
              fantasy_points_ppr, wpa, epa_per_db, dropbacks
       from read_parquet('${table("player_week")}')
       where season = $1 and week = $2
         and position in ('QB','RB','WR','TE')
         and fantasy_points_ppr is not null
       order by fantasy_points_ppr desc limit ${Number(limit)}`,
      [season, week]
    );
  }
);

// ------------------------------------------------- pick value and aging

export type PickValueRow = {
  pick: number; n: number;
  war: number; av: number;
  war_relative: number; av_relative: number;
  raw_war: number; raw_av: number;
};

/** Expected career return by pick, in both currencies. */
export const getPickCurve = cache(async (): Promise<PickValueRow[]> => {
  try {
    return await query<PickValueRow>(
      `select * from read_parquet('${table("trade_picks")}') order by pick`
    );
  } catch {
    return [];
  }
});

export type PickMixRow = {
  band: string; position: string; n: number; war: number; av: number;
};

/**
 * What each band of the draft actually returned, by position.
 *
 * This is the table that explains why the two currencies disagree about what a
 * top pick is worth: in WAR it is almost entirely quarterbacks.
 */
export const getPickMix = cache(async (band = "1-10"): Promise<PickMixRow[]> => {
  try {
    return await query<PickMixRow>(
      `select * from read_parquet('${table("trade_pick_mix")}')
       where band = $1 order by war desc`,
      [band]
    );
  } catch {
    return [];
  }
});

export type AgingRow = {
  pos_group: string; age: number; delta: number; n: number; rel_war: number;
};

/** The aging curve for one position group, falling back to all positions. */
export const getAgingCurve = cache(
  async (posGroup: string | null): Promise<AgingRow[]> => {
    try {
      const rows = await query<AgingRow>(
        `select * from read_parquet('${table("trade_aging")}')
         where pos_group = $1 order by age`,
        [posGroup ?? "ALL"]
      );
      if (rows.length >= 5) return rows;
      return await query<AgingRow>(
        `select * from read_parquet('${table("trade_aging")}')
         where pos_group = 'ALL' order by age`
      );
    } catch {
      return [];
    }
  }
);

// -------------------------------------------------------------------- market

export type MarketValidation = {
  games: number; games_with_line: number;
  first_season: number; last_season: number;
  model: { rmse: number; mae: number };
  market: { rmse: number; mae: number };
  straight_up: number | null; straight_up_games: number;
  ats_hit_rate: number | null; ats_games: number; ats_pushes: number;
  total_hit_rate: number | null; total_games: number;
  breakeven: number;
  correlation_with_line: number | null;
  ats_by_edge: { from: number; to: number | null; hit_rate: number; games: number }[];
  calibration: { bucket: string; predicted: number; actual: number; games: number }[];
};

export const getMarketValidation = cache(async (): Promise<MarketValidation | null> => {
  return readDataJson<MarketValidation>("market_validation.json");
});

export type MarketTeam = {
  team: string; avg_vs_line: number; cover_rate: number; games: number;
};

export const getMarketTeams = cache(async (): Promise<MarketTeam[]> => {
  try {
    return await query<MarketTeam>(
      `select * from read_parquet('${table("market_teams")}') order by avg_vs_line desc`
    );
  } catch {
    return [];
  }
});

export type MarketGame = {
  game_id: string; season: number; week: number;
  home_team: string; away_team: string;
  spread_line: number | null; proj_margin: number; edge: number;
  margin: number; ats_win: boolean | null; home_wp: number;
};

/** The games where the model disagreed most with the market, and what happened. */
export const getMarketDisagreements = cache(
  async (limit = 20): Promise<MarketGame[]> => {
    try {
      return await query<MarketGame>(
        `select * from read_parquet('${table("market_games")}')
         where spread_line is not null
         order by abs(edge) desc limit ${Number(limit)}`
      );
    } catch {
      return [];
    }
  }
);

// ------------------------------------------------------------------- previews

export type GamePreview = {
  game_id: string; season: number; week: number;
  gameday: string; gametime: string | null;
  home_team: string; away_team: string;
  spread_line: number | null; total_line: number | null;
  proj_margin: number; proj_total: number; home_wp: number;
  proj_home_score: number; proj_away_score: number;
  carry_weight: number; games_used: number;
};

export const getGamePreview = cache(async (gameId: string): Promise<GamePreview | null> => {
  return queryOne<GamePreview>(
    `select * from read_parquet('${table("game_previews")}') where game_id = $1`,
    [gameId]
  );
});

export const getWeekPreviews = cache(
  async (season: number, week: number): Promise<GamePreview[]> => {
    return query<GamePreview>(
      `select * from read_parquet('${table("game_previews")}')
       where season = $1 and week = $2 order by gameday, gametime`,
      [season, week]
    );
  }
);

/** Receivers for one club, best separation first — the attacking half of a matchup. */
export const getTeamSeparation = cache(
  async (team: string, season: number, limit = 5): Promise<SeparationRow[]> => {
    return query<SeparationRow>(
      `select * from read_parquet('${table("separation_receivers")}')
       where season = $1 and team = $2
       order by separation_score desc limit ${Number(limit)}`,
      [season, team.toUpperCase()]
    );
  }
);

/** Coverage defenders for one club, best first — the defending half. */
export const getTeamCoverage = cache(
  async (team: string, season: number, limit = 5): Promise<CoverageRow[]> => {
    return query<CoverageRow>(
      `select * from read_parquet('${table("coverage_defenders")}')
       where season = $1 and team = $2
       order by coverage_score desc limit ${Number(limit)}`,
      [season, team.toUpperCase()]
    );
  }
);

export const getSeparationSeasons = cache(async (): Promise<number[]> => {
  const rows = await query<{ season: number }>(
    `select distinct season from read_parquet('${table("separation_receivers")}') order by season desc`
  );
  return rows.map((r) => r.season);
});

/** Career totals, now meaningful with 27 seasons in the store. */
export const getCareerWar = cache(
  async (position = "ALL", limit = 50): Promise<CareerWarRow[]> => {
    const floor = position === "ALL" ? 500 : 300;
    const posFilter =
      position === "ALL"
        ? ""
        : position === "WR"
          ? "and position in ('WR','TE')"
          : position === "DEF"
            ? "and coalesce(war_defense, 0) <> 0"
            : position === "OL"
              ? "and coalesce(war_line, 0) <> 0"
              : position === "ST"
                ? "and (coalesce(war_kicking,0) + coalesce(war_punting,0) + coalesce(war_returns,0)) <> 0"
                : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    return query<CareerWarRow>(
      `select * from read_parquet('${table("war_career")}')
       where career_plays >= ${Number(floor)} ${posFilter}
       order by career_war desc limit ${Number(limit)}`
    );
  }
);

/** The best individual seasons ever recorded in the store. */
export const getAllTimeSeasons = cache(
  async (position = "ALL", limit = 50): Promise<WarRow[]> => {
    const posFilter =
      position === "ALL"
        ? ""
        : position === "WR"
          ? "and position in ('WR','TE')"
          : position === "DEF"
            ? "and coalesce(plays_defense, 0) > 0"
            : position === "OL"
              ? "and coalesce(plays_line, 0) > 0"
              : position === "ST"
                ? "and (coalesce(plays_kicking,0) + coalesce(plays_punting,0) + coalesce(plays_returns,0)) > 0"
                : `and position = '${position.replace(/[^A-Z]/g, "")}'`;
    return query<WarRow>(
      `select * from read_parquet('${table("war_season")}')
       where plays >= 100 ${posFilter}
       order by war desc limit ${Number(limit)}`
    );
  }
);

// ----------------------------------------------------------------- the Lab

export type SplitRow = {
  key: string;
  name: string | null;
  team: string | null;
  plays: number;
  epa: number;
  success: number;
  explosive: number;
  cpoe: number | null;
  yards: number;
};

// `chartedGlob` now lives in db.ts alongside `pbpGlob`, because both have to
// switch between a filesystem glob and an explicit URL list depending on where
// the store is. Re-exported here so existing call sites keep working.

/**
 * Arbitrary split over the play store.
 *
 * `where` fragments and the grouping column arrive from the registry in
 * splits.ts, never from user input, so composing them into SQL is safe.
 */
export const runSplitQuery = cache(
  async (opts: {
    charted: boolean;
    seasonFrom: number;
    seasonTo: number;
    where: string[];
    groupColumn: string;
    groupIsPlayer: boolean;
    requires?: string;
    minPlays: number;
    limit: number;
  }): Promise<SplitRow[]> => {
    const source = opts.charted
      ? chartedSpan(Number(opts.seasonFrom), Number(opts.seasonTo))
      : pbpSpan(Number(opts.seasonFrom), Number(opts.seasonTo));
    const clauses = [
      `season between ${Number(opts.seasonFrom)} and ${Number(opts.seasonTo)}`,
      "epa is not null",
      `${opts.groupColumn} is not null`,
      ...(opts.charted ? [] : ["season_type = 'REG'"]),
      ...(opts.requires ? [opts.requires] : []),
      ...opts.where,
    ];

    const rows = await query<SplitRow>(
      `select ${opts.groupColumn} as key,
              any_value(posteam) as team,
              count(*)::INT as plays,
              avg(epa) as epa,
              avg(success) as success,
              avg(case when (play_type = 'pass' and yards_gained >= 20)
                         or (play_type = 'run' and yards_gained >= 10)
                       then 1.0 else 0.0 end) as explosive,
              avg(cpoe) as cpoe,
              avg(yards_gained) as yards
       from read_parquet(${source})
       where ${clauses.join(" and ")}
       group by ${opts.groupColumn}
       having count(*) >= ${Number(opts.minPlays)}
       order by avg(epa) desc
       limit ${Number(opts.limit)}`
    );

    if (!opts.groupIsPlayer) {
      return rows.map((r) => ({ ...r, name: r.key }));
    }

    const ids = rows.map((r) => r.key).filter(Boolean);
    if (ids.length === 0) return rows.map((r) => ({ ...r, name: null }));
    const names = await query<{ player_id: string; name: string }>(
      `select player_id, name from read_parquet('${table("players")}')
       where player_id in (${ids.map((_, i) => `$${i + 1}`).join(",")})`,
      ids
    );
    const byId = new Map(names.map((n) => [n.player_id, n.name]));
    return rows.map((r) => ({ ...r, name: byId.get(r.key) ?? r.key }));
  }
);

/** League totals for the same split, so a row can be read against the baseline. */
export const runSplitBaseline = cache(
  async (opts: {
    charted: boolean;
    seasonFrom: number;
    seasonTo: number;
    where: string[];
    requires?: string;
  }) => {
    const source = opts.charted
      ? chartedSpan(Number(opts.seasonFrom), Number(opts.seasonTo))
      : pbpSpan(Number(opts.seasonFrom), Number(opts.seasonTo));
    const clauses = [
      `season between ${Number(opts.seasonFrom)} and ${Number(opts.seasonTo)}`,
      "epa is not null",
      ...(opts.charted ? [] : ["season_type = 'REG'"]),
      ...(opts.requires ? [opts.requires] : []),
      ...opts.where,
    ];
    return queryOne<{ plays: number; epa: number; success: number; explosive: number }>(
      `select count(*)::INT as plays,
              avg(epa) as epa,
              avg(success) as success,
              avg(case when (play_type = 'pass' and yards_gained >= 20)
                         or (play_type = 'run' and yards_gained >= 10)
                       then 1.0 else 0.0 end) as explosive
       from read_parquet(${source})
       where ${clauses.join(" and ")}`
    );
  }
);
