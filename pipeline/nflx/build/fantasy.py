"""Fantasy value, on the same footing as the rest of the site.

Raw fantasy points rank a quarterback above every running back and say nothing,
because the two are never chosen against each other — a lineup needs one of the
first and several of the second. Value over replacement fixes that by pricing
each player against the freely available alternative at his own position, which
is the same idea WAR applies to real football.

Two further things the season total hides. Expected points, from nflverse's
opportunity model, separate what a player earned from what his usage was worth:
a receiver who scored on a quarter of his red zone looks elite until the
touchdowns regress. And a season total says nothing about whether the points
arrived weekly or in two enormous games, so the weekly line is kept too.
"""

from __future__ import annotations

import polars as pl

from ..config import FIRST_SEASON
from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

# Starters absorbed by a standard twelve-team lineup before the waiver wire
# becomes the alternative: one quarterback, two backs, three receivers, one end.
# The flex is deliberately not spread across positions — it would make the
# baseline depend on how each league happens to fill it.
LEAGUE_SIZE = 12
STARTERS = {"QB": 1, "RB": 2, "WR": 3, "TE": 1}
POSITIONS = tuple(STARTERS)

# Minimum games before a rate is worth publishing.
MIN_GAMES = 4


def _replacement(season_rows: pl.DataFrame) -> pl.DataFrame:
    """Points per game of the last startable player at each position."""
    out = []
    for pos, starters in STARTERS.items():
        rank = LEAGUE_SIZE * starters
        pool = (
            season_rows.filter((pl.col("position") == pos) & (pl.col("games") >= MIN_GAMES))
            .sort("points", descending=True)
        )
        if pool.height == 0:
            continue
        # The replacement player is the one just past the last starting slot; if
        # the pool is shallower than the league, the worst regular stands in.
        idx = min(rank, pool.height) - 1
        row = pool.row(idx, named=True)
        out.append({"position": pos, "replacement_ppg": row["ppg"], "replacement_rank": idx + 1})
    return pl.DataFrame(out)


def _weekly_shape(season: int) -> pl.DataFrame:
    """Per-player weekly spread — a season total cannot show reliability."""
    w = nv.player_stats_weekly(season)
    if w.height == 0 or "fantasy_points_ppr" not in w.columns:
        return pl.DataFrame()
    return (
        w.filter(pl.col("position").is_in(POSITIONS))
        .group_by("player_id")
        .agg(
            pl.col("fantasy_points_ppr").std().alias("weekly_sd"),
            pl.col("fantasy_points_ppr").max().alias("best_week"),
            pl.col("fantasy_points_ppr").median().alias("median_week"),
        )
    )


def _expected(season: int) -> pl.DataFrame:
    """Season expected points from the opportunity model.

    The model scores on its own system — it counts first downs, which standard
    PPR does not — so its numbers run above the PPR totals used elsewhere on
    this page and the two must not be subtracted from one another. Both its
    actual and its expected are carried through so the gap is always computed
    within one scoring system.
    """
    o = nv.ff_opportunity(season)
    if o.height == 0 or "total_fantasy_points_exp" not in o.columns:
        return pl.DataFrame()
    return o.group_by("player_id").agg(
        pl.col("total_fantasy_points_exp").sum().alias("expected_points"),
        pl.col("total_fantasy_points").sum().alias("opportunity_points"),
    ).with_columns(
        (pl.col("opportunity_points") - pl.col("expected_points")).alias("points_over_expected")
    )


def build(seasons: list[int]) -> pl.DataFrame:
    with step("fantasy"):
        season_rows: list[pl.DataFrame] = []
        replacement_rows: list[pl.DataFrame] = []

        for season in seasons:
            stats = nv.player_stats(season, "reg")
            if stats.height == 0:
                continue

            base = (
                stats.filter(pl.col("position").is_in(POSITIONS) & (pl.col("games") > 0))
                .select(
                    pl.lit(season).alias("season"),
                    "player_id",
                    pl.col("player_display_name").alias("name"),
                    "position", "games",
                    pl.col("fantasy_points_ppr").fill_null(0.0).alias("points"),
                    pl.col("fantasy_points").fill_null(0.0).alias("points_standard"),
                    pl.col("targets").fill_null(0), pl.col("carries").fill_null(0),
                    pl.col("receptions").fill_null(0),
                    pl.col("target_share"), pl.col("air_yards_share"),
                )
                .with_columns((pl.col("points") / pl.col("games")).alias("ppg"))
            )

            repl = _replacement(base)
            if repl.height == 0:
                continue
            replacement_rows.append(repl.with_columns(pl.lit(season).alias("season")))

            joined = base.join(repl, on="position", how="left").with_columns(
                # Above what a waiver-wire starter would have scored in the same
                # number of games, so missing time costs rather than being ignored.
                ((pl.col("ppg") - pl.col("replacement_ppg")) * pl.col("games")).alias("vor"),
                (pl.col("ppg") - pl.col("replacement_ppg")).alias("vor_per_game"),
            )

            exp = _expected(season)
            if exp.height > 0:
                joined = joined.join(exp, on="player_id", how="left")
            else:
                joined = joined.with_columns(
                    pl.lit(None, dtype=pl.Float64).alias("expected_points"),
                    pl.lit(None, dtype=pl.Float64).alias("opportunity_points"),
                    pl.lit(None, dtype=pl.Float64).alias("points_over_expected"),
                )

            shape = _weekly_shape(season)
            joined = (
                joined.join(shape, on="player_id", how="left")
                if shape.height > 0
                else joined.with_columns(
                    pl.lit(None, dtype=pl.Float64).alias("weekly_sd"),
                    pl.lit(None, dtype=pl.Float64).alias("best_week"),
                    pl.lit(None, dtype=pl.Float64).alias("median_week"),
                )
            )

            joined = joined.with_columns(
                pl.col("points").rank("min", descending=True).over("position").cast(pl.Int32).alias("pos_rank"),
                pl.col("vor").rank("min", descending=True).cast(pl.Int32).alias("overall_rank"),
            ).sort("vor", descending=True)

            season_rows.append(joined)
            log(f"{season}: {joined.height:,} fantasy-relevant players · "
                + " ".join(
                    f"{r['position']}{r['replacement_rank']} {r['replacement_ppg']:.1f}"
                    for r in repl.iter_rows(named=True)
                ))

        if not season_rows:
            log("no fantasy seasons built")
            return pl.DataFrame()

        out = pl.concat(season_rows, how="diagonal")
        write_parquet(round_cols(out, 3), "fantasy_season")
        write_parquet(round_cols(pl.concat(replacement_rows, how="diagonal"), 3), "fantasy_replacement")

        newest = out.filter(pl.col("season") == out["season"].max()).head(5)
        log("top by VOR: " + ", ".join(
            f"{r['name']} {r['vor']:.0f}" for r in newest.iter_rows(named=True)
        ))

        if out["expected_points"].null_count() < out.height:
            log(f"expected points available from {FIRST_SEASON['expected_points']}")
        return out
