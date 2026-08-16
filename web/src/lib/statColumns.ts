/**
 * The stat registry.
 *
 * Everything the pipeline stores, grouped the way a football person looks for
 * it rather than the way the source tables happen to be shaped. Each entry
 * names the parquet column, a short header, and how to render it — the stats
 * page builds its SQL and its table straight from this.
 */

export type Fmt =
  | "int" | "num1" | "num2" | "num3"
  | "pct" | "pct0"
  | "signed" | "signed1" | "signed2"
  | "pts" | "text";

export type StatColumn = {
  key: string;
  label: string;
  fmt: Fmt;
  /** Lower is better — flips the default sort and the color ramp. */
  lowerBetter?: boolean;
  title?: string;
};

export type StatGroup = {
  key: string;
  label: string;
  /** Parquet table to read; defaults to player_season / team_season by mode. */
  source?: string;
  /** Column the leaderboard sorts by when you open the group. */
  sort: string;
  /** Rows must clear this to appear; keeps one-snap players out. */
  qualifier: { column: string; min: number; label: string };
  /** Restrict to these positions when set. */
  positions?: string[];
  columns: StatColumn[];
};

// ------------------------------------------------------------------ players

export const PLAYER_GROUPS: StatGroup[] = [
  {
    key: "passing",
    label: "Passing",
    sort: "passing_yards",
    qualifier: { column: "attempts", min: 100, label: "attempts" },
    positions: ["QB"],
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "completions", label: "Cmp", fmt: "int" },
      { key: "attempts", label: "Att", fmt: "int" },
      { key: "passing_yards", label: "Yds", fmt: "int" },
      { key: "passing_tds", label: "TD", fmt: "int" },
      { key: "passing_interceptions", label: "Int", fmt: "int", lowerBetter: true },
      { key: "passing_first_downs", label: "1D", fmt: "int" },
      { key: "sacks_suffered", label: "Sk", fmt: "int", lowerBetter: true },
      { key: "sack_yards_lost", label: "SkYds", fmt: "int", lowerBetter: true },
      { key: "passing_air_yards", label: "AirYds", fmt: "int" },
      { key: "passing_yards_after_catch", label: "YAC", fmt: "int" },
      { key: "passing_epa", label: "EPA", fmt: "signed1" },
      { key: "cpoe", label: "CPOE", fmt: "pts" },
      { key: "pacr", label: "PACR", fmt: "num2" },
      { key: "passing_20", label: "20+", fmt: "int" },
      { key: "passing_40", label: "40+", fmt: "int" },
    ],
  },
  {
    key: "rushing",
    label: "Rushing",
    sort: "rushing_yards",
    qualifier: { column: "carries", min: 40, label: "carries" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "carries", label: "Att", fmt: "int" },
      { key: "rushing_yards", label: "Yds", fmt: "int" },
      { key: "yards_per_carry", label: "Y/A", fmt: "num2" },
      { key: "rushing_tds", label: "TD", fmt: "int" },
      { key: "rushing_first_downs", label: "1D", fmt: "int" },
      { key: "rushing_fumbles_lost", label: "FumL", fmt: "int", lowerBetter: true },
      { key: "rushing_epa", label: "EPA", fmt: "signed1" },
      { key: "epa_per_rush", label: "EPA/A", fmt: "signed" },
      { key: "rush_success", label: "Succ%", fmt: "pct0" },
      { key: "explosive_rush_rate", label: "Expl%", fmt: "pct0" },
      { key: "stuff_rate", label: "Stuff%", fmt: "pct0", lowerBetter: true },
      { key: "rushing_20", label: "20+", fmt: "int" },
      { key: "rushing_40", label: "40+", fmt: "int" },
    ],
  },
  {
    key: "receiving",
    label: "Receiving",
    sort: "receiving_yards",
    qualifier: { column: "targets", min: 25, label: "targets" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "targets", label: "Tgt", fmt: "int" },
      { key: "receptions", label: "Rec", fmt: "int" },
      { key: "receiving_yards", label: "Yds", fmt: "int" },
      { key: "yards_per_target", label: "Y/T", fmt: "num2" },
      { key: "receiving_tds", label: "TD", fmt: "int" },
      { key: "receiving_first_downs", label: "1D", fmt: "int" },
      { key: "receiving_air_yards", label: "AirYds", fmt: "int" },
      { key: "receiving_yards_after_catch", label: "YAC", fmt: "int" },
      { key: "target_share", label: "Tgt%", fmt: "pct0" },
      { key: "air_yards_share", label: "Air%", fmt: "pct0" },
      { key: "wopr", label: "WOPR", fmt: "num2" },
      { key: "racr", label: "RACR", fmt: "num2" },
      { key: "receiving_epa", label: "EPA", fmt: "signed1" },
      { key: "epa_per_target", label: "EPA/T", fmt: "signed" },
      { key: "receiving_20", label: "20+", fmt: "int" },
    ],
  },
  {
    key: "defense",
    label: "Defense",
    sort: "def_sacks",
    qualifier: { column: "def_snaps", min: 100, label: "defensive snaps" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "def_snaps", label: "Snaps", fmt: "int" },
      { key: "def_sacks", label: "Sacks", fmt: "num1" },
      { key: "def_qb_hits", label: "QBH", fmt: "int" },
      { key: "def_tackles_for_loss", label: "TFL", fmt: "int" },
      { key: "def_tackles_solo", label: "Solo", fmt: "int" },
      { key: "def_tackle_assists", label: "Ast", fmt: "int" },
      { key: "def_interceptions", label: "Int", fmt: "int" },
      { key: "def_pass_defended", label: "PD", fmt: "int" },
      { key: "def_fumbles_forced", label: "FF", fmt: "int" },
      { key: "def_tds", label: "TD", fmt: "int" },
      { key: "def_safeties", label: "Sfty", fmt: "int" },
    ],
  },
  {
    key: "kicking",
    label: "Kicking",
    sort: "fg_made",
    qualifier: { column: "fg_att", min: 10, label: "attempts" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "fg_made", label: "FGM", fmt: "int" },
      { key: "fg_att", label: "FGA", fmt: "int" },
      { key: "fg_pct", label: "FG%", fmt: "num1" },
      { key: "fg_long", label: "Long", fmt: "int" },
      { key: "fg_made_40_49", label: "40-49", fmt: "int" },
      { key: "fg_made_50_59", label: "50-59", fmt: "int" },
      { key: "fg_made_60_", label: "60+", fmt: "int" },
      { key: "fg_blocked", label: "Blk", fmt: "int", lowerBetter: true },
      { key: "pat_made", label: "XPM", fmt: "int" },
      { key: "pat_att", label: "XPA", fmt: "int" },
      { key: "gwfg_made", label: "GW", fmt: "int" },
    ],
  },
  {
    key: "punting",
    label: "Punting",
    sort: "pt_net_yards",
    qualifier: { column: "pt_att", min: 15, label: "punts" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "pt_att", label: "Punts", fmt: "int" },
      { key: "pt_yards", label: "Yds", fmt: "int" },
      { key: "pt_net_yards", label: "Net", fmt: "int" },
      { key: "pt_long", label: "Long", fmt: "int" },
      { key: "pt_inside_20", label: "In20", fmt: "int" },
      { key: "pt_touchback", label: "TB", fmt: "int", lowerBetter: true },
      { key: "pt_fair_caught", label: "FC", fmt: "int" },
      { key: "pt_returned", label: "Ret", fmt: "int", lowerBetter: true },
      { key: "pt_return_yards", label: "RetYds", fmt: "int", lowerBetter: true },
      { key: "pt_blocked", label: "Blk", fmt: "int", lowerBetter: true },
    ],
  },
  {
    key: "returns",
    label: "Returns",
    sort: "kickoff_return_yards",
    qualifier: { column: "games", min: 4, label: "games" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "punt_returns", label: "PR", fmt: "int" },
      { key: "punt_return_yards", label: "PRYds", fmt: "int" },
      { key: "kickoff_returns", label: "KR", fmt: "int" },
      { key: "kickoff_return_yards", label: "KRYds", fmt: "int" },
      { key: "special_teams_tds", label: "TD", fmt: "int" },
      { key: "st_snaps", label: "ST Snaps", fmt: "int" },
    ],
  },
  {
    key: "nextgen",
    label: "Next Gen",
    sort: "avg_separation",
    qualifier: { column: "games", min: 6, label: "games" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "avg_separation", label: "Sep", fmt: "num2", title: "Average separation at the catch point, yards" },
      { key: "avg_cushion", label: "Cush", fmt: "num2" },
      { key: "avg_yac_above_expectation", label: "YAC+", fmt: "signed2" },
      { key: "avg_intended_air_yards", label: "aDOT", fmt: "num1" },
      { key: "percent_share_of_intended_air_yards", label: "AirSh%", fmt: "num1" },
      { key: "avg_time_to_throw", label: "TTT", fmt: "num2", title: "Average time to throw, seconds" },
      { key: "aggressiveness", label: "Aggr%", fmt: "num1" },
      { key: "avg_completed_air_yards", label: "CAY", fmt: "num1" },
      { key: "rush_yards_over_expected_per_att", label: "RYOE/A", fmt: "signed" },
      { key: "percent_attempts_gte_eight_defenders", label: "8+Box%", fmt: "num1" },
      { key: "efficiency", label: "Eff", fmt: "num2", lowerBetter: true },
    ],
  },
  {
    key: "advanced",
    label: "Advanced",
    sort: "total_epa",
    qualifier: { column: "games", min: 4, label: "games" },
    columns: [
      { key: "games", label: "G", fmt: "int" },
      { key: "off_snaps", label: "Snaps", fmt: "int" },
      { key: "total_epa", label: "Total EPA", fmt: "signed1" },
      { key: "dropbacks", label: "DB", fmt: "int" },
      { key: "epa_per_db", label: "EPA/DB", fmt: "signed" },
      { key: "play_success", label: "Succ%", fmt: "pct0" },
      { key: "sack_rate", label: "Sack%", fmt: "pct0", lowerBetter: true },
      { key: "deep_epa", label: "Deep EPA", fmt: "signed" },
      { key: "third_epa", label: "3rd EPA", fmt: "signed" },
      { key: "wpa", label: "WPA", fmt: "signed1" },
      { key: "epa_per_rush", label: "EPA/rush", fmt: "signed" },
      { key: "epa_per_target", label: "EPA/tgt", fmt: "signed" },
      { key: "fantasy_points_ppr", label: "PPR", fmt: "num1" },
    ],
  },
];

// ------------------------------------------------------------------ teams

export const TEAM_GROUPS: StatGroup[] = [
  {
    key: "offense",
    label: "Offense",
    sort: "off_adj",
    qualifier: { column: "off_plays", min: 100, label: "plays" },
    columns: [
      { key: "off_plays", label: "Plays", fmt: "int" },
      { key: "off_epa", label: "EPA/play", fmt: "signed" },
      { key: "off_adj", label: "Adj EPA", fmt: "signed" },
      { key: "off_success", label: "Succ%", fmt: "pct0" },
      { key: "off_pass_epa", label: "Pass EPA", fmt: "signed" },
      { key: "off_rush_epa", label: "Rush EPA", fmt: "signed" },
      { key: "off_early_epa", label: "Early EPA", fmt: "signed" },
      { key: "off_third_epa", label: "3rd EPA", fmt: "signed" },
      { key: "off_rz_epa", label: "RZ EPA", fmt: "signed" },
      { key: "off_explosive_rate", label: "Expl%", fmt: "pct0" },
      { key: "off_cpoe", label: "CPOE", fmt: "pts" },
      { key: "off_sack_rate", label: "Sack%", fmt: "pct0", lowerBetter: true },
    ],
  },
  {
    key: "defense",
    label: "Defense",
    sort: "def_adj",
    qualifier: { column: "def_plays", min: 100, label: "plays" },
    columns: [
      { key: "def_plays", label: "Plays", fmt: "int" },
      { key: "def_epa", label: "EPA/play", fmt: "signed", lowerBetter: true },
      { key: "def_adj", label: "Adj EPA", fmt: "signed", lowerBetter: true },
      { key: "def_success", label: "Succ%", fmt: "pct0", lowerBetter: true },
      { key: "def_pass_epa", label: "Pass EPA", fmt: "signed", lowerBetter: true },
      { key: "def_rush_epa", label: "Rush EPA", fmt: "signed", lowerBetter: true },
      { key: "def_third_epa", label: "3rd EPA", fmt: "signed", lowerBetter: true },
      { key: "def_rz_epa", label: "RZ EPA", fmt: "signed", lowerBetter: true },
      { key: "def_explosive_rate", label: "Expl%", fmt: "pct0", lowerBetter: true },
      { key: "def_sack_rate", label: "Sack%", fmt: "pct0" },
      { key: "def_third_conv", label: "3rd% all", fmt: "pct0", lowerBetter: true },
    ],
  },
  {
    key: "drives",
    label: "Drives",
    sort: "off_points_per_drive",
    qualifier: { column: "off_drives", min: 20, label: "drives" },
    columns: [
      { key: "off_drives", label: "Drives", fmt: "int" },
      { key: "off_points_per_drive", label: "Pts/Dr", fmt: "num2" },
      { key: "off_td_rate", label: "TD%", fmt: "pct0" },
      { key: "off_rz_td_rate", label: "RZ TD%", fmt: "pct0" },
      { key: "off_three_out_rate", label: "3&Out%", fmt: "pct0", lowerBetter: true },
      { key: "off_third_conv", label: "3rd%", fmt: "pct0" },
      { key: "def_points_per_drive", label: "Opp Pts/Dr", fmt: "num2", lowerBetter: true },
      { key: "def_td_rate", label: "Opp TD%", fmt: "pct0", lowerBetter: true },
      { key: "def_three_out_rate", label: "Opp 3&Out%", fmt: "pct0" },
    ],
  },
  {
    key: "tendencies",
    label: "Tendencies",
    sort: "neutral_proe",
    qualifier: { column: "off_plays", min: 100, label: "plays" },
    columns: [
      { key: "off_pass_rate", label: "Pass%", fmt: "pct0" },
      { key: "neutral_pass_rate", label: "Neutral Pass%", fmt: "pct0" },
      { key: "neutral_proe", label: "PROE", fmt: "pts" },
      { key: "off_proe", label: "PROE all", fmt: "pts" },
      { key: "shotgun_rate", label: "Shotgun%", fmt: "pct0" },
      { key: "no_huddle_rate", label: "NoHud%", fmt: "pct0" },
      { key: "sos", label: "SoS", fmt: "signed" },
    ],
  },
];

export const LINE_GROUP: StatGroup = {
  key: "line",
  label: "Line play",
  source: "line_team",
  sort: "line_yards",
  qualifier: { column: "rush_attempts", min: 100, label: "rush attempts" },
  columns: [
    { key: "line_yards", label: "Adj line yds", fmt: "num2", title: "Yards on a run credited to the blocking, Football Outsiders weighting" },
    { key: "line_yards_rank", label: "Rk", fmt: "int", lowerBetter: true },
    { key: "stuffed_rate", label: "Stuffed%", fmt: "pct0", lowerBetter: true },
    { key: "power_success", label: "Power%", fmt: "pct0", title: "3rd/4th and 2 or less runs that convert" },
    { key: "open_field_rate", label: "10+ rate", fmt: "pct0" },
    { key: "pressure_rate_allowed", label: "Press% allowed", fmt: "pct", lowerBetter: true },
    { key: "sack_rate_allowed", label: "Sack% allowed", fmt: "pct", lowerBetter: true },
    { key: "dropbacks", label: "DB", fmt: "int" },
    { key: "blitz_rate_faced", label: "Blitz faced", fmt: "pct0" },
    { key: "epa_pressured", label: "EPA pressured", fmt: "signed" },
    { key: "epa_clean", label: "EPA clean", fmt: "signed" },
    { key: "line_yards_allowed", label: "Adj yds allowed", fmt: "num2", lowerBetter: true },
    { key: "stuff_rate_generated", label: "Stuffs made", fmt: "pct0" },
    { key: "sack_rate_generated", label: "Sack% made", fmt: "pct" },
    { key: "run_epa", label: "Run EPA", fmt: "signed" },
  ],
};

TEAM_GROUPS.push(LINE_GROUP);

export function groupsFor(mode: string): StatGroup[] {
  return mode === "teams" ? TEAM_GROUPS : PLAYER_GROUPS;
}

export function findGroup(mode: string, key: string | undefined): StatGroup {
  const groups = groupsFor(mode);
  return groups.find((g) => g.key === key) ?? groups[0];
}
