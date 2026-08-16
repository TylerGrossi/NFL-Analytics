"""Paths, season resolution and shared constants."""

from __future__ import annotations

import os
from pathlib import Path

# pipeline/nflx/config.py -> pipeline/nflx -> pipeline -> repo root
ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("NFLX_DATA_DIR", ROOT / "data"))
PARQUET = DATA / "parquet"
JSON = DATA / "json"
LIVE = DATA / "live"
CACHE = DATA / ".cache"

for _p in (PARQUET, JSON, LIVE, CACHE):
    _p.mkdir(parents=True, exist_ok=True)

# nflverse play-by-play begins in 1999.
FIRST_PBP_SEASON = 1999

# How many seasons of play-by-play to keep in the queryable parquet store.
#
# This is the whole store, not an increment: every table downstream is rebuilt
# to this depth, so a small number does not "add the recent years to what is
# there" — it *replaces* the store with a shallow one. Running with 6 turned
# career WAR into a six-year window (Mahomes 24.4 at the top instead of Brady
# 68.9), emptied the all-time leaderboards, and left the market backtest two
# test seasons to work with.
#
# The site's documented feature set — 27-season franchise history, all-time
# seasons, career totals, a walk-forward backtest with decades of games — needs
# the full run, so that is the default. Pass `--history 6` for a fast dev loop
# and expect those surfaces to thin out accordingly.
PBP_SEASONS_DEFAULT = 27

# The draft analysis reads nflverse's draft table, not play-by-play, so it is
# not bounded by the play store's depth — and it must not be, because a pick
# value curve needs decades of classes to have anything to fit.
FIRST_DRAFT_SEASON = 1999

# Pythagorean exponent for the NFL (Football Outsiders' fitted value).
PYTHAG_EXPONENT = 2.37

# Points of margin worth one win — refit by `nflx.build.constants`, this is the seed.
POINTS_PER_WIN = 36.0

# Columns kept in the queryable play-by-play store. The raw feed is 372 columns;
# this is the subset the site actually reads, which keeps the parquet ~10x smaller.
PBP_COLUMNS = [
    "game_id", "play_id", "season", "season_type", "week",
    "home_team", "away_team", "posteam", "defteam", "posteam_type",
    "qtr", "down", "ydstogo", "yardline_100", "goal_to_go",
    "game_seconds_remaining", "half_seconds_remaining", "quarter_seconds_remaining",
    "posteam_score", "defteam_score", "score_differential",
    "posteam_timeouts_remaining", "defteam_timeouts_remaining",
    "play_type", "desc", "yards_gained", "air_yards", "yards_after_catch",
    "pass", "rush", "qb_dropback", "qb_scramble", "qb_hit", "sack",
    "complete_pass", "incomplete_pass", "interception", "fumble_lost",
    "touchdown", "pass_touchdown", "rush_touchdown",
    "first_down", "third_down_converted", "third_down_failed",
    "fourth_down_converted", "fourth_down_failed",
    "field_goal_attempt", "field_goal_result", "kick_distance",
    "punt_attempt", "penalty", "special", "aborted_play", "play_deleted",
    "shotgun", "no_huddle",
    "epa", "wp", "wpa", "vegas_wp", "vegas_wpa", "def_wp",
    "success", "cpoe", "xpass", "pass_oe", "qb_epa", "xyac_epa",
    "air_epa", "yac_epa",
    "passer_player_id", "passer_player_name",
    "rusher_player_id", "rusher_player_name",
    "receiver_player_id", "receiver_player_name",
    "sack_player_id", "sack_player_name",
    # Special teams: kicking, punting and returns all need their own actor.
    "kicker_player_id", "punter_player_id",
    "kickoff_returner_player_id", "punt_returner_player_id",
    "return_yards", "return_touchdown", "extra_point_result",
    "fixed_drive", "fixed_drive_result", "drive", "series", "series_success",
]

# Plays that count as "scrimmage plays" for rate stats.
SCRIMMAGE_TYPES = ("pass", "run")

POSITION_GROUPS = {
    "QB": "QB",
    "RB": "RB", "FB": "RB",
    "WR": "WR",
    "TE": "TE",
    "T": "OL", "G": "OL", "C": "OL", "OL": "OL", "OT": "OL", "OG": "OL",
    "DE": "EDGE", "OLB": "EDGE", "EDGE": "EDGE",
    "DT": "DL", "NT": "DL", "DL": "DL",
    "ILB": "LB", "MLB": "LB", "LB": "LB",
    "CB": "CB", "DB": "CB",
    "S": "S", "SS": "S", "FS": "S",
    "K": "K", "P": "P", "LS": "LS",
}


# ---------------------------------------------------------------- data eras
#
# Sources start at different points, and a metric built on a source that does
# not exist yet must be *absent*, not zero. Verified against the feed:
#   air/YAC EPA is 0% populated in 2005 and 100% in 2006 — the year the league
#   began recording air yards — so receiver value cannot be computed before it.
FIRST_SEASON = {
    "pbp": 1999,          # expected points, win probability, success
    "air_yards": 2006,    # air and YAC EPA -> receiver value, CPOE
    "expected_points": 2006,  # ff_opportunity; needs air yards, so same start
    "snap_counts": 2012,  # snaps played, from Pro Football Reference
    "nextgen": 2016,      # separation, cushion, time to throw
    "pfr_charting": 2018, # coverage and pressure -> defensive value
    "participation": 2020,  # formations, pressure flags -> line value
}


def roles_available(season: int) -> set[str]:
    """Which WAR roles can honestly be computed for a season."""
    roles = {"pass", "rush", "kick", "punt", "return"}
    if season >= FIRST_SEASON["air_yards"]:
        roles.add("rec")
    if season >= FIRST_SEASON["pfr_charting"]:
        roles.add("def")
    # Line value needs snap counts to split the unit; the pressure component
    # only exists from 2020, so earlier line numbers rest on run blocking and
    # sacks alone rather than being absent.
    if season >= FIRST_SEASON["snap_counts"]:
        roles.add("line")
    return roles
