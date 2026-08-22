"""Run gaps: where a team's carries go, and how they do there.

Play-by-play records `run_location` (left / middle / right) and `run_gap`
(end / tackle / guard), which together name the hole a carry went through. Those
six combinations collapse onto the five interior spots a reader thinks in:

    left end, left tackle -> LT      middle -> C
    left guard            -> LG      right guard -> RG
                                     right tackle, right end -> RT

That mapping is the honest part. The dishonest part would be calling the result
a rating of the man playing there: a carry off left tackle is blocked by the
tackle, the guard beside him, a tight end, a back and often a pulling lineman,
and the run itself is chosen by a coordinator who knows which of them can win.
This is where the carries went and what they were worth — a team fact, reported
by the spot on the line rather than by the player standing in it.
"""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet
from .pbp import scrimmage

GAP_ORDER = ["LT", "LG", "C", "RG", "RT"]


def _gap() -> pl.Expr:
    loc = pl.col("run_location")
    gap = pl.col("run_gap")
    return (
        pl.when(loc == "middle").then(pl.lit("C"))
        .when((loc == "left") & (gap == "guard")).then(pl.lit("LG"))
        .when((loc == "left") & gap.is_in(["tackle", "end"])).then(pl.lit("LT"))
        .when((loc == "right") & (gap == "guard")).then(pl.lit("RG"))
        .when((loc == "right") & gap.is_in(["tackle", "end"])).then(pl.lit("RT"))
        .otherwise(None)
        .alias("gap")
    )


def build(seasons: list[int]) -> pl.DataFrame | None:
    with step("run gaps"):
        frames = []
        for season in seasons:
            plays = scrimmage(nv.pbp(season))
            if "run_gap" not in plays.columns:
                log(f"! {season}: pbp has no run_gap column; skipping")
                continue
            runs = plays.filter(
                (pl.col("play_type") == "run")
                & (pl.col("season_type") == "REG")
                & pl.col("run_location").is_not_null()
            ).with_columns(_gap())
            runs = runs.filter(pl.col("gap").is_not_null())
            if runs.height == 0:
                continue

            # Offense: the team running it. Defense: the team it was run at.
            for side, team_col in (("offense", "posteam"), ("defense", "defteam")):
                totals = runs.group_by(["season", team_col]).agg(
                    pl.len().alias("team_runs")
                )
                agg = (
                    runs.group_by(["season", team_col, "gap"])
                    .agg(
                        pl.len().alias("plays"),
                        pl.col("epa").mean().alias("epa_per_rush"),
                        pl.col("success").mean().alias("success"),
                        pl.col("yards_gained").mean().alias("yards_per_rush"),
                        (pl.col("yards_gained") <= 0).mean().alias("stuff_rate"),
                        (pl.col("yards_gained") >= 10).mean().alias("explosive_rate"),
                        pl.col("touchdown").sum().alias("touchdowns"),
                    )
                    .join(totals, on=["season", team_col])
                    .with_columns(
                        (pl.col("plays") / pl.col("team_runs")).alias("share"),
                        pl.lit(side).alias("side"),
                    )
                    .rename({team_col: "team"})
                    .drop("team_runs")
                )
                frames.append(agg)
            log(f"{season}: {runs.height:,} carries placed in a gap")

        if not frames:
            log("no run-gap data available; skipping")
            return None

        out = pl.concat(frames, how="vertical").sort(["season", "side", "team", "gap"])
        out = round_cols(out, 4)
        write_parquet(out, "gap_splits")
        return out
