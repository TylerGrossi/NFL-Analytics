/**
 * The Lab's split engine.
 *
 * Every filter is an entry in a fixed table that owns its own SQL fragment, so
 * nothing a visitor types reaches the query — an unknown key simply does not
 * match and is dropped. Filters that need charted data (formation, personnel,
 * coverage, pressure) switch the source from the full play store to the joined
 * charted store, which is why they carry a `charted` flag and a start season.
 */

export type FilterOption = {
  key: string;
  label: string;
  /** SQL predicate; only ever composed from this table. */
  where: string;
};

export type FilterGroup = {
  key: string;
  label: string;
  /** Needs the charted store rather than raw play-by-play. */
  charted?: boolean;
  from?: number;
  options: FilterOption[];
};

const ANY: FilterOption = { key: "any", label: "Any", where: "" };

export const FILTERS: FilterGroup[] = [
  {
    key: "play",
    label: "Play type",
    options: [
      ANY,
      { key: "pass", label: "Dropbacks", where: "qb_dropback = 1" },
      { key: "run", label: "Designed runs", where: "play_type = 'run'" },
    ],
  },
  {
    key: "down",
    label: "Down",
    options: [
      ANY,
      { key: "1", label: "1st", where: "down = 1" },
      { key: "2", label: "2nd", where: "down = 2" },
      { key: "3", label: "3rd", where: "down = 3" },
      { key: "early", label: "Early", where: "down in (1,2)" },
    ],
  },
  {
    key: "dist",
    label: "Distance",
    options: [
      ANY,
      { key: "short", label: "1–3", where: "ydstogo between 1 and 3" },
      { key: "medium", label: "4–7", where: "ydstogo between 4 and 7" },
      { key: "long", label: "8+", where: "ydstogo >= 8" },
    ],
  },
  {
    key: "zone",
    label: "Field zone",
    options: [
      ANY,
      { key: "backed", label: "Own 1–20", where: "yardline_100 >= 80" },
      { key: "mid", label: "Midfield", where: "yardline_100 between 35 and 79" },
      { key: "fringe", label: "Opp 21–34", where: "yardline_100 between 21 and 34" },
      { key: "rz", label: "Red zone", where: "yardline_100 <= 20" },
    ],
  },
  {
    key: "score",
    label: "Game script",
    options: [
      ANY,
      { key: "neutral", label: "Neutral", where: "wp between 0.2 and 0.8" },
      { key: "trailing", label: "Trailing", where: "score_differential <= -1" },
      { key: "leading", label: "Leading", where: "score_differential >= 1" },
      { key: "close", label: "One score", where: "abs(score_differential) <= 8" },
    ],
  },
  {
    key: "when",
    label: "When",
    options: [
      ANY,
      { key: "h1", label: "1st half", where: "qtr <= 2" },
      { key: "h2", label: "2nd half", where: "qtr >= 3" },
      { key: "q4", label: "4th quarter", where: "qtr = 4" },
      { key: "late", label: "Last 4 min", where: "game_seconds_remaining <= 240" },
    ],
  },
  {
    key: "formation",
    label: "Formation",
    charted: true,
    from: 2016,
    options: [
      ANY,
      { key: "shotgun", label: "Shotgun", where: "offense_formation = 'SHOTGUN'" },
      { key: "under", label: "Under center", where: "offense_formation = 'UNDER CENTER'" },
      { key: "pistol", label: "Pistol", where: "offense_formation = 'PISTOL'" },
      { key: "empty", label: "Empty", where: "offense_formation = 'EMPTY'" },
      { key: "iform", label: "I-form", where: "offense_formation = 'I_FORM'" },
    ],
  },
  {
    key: "personnel",
    label: "Personnel",
    charted: true,
    from: 2016,
    options: [
      ANY,
      { key: "11", label: "11", where: "personnel = '11'" },
      { key: "12", label: "12", where: "personnel = '12'" },
      { key: "21", label: "21", where: "personnel = '21'" },
      { key: "13", label: "13", where: "personnel = '13'" },
      { key: "10", label: "10", where: "personnel = '10'" },
    ],
  },
  {
    key: "coverage",
    label: "Coverage",
    charted: true,
    from: 2016,
    options: [
      ANY,
      { key: "man", label: "Man", where: "man_zone = 'MAN_COVERAGE'" },
      { key: "zone", label: "Zone", where: "man_zone = 'ZONE_COVERAGE'" },
      { key: "c1", label: "Cover 1", where: "defense_coverage_type = 'COVER_1'" },
      { key: "c2", label: "Cover 2", where: "defense_coverage_type = 'COVER_2'" },
      { key: "c3", label: "Cover 3", where: "defense_coverage_type = 'COVER_3'" },
      { key: "c4", label: "Cover 4", where: "defense_coverage_type = 'COVER_4'" },
    ],
  },
  {
    key: "pressure",
    label: "Pressure",
    charted: true,
    from: 2016,
    options: [
      ANY,
      { key: "yes", label: "Pressured", where: "was_pressure = true" },
      { key: "no", label: "Clean", where: "was_pressure = false" },
      { key: "blitz", label: "5+ rushers", where: "number_of_pass_rushers >= 5" },
    ],
  },
];

export type GroupBy = {
  key: string;
  label: string;
  column: string;
  /** Join to the player index for a name. */
  player?: boolean;
  /** Only meaningful for dropbacks / targets / carries. */
  requires?: string;
};

export const GROUPINGS: GroupBy[] = [
  { key: "offense", label: "Team offense", column: "posteam" },
  { key: "defense", label: "Team defense", column: "defteam" },
  { key: "qb", label: "Quarterback", column: "passer_player_id", player: true, requires: "qb_dropback = 1" },
  { key: "rusher", label: "Ball carrier", column: "rusher_player_id", player: true, requires: "play_type = 'run'" },
  { key: "receiver", label: "Receiver", column: "receiver_player_id", player: true, requires: "receiver_player_id is not null" },
];

export function findFilter(groupKey: string, optionKey: string | undefined): FilterOption {
  const group = FILTERS.find((g) => g.key === groupKey);
  if (!group) return ANY;
  return group.options.find((o) => o.key === optionKey) ?? ANY;
}

export function findGrouping(key: string | undefined): GroupBy {
  return GROUPINGS.find((g) => g.key === key) ?? GROUPINGS[0];
}

/** True when any active filter needs the charted store. */
export function needsCharted(selected: Record<string, string | undefined>): boolean {
  return FILTERS.some(
    (g) => g.charted && (selected[g.key] ?? "any") !== "any"
  );
}

export function activeWhere(selected: Record<string, string | undefined>): string[] {
  return FILTERS.map((g) => findFilter(g.key, selected[g.key]).where).filter(Boolean);
}
