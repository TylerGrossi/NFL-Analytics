"""Draft-kit extras: schedule difficulty, byes, and availability.

Three things every serious draft tool carries, built from data already in the
store rather than bought in.

Strength of schedule follows the standard construction — fantasy points allowed
to each position, ranked one to thirty-two, averaged across a club's opponents.
Two caveats are worth stating rather than burying, because this metric is
routinely oversold. It is built from last season's defensive performance, and
defense is the least repeatable thing in football: team defensive rating carries
year to year at only 0.34. And it says nothing about the personnel a defense
will actually field in September. It is a tiebreaker between close players, not
a reason to move anyone up a round.
"""

from __future__ import annotations

import polars as pl

import nflreadpy as nfl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

POSITIONS = ("QB", "RB", "WR", "TE")

# Weeks that decide most leagues. Worth separating: a club can have an easy
# September and a brutal December, and only one of those wins a title.
PLAYOFF_WEEKS = (15, 16, 17)

# Seasons of history used to judge how often a player is actually available.
AVAILABILITY_SEASONS = 3


def _points_allowed(season: int) -> pl.DataFrame:
    """Fantasy points each defense gave up to each position, per game."""
    w = nv.player_stats_weekly(season)
    if w.height == 0 or "opponent_team" not in w.columns:
        return pl.DataFrame()
    # Regular season only. The feed carries postseason weeks in the same table,
    # and only fourteen clubs play them — leaving them in hands those defenses
    # extra games in a per-game average the other eighteen are ranked against.
    if "season_type" in w.columns:
        w = w.filter(pl.col("season_type") == "REG")

    per_game = (
        w.filter(pl.col("position").is_in(POSITIONS) & pl.col("opponent_team").is_not_null())
        .group_by("opponent_team", "position", "week")
        .agg(pl.col("fantasy_points_ppr").sum().alias("allowed"))
    )
    out = (
        per_game.group_by("opponent_team", "position")
        .agg(pl.col("allowed").mean().alias("fpa_per_game"), pl.len().alias("weeks"))
        .rename({"opponent_team": "team"})
        .with_columns(pl.lit(season).alias("season"))
    )
    # Rank 1 = most generous, which is how every published table reads.
    return out.with_columns(
        pl.col("fpa_per_game").rank("min", descending=True).over("position").cast(pl.Int32).alias("fpa_rank"),
        (pl.col("fpa_per_game") / pl.col("fpa_per_game").mean().over("position")).alias("fpa_index"),
    )


def _schedule(season: int) -> pl.DataFrame:
    """Every club's opponents, one row per team-week."""
    s = nfl.load_schedules().filter(
        (pl.col("season") == season) & (pl.col("game_type") == "REG")
    )
    if s.height == 0:
        return pl.DataFrame()
    home = s.select("week", pl.col("home_team").alias("team"), pl.col("away_team").alias("opponent"))
    away = s.select("week", pl.col("away_team").alias("team"), pl.col("home_team").alias("opponent"))
    return pl.concat([home, away])


def build(season: int, players: pl.DataFrame, fantasy: pl.DataFrame) -> pl.DataFrame:
    """`season` is the one being drafted for; defense comes from the year before."""
    with step("fantasy draft kit"):
        allowed = _points_allowed(season - 1)
        schedule = _schedule(season)
        if allowed.height == 0 or schedule.height == 0:
            log("no schedule or defensive data — draft kit skipped")
            return pl.DataFrame()

        write_parquet(round_cols(allowed, 3), "fantasy_defense")

        # ------------------------------------------------------------ schedule
        joined = schedule.join(
            allowed.select(pl.col("team").alias("opponent"), "position", "fpa_index", "fpa_rank"),
            on="opponent", how="inner",
        )
        sos = (
            joined.group_by("team", "position")
            .agg(
                pl.col("fpa_index").mean().alias("sos_index"),
                pl.col("fpa_rank").mean().alias("opp_rank_avg"),
                pl.col("fpa_index").filter(pl.col("week").is_in(PLAYOFF_WEEKS)).mean().alias("playoff_index"),
                pl.len().alias("games"),
            )
            .with_columns(
                # Rank 1 = easiest schedule for that position.
                pl.col("sos_index").rank("min", descending=True).over("position").cast(pl.Int32).alias("sos_rank"),
                pl.col("playoff_index").rank("min", descending=True).over("position").cast(pl.Int32).alias("playoff_rank"),
                pl.lit(season).alias("season"),
            )
        )
        write_parquet(round_cols(sos, 3), "fantasy_sos")

        # ----------------------------------------------------------------- byes
        weeks_played = schedule.group_by("team").agg(pl.col("week").unique().alias("weeks"))
        byes = weeks_played.with_columns(
            pl.col("weeks")
            .map_elements(
                lambda ws: next((w for w in range(1, 19) if w not in set(ws)), None),
                return_dtype=pl.Int32,
            )
            .alias("bye")
        ).select("team", "bye").with_columns(pl.lit(season).alias("season"))
        write_parquet(byes, "fantasy_byes")

        # --------------------------------------------------------- availability
        recent = fantasy.filter(pl.col("season") >= season - AVAILABILITY_SEASONS)
        avail = (
            recent.group_by("player_id")
            .agg(
                pl.col("games").sum().alias("games_played"),
                pl.len().alias("seasons_active"),
            )
            .with_columns(
                # 17 games a season is the full slate; a rookie year counts only
                # from the season it happened, not from a career that predates it.
                (pl.col("games_played") / (pl.col("seasons_active") * 17)).alias("availability")
            )
        )
        write_parquet(round_cols(avail, 3), "fantasy_availability")

        easiest = sos.filter(pl.col("position") == "WR").sort("sos_rank").head(3)
        log(f"{sos.height} team-position schedules · easiest for receivers: "
            + ", ".join(f"{r['team']}" for r in easiest.iter_rows(named=True)))
        log(f"{byes.height} byes · {avail.height} availability records")
        return sos
