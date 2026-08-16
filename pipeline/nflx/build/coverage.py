"""Separation and coverage, measured against depth.

Raw separation flatters short-area receivers, and the data is emphatic about
the direction: separation *falls* by about 0.12 yards for every yard of target
depth. Screens and flat routes generate space almost automatically; a contested
ball twenty yards downfield does not. A leaderboard sorted on raw separation is
therefore closer to a list of who runs shallow routes than who gets open.

Corners face the mirror image — yards allowed rise about 0.17 per yard of
target depth — so a player asked to defend deep is punished by raw numbers.

Both sides are therefore measured against what their target depth predicts:

* **Separation score** — a receiver's yards of separation against the amount
  expected at his average intended air yards, then scaled so 100 is average and
  each 15 points is one standard deviation.
* **Coverage score** — a defender's yards allowed per target against the amount
  expected at his average depth of target, on the same scale, signed so that
  allowing less is better.

Neither is true tracking-derived separation for the defender: the NFL does not
publish separation allowed. Coverage score is an outcome measure — what happened
when he was thrown at — and the page says so.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

# Score scale: 100 is average, 15 points per standard deviation.
SCORE_CENTER = 100.0
SCORE_SPREAD = 15.0

MIN_TARGETS_RECEIVER = 30
MIN_TARGETS_DEFENDER = 25


def _score(values: np.ndarray, higher_is_better: bool = True) -> np.ndarray:
    sd = np.nanstd(values)
    if sd == 0 or np.isnan(sd):
        return np.full(len(values), SCORE_CENTER)
    z = (values - np.nanmean(values)) / sd
    if not higher_is_better:
        z = -z
    return SCORE_CENTER + SCORE_SPREAD * z


def build(seasons: list[int], index: pl.DataFrame) -> pl.DataFrame:
    with step("separation and coverage"):
        receivers = _receivers(seasons)
        defenders = _defenders(seasons, index)

        if receivers.height:
            write_parquet(round_cols(receivers, 3), "separation_receivers")
        if defenders.height:
            write_parquet(round_cols(defenders, 3), "coverage_defenders")

        latest = max(seasons)
        top = receivers.filter(pl.col("season") == latest).sort(
            "separation_score", descending=True
        ).head(3)
        if top.height:
            log("best separation " + str(latest) + ": " + ", ".join(
                f"{r['name']} {r['separation_score']:.0f}" for r in top.iter_rows(named=True)
            ))
        best_cover = defenders.filter(pl.col("season") == latest).sort(
            "coverage_score", descending=True
        ).head(3)
        if best_cover.height:
            log("best coverage " + str(latest) + ": " + ", ".join(
                f"{r['name']} {r['coverage_score']:.0f}" for r in best_cover.iter_rows(named=True)
            ))
        return receivers


def _receivers(seasons: list[int]) -> pl.DataFrame:
    """Separation over what a receiver's route depth predicts."""
    frames = []
    for season in seasons:
        ngs = nv.ngs(season, "receiving")
        if ngs.height == 0 or "player_gsis_id" not in ngs.columns:
            continue
        rows = ngs.filter((pl.col("week") == 0) & (pl.col("season_type") == "REG"))
        if rows.height == 0:
            rows = ngs.filter(pl.col("season_type") == "REG")
        rows = rows.filter(
            pl.col("targets").fill_null(0) >= MIN_TARGETS_RECEIVER
        ).select(
            pl.col("player_gsis_id").alias("player_id"),
            pl.col("player_display_name").alias("name"),
            pl.col("player_position").alias("position"),
            pl.col("team_abbr").alias("team"),
            "targets", "receptions", "yards",
            "avg_separation", "avg_cushion", "avg_intended_air_yards",
            "avg_yac_above_expectation", "catch_percentage",
        ).drop_nulls(["avg_separation", "avg_intended_air_yards"])
        if rows.height < 10:
            continue

        depth = rows["avg_intended_air_yards"].to_numpy()
        separation = rows["avg_separation"].to_numpy()
        # Expected separation at this route depth.
        slope, intercept = np.polyfit(depth, separation, 1)
        expected = slope * depth + intercept
        over = separation - expected

        frames.append(
            rows.with_columns(
                pl.Series("expected_separation", expected),
                pl.Series("separation_over_expected", over),
                pl.Series("separation_score", _score(over)),
                pl.lit(season).cast(pl.Int32).alias("season"),
            )
        )
        log(f"{season}: separation rises {slope:.3f} yards per yard of target depth")

    return pl.concat(frames, how="diagonal") if frames else pl.DataFrame()


def _defenders(seasons: list[int], index: pl.DataFrame) -> pl.DataFrame:
    """Yards allowed per target against what target depth predicts."""
    frames = []
    ids = index.select("player_id", "pfr_id", "headshot").drop_nulls("pfr_id")

    for season in seasons:
        try:
            pfr = nv.pfr_advstats(season, "def", "season")
        except Exception as exc:
            log(f"! PFR coverage {season} unavailable: {exc}")
            continue
        if pfr.height == 0 or "dadot" not in pfr.columns:
            continue

        rows = pfr.filter(
            (pl.col("tgt").fill_null(0) >= MIN_TARGETS_DEFENDER)
            & pl.col("dadot").is_not_null()
            & pl.col("yds_tgt").is_not_null()
        ).select(
            "pfr_id",
            pl.col("player").alias("name"),
            pl.col("tm").alias("team"),
            pl.col("pos").alias("position"),
            "tgt", "cmp", "cmp_percent", "yds", "yds_tgt", "yds_cmp",
            "td", "int", "rat", "dadot", "air", "yac", "m_tkl_percent",
        )
        if rows.height < 10:
            continue

        depth = rows["dadot"].to_numpy()
        allowed = rows["yds_tgt"].to_numpy()
        slope, intercept = np.polyfit(depth, allowed, 1)
        expected = slope * depth + intercept
        over = allowed - expected  # positive means giving up more than depth predicts

        frames.append(
            rows.with_columns(
                pl.Series("expected_yds_per_target", expected),
                pl.Series("yards_over_expected", over),
                pl.Series("coverage_score", _score(over, higher_is_better=False)),
                pl.lit(season).cast(pl.Int32).alias("season"),
            ).join(ids, on="pfr_id", how="left")
        )
        log(f"{season}: yards allowed rise {slope:.3f} per yard of target depth")

    return pl.concat(frames, how="diagonal") if frames else pl.DataFrame()
