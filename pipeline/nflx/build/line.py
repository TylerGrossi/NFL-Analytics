"""Offensive and defensive line play.

Line work is the least visible thing in public football data: there is no
per-snap block charting, so an individual guard cannot be measured directly.
What *can* be measured is the unit, and measured well:

* **Run blocking** — adjusted line yards. Yards on a run are weighted by how
  much of them the line plausibly created: everything behind the line is on the
  blocking, the first four yards are mostly blocking, five to ten are shared,
  and anything past ten belongs to the back. That weighting is the Football
  Outsiders formulation.
* **Pass protection** — pressure rate and sack rate allowed per dropback, from
  charted participation data.

Individual linemen then receive the unit's value in proportion to snaps played.
That is an allocation, not a measurement, and the site says so.
"""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet
from .pbp import scrimmage

# Share of a run's yardage credited to the blocking, by yard.
def _line_yards() -> pl.Expr:
    y = pl.col("yards_gained")
    return (
        pl.when(y < 0).then(y * 1.2)          # losses are on the line
        .when(y <= 4).then(y * 1.0)           # the line owns the first four
        .when(y <= 10).then(4 + (y - 4) * 0.5)  # shared through ten
        .otherwise(7.0)                        # past ten belongs to the back
    )


def build(seasons: list[int], participation_team: pl.DataFrame | None) -> pl.DataFrame:
    with step("line play"):
        frames = []
        for season in seasons:
            raw = nv.pbp(season)
            plays = scrimmage(raw).filter(pl.col("season_type") == "REG")
            runs = plays.filter(pl.col("play_type") == "run")
            dropbacks = plays.filter(pl.col("qb_dropback") == 1)

            run_block = runs.group_by("posteam").agg(
                pl.len().alias("rush_attempts"),
                _line_yards().mean().alias("line_yards"),
                (pl.col("yards_gained") <= 0).mean().alias("stuffed_rate"),
                (pl.col("yards_gained") >= 10).mean().alias("open_field_rate"),
                pl.col("epa").mean().alias("run_epa"),
            )

            power = runs.filter(
                (pl.col("down") >= 3) & (pl.col("ydstogo") <= 2)
            ).group_by("posteam").agg(
                pl.col("first_down").fill_null(0).mean().alias("power_success"),
                pl.len().alias("power_attempts"),
            )

            protect = dropbacks.group_by("posteam").agg(
                pl.len().alias("dropbacks"),
                pl.col("sack").fill_null(0).mean().alias("sack_rate_allowed"),
                pl.col("epa").filter(pl.col("sack") == 1).mean().alias("epa_on_sacks"),
            )

            # The defensive side of the same ledger.
            defense = plays.group_by("defteam").agg(
                pl.col("epa").filter(pl.col("play_type") == "run").mean().alias("run_epa_allowed"),
                _line_yards().filter(pl.col("play_type") == "run").mean().alias("line_yards_allowed"),
                (pl.col("yards_gained") <= 0)
                .filter(pl.col("play_type") == "run")
                .mean()
                .alias("stuff_rate_generated"),
                pl.col("sack").fill_null(0)
                .filter(pl.col("qb_dropback") == 1)
                .mean()
                .alias("sack_rate_generated"),
            ).rename({"defteam": "posteam"})

            season_df = (
                run_block.join(power, on="posteam", how="left")
                .join(protect, on="posteam", how="left")
                .join(defense, on="posteam", how="left")
                .rename({"posteam": "team"})
                .with_columns(pl.lit(season).cast(pl.Int32).alias("season"))
            )
            frames.append(season_df)

        out = pl.concat(frames, how="diagonal")

        if participation_team is not None and participation_team.height:
            out = out.join(
                participation_team.select(
                    "season", "team", "pressure_rate_allowed", "epa_pressured", "epa_clean",
                    "blitz_rate_faced", "rushers_faced", "pressure_rate", "blitz_rate",
                ),
                on=["season", "team"],
                how="left",
            )

        # Ranks, so the page can show where a unit sits without recomputing.
        out = out.with_columns(
            pl.col("line_yards").rank(method="min", descending=True).over("season").cast(pl.Int32).alias("line_yards_rank"),
            pl.col("sack_rate_allowed").rank(method="min").over("season").cast(pl.Int32).alias("sack_rate_rank"),
            pl.col("stuffed_rate").rank(method="min").over("season").cast(pl.Int32).alias("stuffed_rank"),
        )
        if "pressure_rate_allowed" in out.columns:
            out = out.with_columns(
                pl.col("pressure_rate_allowed").rank(method="min").over("season")
                .cast(pl.Int32).alias("pressure_rank")
            )

        result = round_cols(out, 4).sort(["season", "line_yards"], descending=[False, True])
        write_parquet(result, "line_team")

        latest = result.filter(pl.col("season") == max(seasons)).head(3)
        log("best run blocking " + str(max(seasons)) + ": "
            + ", ".join(f"{r['team']} {r['line_yards']:.2f}" for r in latest.iter_rows(named=True)))
        return result
