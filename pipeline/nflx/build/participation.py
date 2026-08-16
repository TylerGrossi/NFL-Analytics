"""Formations, personnel groupings, coverage shells and pressure.

Source is nflverse participation data, which is a different animal from
play-by-play: it carries who was on the field, what the offense lined up in,
what shell the defense showed, and whether the quarterback was pressured.

Two caveats the UI has to surface:

* The formation vocabulary changed in 2023. Through 2022 the NFL feed gave
  SHOTGUN / SINGLEBACK / EMPTY / I_FORM / PISTOL / JUMBO / WILDCAT. From 2023
  the FTN feed gives SHOTGUN / UNDER CENTER / PISTOL only. Cross-era formation
  comparisons are not apples to apples; personnel groupings are.
* Participation is published only after the postseason ends, so the current
  season is missing until then.
"""

from __future__ import annotations

import polars as pl

import nflreadpy as nfl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet
from .pbp import scrimmage

# Personnel arrives as a roster string like "1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR".
# Standard shorthand counts backs and tight ends: 11 = 1 RB, 1 TE.
PERSONNEL_POSITIONS = ("RB", "FB", "TE", "WR", "DL", "LB", "DB")


def _count_position(col: str, position: str) -> pl.Expr:
    """Pull the integer in front of a position label out of the roster string."""
    return (
        pl.col(col)
        .str.extract(rf"(\d+)\s+{position}\b", 1)
        .cast(pl.Int8)
        .fill_null(0)
    )


def _personnel_group() -> pl.Expr:
    backs = _count_position("offense_personnel", "RB") + _count_position("offense_personnel", "FB")
    tes = _count_position("offense_personnel", "TE")
    return (
        pl.when(_count_position("offense_personnel", "QB") == 0)
        .then(None)
        .otherwise(
            backs.cast(pl.String) + tes.cast(pl.String)
        )
        .alias("personnel")
    )


def _load(season: int) -> pl.DataFrame | None:
    try:
        part = nfl.load_participation(season)
    except Exception as exc:
        log(f"! participation {season} unavailable: {exc}")
        return None
    if part.height == 0 or "nflverse_game_id" not in part.columns:
        log(f"! participation {season} is empty (published after the postseason)")
        return None

    part = part.select(
        pl.col("nflverse_game_id").alias("game_id"),
        # play_id is f64 in play-by-play and i32 here; align before joining.
        pl.col("play_id").cast(pl.Float64),
        pl.col("possession_team").alias("part_posteam"),
        "offense_formation",
        "offense_personnel",
        "defense_personnel",
        "defenders_in_box",
        "number_of_pass_rushers",
        "was_pressure",
        "defense_man_zone_type",
        "defense_coverage_type",
        "n_offense",
        "n_defense",
    ).with_columns(
        _personnel_group(),
        _count_position("defense_personnel", "DB").alias("def_backs"),
        _count_position("defense_personnel", "LB").alias("def_linebackers"),
        _count_position("defense_personnel", "DL").alias("def_linemen"),
        # Blank strings mean "not a coverage snap", which is not the same as
        # missing data.
        pl.when(pl.col("defense_man_zone_type").str.len_chars() > 0)
        .then(pl.col("defense_man_zone_type"))
        .otherwise(None)
        .alias("man_zone"),
    )

    plays = scrimmage(nv.pbp(season)).select(
        "game_id", "play_id", "season", "week", "posteam", "defteam",
        "play_type", "epa", "success", "down", "ydstogo", "yardline_100",
        "qb_dropback", "wp",
    )
    return plays.join(part, on=["game_id", "play_id"], how="inner")


def _split(df: pl.DataFrame, team_col: str, dimension: str, value_col: str,
           side: str) -> pl.DataFrame:
    """Long-format usage + efficiency for one categorical dimension."""
    base = df.filter(pl.col(value_col).is_not_null())
    if base.height == 0:
        return pl.DataFrame()
    totals = base.group_by(["season", team_col]).agg(pl.len().alias("team_plays"))
    return (
        base.group_by(["season", team_col, value_col])
        .agg(
            pl.len().alias("plays"),
            pl.col("epa").mean().alias("epa"),
            pl.col("success").mean().alias("success"),
            (pl.col("play_type") == "pass").mean().alias("pass_rate"),
        )
        .join(totals, on=["season", team_col])
        .with_columns(
            (pl.col("plays") / pl.col("team_plays")).alias("rate"),
            pl.lit(dimension).alias("dimension"),
            pl.lit(side).alias("side"),
        )
        .rename({team_col: "team", value_col: "value"})
        .drop("team_plays")
    )


def build(seasons: list[int]) -> pl.DataFrame | None:
    with step("participation (formations, coverage, pressure)"):
        frames = []
        for season in seasons:
            df = _load(season)
            if df is not None:
                frames.append(df)
                log(f"{season}: {df.height:,} plays matched")
        if not frames:
            log("no participation data available; skipping")
            return None

        data = pl.concat(frames, how="vertical")

        # ---------------------------------------------------------- splits
        splits = [
            _split(data, "posteam", "formation", "offense_formation", "offense"),
            _split(data, "posteam", "personnel", "personnel", "offense"),
            _split(data.filter(pl.col("qb_dropback") == 1), "defteam", "coverage",
                   "defense_coverage_type", "defense"),
            _split(data.filter(pl.col("qb_dropback") == 1), "defteam", "man_zone",
                   "man_zone", "defense"),
            _split(data.filter(pl.col("qb_dropback") == 1), "posteam", "coverage_faced",
                   "defense_coverage_type", "offense"),
        ]
        splits = [s for s in splits if s.height]
        long = pl.concat(splits, how="diagonal").select(
            "season", "team", "side", "dimension", "value", "plays", "rate",
            "epa", "success", "pass_rate",
        )
        write_parquet(round_cols(long, 4), "formation_splits")

        # ---------------------------------------------------------- team summary
        dropbacks = data.filter(pl.col("qb_dropback") == 1)

        offense = dropbacks.group_by(["season", pl.col("posteam").alias("team")]).agg(
            pl.len().alias("dropbacks"),
            pl.col("was_pressure").mean().alias("pressure_rate_allowed"),
            pl.col("epa").filter(pl.col("was_pressure") == True).mean().alias("epa_pressured"),  # noqa: E712
            pl.col("epa").filter(pl.col("was_pressure") == False).mean().alias("epa_clean"),  # noqa: E712
            pl.col("number_of_pass_rushers").mean().alias("rushers_faced"),
            (pl.col("number_of_pass_rushers") >= 5).mean().alias("blitz_rate_faced"),
        )

        defense = dropbacks.group_by(["season", pl.col("defteam").alias("team")]).agg(
            pl.len().alias("def_dropbacks"),
            pl.col("was_pressure").mean().alias("pressure_rate"),
            pl.col("number_of_pass_rushers").mean().alias("rushers_sent"),
            (pl.col("number_of_pass_rushers") >= 5).mean().alias("blitz_rate"),
            pl.col("epa").filter(pl.col("was_pressure") == True).mean().alias("epa_allowed_pressured"),  # noqa: E712
            (pl.col("man_zone") == "MAN_COVERAGE").mean().alias("man_rate"),
        )

        boxes = data.filter(pl.col("play_type") == "run").group_by(
            ["season", pl.col("posteam").alias("team")]
        ).agg(
            pl.col("defenders_in_box").mean().alias("box_faced"),
            (pl.col("defenders_in_box") >= 8).mean().alias("stacked_box_rate"),
            pl.col("epa").filter(pl.col("defenders_in_box") >= 8).mean().alias("epa_vs_stacked"),
        )

        summary = (
            offense.join(defense, on=["season", "team"], how="full", coalesce=True)
            .join(boxes, on=["season", "team"], how="left")
            .sort(["season", "team"])
        )
        summary_out = round_cols(summary, 4)
        write_parquet(summary_out, "participation_team")

        # ---------------------------------------------------------- coverage note
        eras = (
            data.group_by("season")
            .agg(pl.col("offense_formation").drop_nulls().n_unique().alias("formation_values"))
            .sort("season")
        )
        log("formation vocabulary by season: " + ", ".join(
            f"{r['season']}:{r['formation_values']}" for r in eras.to_dicts()
        ))
        return summary_out
