"""Fourth down decisions: history, team tendencies, and the calculator grid."""

from __future__ import annotations

import numpy as np
import polars as pl

from ..models import fourth_down as fd_model
from ..models import win_probability as wp_model
from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

# Situations where the decision is real: not garbage time, not a desperation
# heave as the half expires.
LIVE_WP = (0.05, 0.95)
MIN_HALF_SECONDS = 30

# Calculator grid. Timeouts are held at 3/3 — they matter mostly inside two
# minutes, and the page says so.
GRID_YARDLINE = range(1, 100)
GRID_YDSTOGO = range(1, 11)
GRID_SCORE_DIFF = range(-21, 22)
GRID_SECONDS = range(0, 3601, 120)


def _actual_choice() -> pl.Expr:
    return (
        pl.when(pl.col("play_type").is_in(["pass", "run"]))
        .then(pl.lit("go"))
        .when(pl.col("play_type") == "field_goal")
        .then(pl.lit("fg"))
        .when(pl.col("play_type") == "punt")
        .then(pl.lit("punt"))
        .otherwise(None)
    )


def _score(df: pl.DataFrame, model: fd_model.FourthDownModel) -> pl.DataFrame:
    """Attach WP-by-choice to a frame of fourth down snaps."""
    out = model.evaluate(
        yardline_100=df["yardline_100"].to_numpy(),
        ydstogo=df["ydstogo"].to_numpy(),
        score_differential=df["score_differential"].to_numpy(),
        game_seconds_remaining=df["game_seconds_remaining"].to_numpy(),
        half_seconds_remaining=df["half_seconds_remaining"].to_numpy(),
        posteam_timeouts=df["posteam_timeouts_remaining"].to_numpy(),
        defteam_timeouts=df["defteam_timeouts_remaining"].to_numpy(),
    )
    return df.with_columns([pl.Series(k, v) for k, v in out.items()]).with_columns(
        # Punting inside the 35 and out-of-range kicks come back NaN. NaN loses
        # every comparison, so they must become real nulls before any max/fill.
        pl.col("wp_punt").fill_nan(None),
        pl.col("wp_fg").fill_nan(None),
    )


def _best_choice() -> pl.Expr:
    """Highest win probability among the available options."""
    fg = pl.col("wp_fg").fill_null(-1)
    punt = pl.col("wp_punt").fill_null(-1)
    return (
        pl.when((pl.col("wp_go") >= fg) & (pl.col("wp_go") >= punt))
        .then(pl.lit("go"))
        .when(fg >= punt)
        .then(pl.lit("fg"))
        .otherwise(pl.lit("punt"))
    )


def build(seasons: list[int], games: pl.DataFrame) -> None:
    with step("fourth down models"):
        frames = [nv.pbp(s) for s in seasons]

        wp = wp_model.train(frames)
        model = fd_model.train(frames, wp)

        # ---------------------------------------------------------- history
        history = pl.concat(
            [
                f.filter(
                    (pl.col("down") == 4)
                    & (pl.col("season_type") == "REG")
                    & pl.col("play_type").is_in(["pass", "run", "punt", "field_goal"])
                    & pl.col("yardline_100").is_not_null()
                    & pl.col("score_differential").is_not_null()
                    & pl.col("game_seconds_remaining").is_not_null()
                    & pl.col("wp").is_not_null()
                ).select(
                    "game_id", "play_id", "season", "week", "posteam", "defteam",
                    "qtr", "down", "ydstogo", "yardline_100", "score_differential",
                    "game_seconds_remaining", "half_seconds_remaining",
                    "posteam_timeouts_remaining", "defteam_timeouts_remaining",
                    "play_type", "desc", "wp", "epa",
                    "fourth_down_converted", "fourth_down_failed", "field_goal_result",
                )
                for f in frames
            ],
            how="vertical",
        )

        history = _score(history, model).with_columns(
            _actual_choice().alias("choice"),
            _best_choice().alias("best"),
        )

        history = history.with_columns(
            pl.max_horizontal(
                pl.col("wp_go"), pl.col("wp_fg").fill_null(-1), pl.col("wp_punt").fill_null(-1)
            ).alias("wp_best"),
            pl.when(pl.col("choice") == "go")
            .then(pl.col("wp_go"))
            .when(pl.col("choice") == "fg")
            .then(pl.col("wp_fg"))
            .otherwise(pl.col("wp_punt"))
            .alias("wp_choice"),
        ).with_columns(
            ((pl.col("wp_best") - pl.col("wp_choice")) * 100).alias("wp_lost"),
            (pl.col("choice") == pl.col("best")).alias("optimal"),
            (
                pl.col("wp").is_between(*LIVE_WP)
                & (pl.col("half_seconds_remaining") > MIN_HALF_SECONDS)
            ).alias("live"),
        )

        write_parquet(round_cols(history, 4), "fourth_downs")

        # ---------------------------------------------------------- by team
        coaches = pl.concat([
            games.select("season", pl.col("home_team").alias("team"), pl.col("home_coach").alias("coach")),
            games.select("season", pl.col("away_team").alias("team"), pl.col("away_coach").alias("coach")),
        ]).group_by(["season", "team"]).agg(pl.col("coach").mode().first().alias("coach"))

        live = history.filter(pl.col("live"))
        by_team = (
            live.group_by(["season", pl.col("posteam").alias("team")])
            .agg(
                pl.len().alias("situations"),
                (pl.col("choice") == "go").sum().alias("went"),
                (pl.col("best") == "go").sum().alias("go_optimal"),
                ((pl.col("choice") == "go") & (pl.col("best") == "go")).sum().alias("went_when_optimal"),
                pl.col("optimal").mean().alias("optimal_rate"),
                pl.col("wp_lost").sum().alias("wp_lost"),
                (pl.col("wp_lost") > 1.0).sum().alias("clear_errors"),
                pl.col("fourth_down_converted").sum().alias("conversions"),
            )
            .with_columns(
                (pl.col("went") / pl.col("situations")).alias("go_rate"),
                pl.when(pl.col("go_optimal") > 0)
                .then(pl.col("went_when_optimal") / pl.col("go_optimal"))
                .otherwise(None)
                .alias("go_rate_when_optimal"),
            )
            .join(coaches, on=["season", "team"], how="left")
            .sort(["season", "wp_lost"])
        )
        write_parquet(round_cols(by_team, 4), "fourth_down_teams")

        # ---------------------------------------------------------- calculator grid
        _build_grid(model)

        # Branch probabilities are low-dimensional, so they ship separately
        # instead of bloating every row of the grid.
        rates = []
        for ytg in GRID_YDSTOGO:
            yl = np.array(list(GRID_YARDLINE), dtype=float)
            p = model.p_convert(np.full(len(yl), float(ytg)), yl)
            rates.append(pl.DataFrame({
                "ydstogo": np.full(len(yl), ytg, dtype=np.int8),
                "yardline_100": yl.astype(np.int16),
                "p_convert": p.astype(np.float32),
            }))
        write_parquet(pl.concat(rates), "fourth_down_convert_rates")

        yl = np.array(list(GRID_YARDLINE), dtype=float)
        write_parquet(
            pl.DataFrame({
                "yardline_100": yl.astype(np.int16),
                "kick_distance": (yl + 17).astype(np.int16),
                "p_fg": model.p_field_goal(yl).astype(np.float32),
                "punt_to": model.punt_result(yl).astype(np.float32),
            }).with_columns(pl.col("p_fg").fill_nan(None)),
            "fourth_down_kick_rates",
        )


def _build_grid(model: fd_model.FourthDownModel) -> None:
    """Every situation the calculator can be asked about, priced ahead of time.

    Evaluated in score-differential batches so peak memory stays small.
    """
    yl = np.array(list(GRID_YARDLINE), dtype=float)
    ytg = np.array(list(GRID_YDSTOGO), dtype=float)
    secs = np.array(list(GRID_SECONDS), dtype=float)

    mesh_yl, mesh_ytg, mesh_secs = np.meshgrid(yl, ytg, secs, indexing="ij")
    mesh_yl = mesh_yl.ravel()
    mesh_ytg = mesh_ytg.ravel()
    mesh_secs = mesh_secs.ravel()
    # Second half seconds fold into the half clock; first half keeps its own.
    mesh_hsr = np.where(mesh_secs > 1800, mesh_secs - 1800, mesh_secs)

    parts = []
    for sd in GRID_SCORE_DIFF:
        out = model.evaluate(
            yardline_100=mesh_yl,
            ydstogo=mesh_ytg,
            score_differential=np.full(len(mesh_yl), float(sd)),
            game_seconds_remaining=mesh_secs,
            half_seconds_remaining=mesh_hsr,
        )
        parts.append(
            pl.DataFrame({
                "score_differential": np.full(len(mesh_yl), sd, dtype=np.int8),
                "yardline_100": mesh_yl.astype(np.int16),
                "ydstogo": mesh_ytg.astype(np.int8),
                "game_seconds_remaining": mesh_secs.astype(np.int16),
                "wp_go": (out["wp_go"] * 100).astype(np.float32),
                "wp_fg": (out["wp_fg"] * 100).astype(np.float32),
                "wp_punt": (out["wp_punt"] * 100).astype(np.float32),
            })
        )

    grid = (
        pl.concat(parts)
        .with_columns(pl.col("wp_punt").fill_nan(None), pl.col("wp_fg").fill_nan(None))
        .sort(["score_differential", "game_seconds_remaining", "yardline_100", "ydstogo"])
    )
    write_parquet(grid, "fourth_down_grid")
    log(f"grid covers {grid.height:,} situations")
