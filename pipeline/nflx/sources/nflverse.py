"""Thin wrapper over nflreadpy.

Every loader is memoized for the life of the process so a full build touches
each nflverse release exactly once, and season resolution lives here rather
than being re-derived by each build step.
"""

from __future__ import annotations

from functools import lru_cache

import nflreadpy as nfl
import polars as pl

from ..config import PBP_COLUMNS


@lru_cache(maxsize=None)
def schedules() -> pl.DataFrame:
    return nfl.load_schedules(True)


@lru_cache(maxsize=None)
def teams() -> pl.DataFrame:
    return nfl.load_teams()


@lru_cache(maxsize=None)
def players() -> pl.DataFrame:
    return nfl.load_players()


@lru_cache(maxsize=None)
def contracts() -> pl.DataFrame:
    return nfl.load_contracts()


@lru_cache(maxsize=None)
def pbp(season: int) -> pl.DataFrame:
    """Play-by-play for one season, trimmed to the columns the site uses."""
    df = nfl.load_pbp(season)
    keep = [c for c in PBP_COLUMNS if c in df.columns]
    return df.select(keep)


@lru_cache(maxsize=None)
def player_stats(season: int, level: str = "reg") -> pl.DataFrame:
    return nfl.load_player_stats(season, summary_level=level)


@lru_cache(maxsize=None)
def player_stats_weekly(season: int) -> pl.DataFrame:
    return nfl.load_player_stats(season, summary_level="week")


@lru_cache(maxsize=None)
def rosters(season: int) -> pl.DataFrame:
    return nfl.load_rosters(season)


@lru_cache(maxsize=None)
def snap_counts(season: int) -> pl.DataFrame:
    """Empty rather than raising for seasons before the source begins (2012)."""
    try:
        return nfl.load_snap_counts(season)
    except Exception:
        return pl.DataFrame(
            schema={
                "pfr_player_id": pl.String, "team": pl.String, "position": pl.String,
                "game_type": pl.String, "offense_snaps": pl.Float64,
                "defense_snaps": pl.Float64, "st_snaps": pl.Float64,
                "offense_pct": pl.Float64, "defense_pct": pl.Float64,
            }
        )


@lru_cache(maxsize=None)
def ngs(season: int, stat_type: str) -> pl.DataFrame:
    """Next Gen Stats begin in 2016; earlier seasons come back empty."""
    try:
        return nfl.load_nextgen_stats(season, stat_type=stat_type)
    except Exception:
        return pl.DataFrame()


@lru_cache(maxsize=None)
def pfr_advstats(season: int, stat_type: str, level: str = "season") -> pl.DataFrame:
    """PFR advanced charting begins in 2018; earlier seasons come back empty."""
    try:
        return nfl.load_pfr_advstats(season, stat_type=stat_type, summary_level=level)
    except Exception:
        return pl.DataFrame()


@lru_cache(maxsize=None)
def injuries(season: int) -> pl.DataFrame:
    return nfl.load_injuries(season)


@lru_cache(maxsize=None)
def depth_charts(season: int) -> pl.DataFrame:
    return nfl.load_depth_charts(season)


@lru_cache(maxsize=None)
def ff_opportunity(season: int) -> pl.DataFrame:
    """Expected fantasy points per player-week. Absent for the earliest seasons."""
    try:
        return nfl.load_ff_opportunity(seasons=[season])
    except Exception:
        return pl.DataFrame()


# ----------------------------------------------------------------- seasons

def available_seasons() -> list[int]:
    s = schedules()
    return sorted(s["season"].unique().to_list())


def latest_played_season() -> int:
    """Most recent season with at least one completed game.

    In the offseason this is last season — the one the stats pages describe.
    """
    s = schedules().filter(pl.col("home_score").is_not_null())
    return int(s["season"].max())


def scheduled_season() -> int:
    """Most recent season that has a published schedule (may be upcoming)."""
    return int(schedules()["season"].max())


def season_state(season: int) -> dict:
    """Where a season sits: how many games are done, and what week is next."""
    s = schedules().filter(pl.col("season") == season)
    played = s.filter(pl.col("home_score").is_not_null())
    total = s.height
    done = played.height
    if done == 0:
        state = "upcoming"
        week = 1
    elif done == total:
        state = "complete"
        week = int(s["week"].max())
    else:
        state = "in_progress"
        remaining = s.filter(pl.col("home_score").is_null())
        week = int(remaining["week"].min())
    return {
        "season": season,
        "state": state,
        "current_week": week,
        "games_played": done,
        "games_total": total,
    }
