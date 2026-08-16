"""Play-level charted store: play-by-play joined to participation.

Formations, personnel, coverage shells and pressure flags are normally
aggregated away into team-season splits. The Lab needs them per play so a
filter can be arbitrary — "11 personnel, shotgun, against man coverage, on
second and long" — rather than precomputed.

Only the seasons with participation data get a file. Everything else the Lab
filters on lives in play-by-play and reaches back to 1999.
"""

from __future__ import annotations

import polars as pl

import nflreadpy as nfl

from ..config import PARQUET
from ..sources import nflverse as nv
from ..util import log, step
from .pbp import scrimmage

# Personnel arrives as "1 RB, 1 TE, 3 WR"; the shorthand is backs then ends.
def _personnel_group() -> pl.Expr:
    backs = (
        pl.col("offense_personnel").str.extract(r"(\d+)\s+RB\b", 1).cast(pl.Int8).fill_null(0)
        + pl.col("offense_personnel").str.extract(r"(\d+)\s+FB\b", 1).cast(pl.Int8).fill_null(0)
    )
    tes = pl.col("offense_personnel").str.extract(r"(\d+)\s+TE\b", 1).cast(pl.Int8).fill_null(0)
    return (
        pl.when(pl.col("offense_personnel").is_null())
        .then(None)
        .otherwise(backs.cast(pl.String) + tes.cast(pl.String))
        .alias("personnel")
    )


def build(seasons: list[int]) -> int:
    with step("charted plays"):
        out_dir = PARQUET / "charted"
        out_dir.mkdir(parents=True, exist_ok=True)
        total = 0

        for season in seasons:
            try:
                part = nfl.load_participation(season)
            except Exception:
                continue
            if part.height == 0 or "nflverse_game_id" not in part.columns:
                continue

            part = part.select(
                pl.col("nflverse_game_id").alias("game_id"),
                pl.col("play_id").cast(pl.Float64),
                "offense_formation",
                "offense_personnel",
                "defenders_in_box",
                "number_of_pass_rushers",
                "was_pressure",
                "defense_man_zone_type",
                "defense_coverage_type",
            ).with_columns(
                _personnel_group(),
                # Empty strings mean "not a coverage snap", not missing data.
                pl.when(pl.col("defense_man_zone_type").str.len_chars() > 0)
                .then(pl.col("defense_man_zone_type"))
                .otherwise(None)
                .alias("man_zone"),
            )

            plays = scrimmage(nv.pbp(season)).select(
                "game_id", "play_id", "season", "week", "posteam", "defteam",
                "play_type", "epa", "success", "down", "ydstogo", "yardline_100",
                "qtr", "game_seconds_remaining", "score_differential", "wp",
                "qb_dropback", "yards_gained", "cpoe", "shotgun", "no_huddle",
                "passer_player_id", "rusher_player_id", "receiver_player_id",
            )

            joined = plays.join(part, on=["game_id", "play_id"], how="inner")
            path = out_dir / f"season={season}.parquet"
            joined.write_parquet(path, compression="zstd")
            total += joined.height
            log(f"{season}: {joined.height:,} charted plays")

        log(f"{total:,} charted plays total")
        return total
