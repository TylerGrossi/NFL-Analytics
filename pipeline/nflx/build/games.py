"""Schedules and results, including the betting market columns nflverse carries."""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import step, write_parquet


def build(seasons: list[int]) -> pl.DataFrame:
    with step("games"):
        df = (
            nv.schedules()
            .filter(pl.col("season").is_in(seasons))
            .select(
                "game_id", "season", "game_type", "week", "gameday", "weekday",
                "gametime", "away_team", "away_score", "home_team", "home_score",
                "result", "total", "overtime", "spread_line", "total_line",
                "away_moneyline", "home_moneyline", "div_game", "roof", "surface",
                "temp", "wind", "away_qb_name", "home_qb_name", "away_coach",
                "home_coach", "referee", "stadium", "espn",
            )
            .with_columns(
                pl.col("home_score").is_not_null().alias("played"),
                pl.when(pl.col("home_score").is_null())
                .then(None)
                .when(pl.col("home_score") > pl.col("away_score"))
                .then(pl.col("home_team"))
                .when(pl.col("away_score") > pl.col("home_score"))
                .then(pl.col("away_team"))
                .otherwise(pl.lit("TIE"))
                .alias("winner"),
            )
            .sort(["season", "week", "gameday", "gametime"])
        )
        write_parquet(df, "games")
        return df
