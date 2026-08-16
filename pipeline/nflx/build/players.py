"""Player index, season lines, weekly game logs and positional percentiles."""

from __future__ import annotations

import polars as pl

from ..config import POSITION_GROUPS
from ..sources import nflverse as nv
from ..util import log, pct_rank, round_cols, step, write_parquet
from .pbp import scrimmage

# Usage floors for "qualified" — percentile ramps are computed inside these groups.
QUALIFY = {"QB": ("dropbacks", 150), "RB": ("carries", 50), "WR": ("targets", 30), "TE": ("targets", 25)}

# Metrics that get a positional percentile, and whether higher is better.
PERCENTILE_METRICS = {
    "QB": [("epa_per_db", True), ("cpoe", True), ("play_success", True),
           ("sack_rate", False), ("passing_yards", True), ("passing_tds", True)],
    "RB": [("epa_per_rush", True), ("play_success", True), ("rushing_yards", True),
           ("yards_per_carry", True), ("receiving_epa", True)],
    "WR": [("epa_per_target", True), ("play_success", True), ("receiving_yards", True),
           ("wopr", True), ("racr", True), ("avg_separation", True), ("avg_yac_above_expectation", True)],
    "TE": [("epa_per_target", True), ("play_success", True), ("receiving_yards", True),
           ("wopr", True), ("avg_separation", True)],
}


# --------------------------------------------------------------- index

def build_index() -> pl.DataFrame:
    with step("player index"):
        df = (
            nv.players()
            .filter(pl.col("gsis_id").is_not_null())
            .select(
                pl.col("gsis_id").alias("player_id"),
                pl.col("display_name").alias("name"),
                pl.col("short_name"),
                "position", "position_group",
                pl.col("latest_team").alias("team"),
                "status", "height", "weight", "birth_date", "college_name",
                "jersey_number", "rookie_season", "last_season", "years_of_experience",
                "draft_year", "draft_round", "draft_pick", "draft_team",
                pl.col("headshot").alias("headshot"),
                "espn_id", "pfr_id", "otc_id",
            )
            .with_columns(
                pl.col("position")
                .replace_strict(POSITION_GROUPS, default=None)
                .alias("pos_group"),
            )
        )
        write_parquet(df, "players")
        return df


# --------------------------------------------------------------- pbp rates

def _passing_rates(plays: pl.DataFrame) -> pl.DataFrame:
    db = plays.filter((pl.col("qb_dropback") == 1) & pl.col("passer_player_id").is_not_null())
    return db.group_by("passer_player_id").agg(
        pl.len().alias("dropbacks"),
        pl.col("qb_epa").mean().alias("epa_per_db"),
        pl.col("qb_epa").sum().alias("total_qb_epa"),
        pl.col("success").mean().alias("play_success"),
        pl.col("cpoe").mean().alias("cpoe_pbp"),
        pl.col("sack").mean().alias("sack_rate"),
        pl.col("air_yards").mean().alias("adot"),
        pl.col("wpa").sum().alias("wpa"),
        pl.col("qb_epa").filter(pl.col("air_yards") >= 20).mean().alias("deep_epa"),
        pl.col("qb_epa").filter(pl.col("down") == 3).mean().alias("third_epa"),
    ).rename({"passer_player_id": "player_id"})


def _rushing_rates(plays: pl.DataFrame) -> pl.DataFrame:
    r = plays.filter((pl.col("play_type") == "run") & pl.col("rusher_player_id").is_not_null())
    return r.group_by("rusher_player_id").agg(
        pl.len().alias("rush_plays"),
        pl.col("epa").mean().alias("epa_per_rush"),
        pl.col("success").mean().alias("rush_success"),
        (pl.col("yards_gained") >= 10).mean().alias("explosive_rush_rate"),
        (pl.col("yards_gained") <= 0).mean().alias("stuff_rate"),
    ).rename({"rusher_player_id": "player_id"})


def _receiving_rates(plays: pl.DataFrame) -> pl.DataFrame:
    rec = plays.filter((pl.col("play_type") == "pass") & pl.col("receiver_player_id").is_not_null())
    return rec.group_by("receiver_player_id").agg(
        pl.len().alias("target_plays"),
        pl.col("epa").mean().alias("epa_per_target"),
        pl.col("success").mean().alias("rec_success"),
        pl.col("air_yards").mean().alias("rec_adot"),
        pl.col("yards_after_catch").mean().alias("yac_per_rec"),
    ).rename({"receiver_player_id": "player_id"})


def _ngs_season(season: int, stat_type: str) -> pl.DataFrame:
    """NGS ships weekly rows plus a week==0 season roll-up; prefer the roll-up."""
    try:
        df = nv.ngs(season, stat_type)
    except Exception as exc:  # nflverse occasionally lags a season
        log(f"! NGS {stat_type} {season} unavailable: {exc}")
        return pl.DataFrame({"player_id": []}, schema={"player_id": pl.String})
    if df.height == 0:
        return pl.DataFrame({"player_id": []}, schema={"player_id": pl.String})
    season_rows = df.filter((pl.col("week") == 0) & (pl.col("season_type") == "REG"))
    if season_rows.height == 0:
        season_rows = df.filter(pl.col("season_type") == "REG")
    cols = {
        "receiving": ["avg_separation", "avg_cushion", "avg_yac_above_expectation",
                      "avg_intended_air_yards", "percent_share_of_intended_air_yards"],
        "passing": ["avg_time_to_throw", "avg_completed_air_yards", "aggressiveness",
                    "completion_percentage_above_expectation", "avg_air_distance"],
        "rushing": ["efficiency", "percent_attempts_gte_eight_defenders",
                    "avg_time_to_los", "rush_yards_over_expected_per_att"],
    }[stat_type]
    have = [c for c in cols if c in season_rows.columns]
    return (
        season_rows.group_by("player_gsis_id")
        .agg([pl.col(c).mean().alias(c) for c in have])
        .rename({"player_gsis_id": "player_id"})
        .filter(pl.col("player_id").is_not_null())
    )


# --------------------------------------------------------------- season lines

def build_seasons(seasons: list[int], index: pl.DataFrame) -> pl.DataFrame:
    with step("player seasons"):
        frames = []
        for season in seasons:
            stats = nv.player_stats(season, "reg")
            if stats.height == 0:
                continue
            plays = scrimmage(nv.pbp(season))

            snap_source = nv.snap_counts(season)
            snaps = (
                snap_source
                .filter(pl.col("game_type") == "REG")
                .group_by("pfr_player_id")
                .agg(
                    pl.col("offense_snaps").sum().alias("off_snaps"),
                    pl.col("defense_snaps").sum().alias("def_snaps"),
                    pl.col("st_snaps").sum().alias("st_snaps"),
                    pl.col("offense_pct").mean().alias("off_snap_pct"),
                    pl.col("defense_pct").mean().alias("def_snap_pct"),
                )
                .rename({"pfr_player_id": "pfr_id"})
            ) if snap_source.height else pl.DataFrame(
                schema={
                    "pfr_id": pl.String, "off_snaps": pl.Float64, "def_snaps": pl.Float64,
                    "st_snaps": pl.Float64, "off_snap_pct": pl.Float64,
                    "def_snap_pct": pl.Float64,
                }
            )

            df = (
                stats.rename({"player_id": "player_id"})
                .join(_passing_rates(plays), on="player_id", how="left")
                .join(_rushing_rates(plays), on="player_id", how="left")
                .join(_receiving_rates(plays), on="player_id", how="left")
                .join(_ngs_season(season, "receiving"), on="player_id", how="left")
                .join(_ngs_season(season, "passing"), on="player_id", how="left")
                .join(_ngs_season(season, "rushing"), on="player_id", how="left")
                .join(
                    index.select("player_id", "pfr_id", "pos_group", "headshot", "espn_id"),
                    on="player_id",
                    how="left",
                )
                .join(snaps, on="pfr_id", how="left")
            )

            df = df.with_columns(
                pl.col("season").cast(pl.Int32),
                pl.coalesce(pl.col("headshot"), pl.col("headshot_url")).alias("headshot"),
                pl.coalesce(pl.col("cpoe_pbp"), pl.col("passing_cpoe")).alias("cpoe"),
                pl.col("carries").alias("carries"),
                pl.when(pl.col("carries") > 0)
                .then(pl.col("rushing_yards") / pl.col("carries"))
                .otherwise(None)
                .alias("yards_per_carry"),
                pl.when(pl.col("targets") > 0)
                .then(pl.col("receiving_yards") / pl.col("targets"))
                .otherwise(None)
                .alias("yards_per_target"),
                pl.coalesce(pl.col("play_success"), pl.col("rush_success"), pl.col("rec_success"))
                .alias("play_success"),
                (pl.col("passing_epa").fill_null(0)
                 + pl.col("rushing_epa").fill_null(0)
                 + pl.col("receiving_epa").fill_null(0)).alias("total_epa"),
            )
            frames.append(df)

        out = pl.concat(frames, how="diagonal")
        out = _add_percentiles(out)
        out = round_cols(out, 4)
        write_parquet(out, "player_season")
        return out


def _add_percentiles(df: pl.DataFrame) -> pl.DataFrame:
    """Percentile ramps within (season, position), among qualified players only."""
    pieces = []
    for pos, metrics in PERCENTILE_METRICS.items():
        col, floor = QUALIFY[pos]
        sub = df.filter((pl.col("position") == pos) & (pl.col(col).fill_null(0) >= floor))
        if sub.height == 0:
            continue
        exprs = []
        for metric, higher_better in metrics:
            if metric not in sub.columns:
                continue
            r = pl.col(metric).rank(method="average", descending=not higher_better)
            exprs.append(
                pl.when(pl.col(metric).is_null())
                .then(None)
                .otherwise(((r / pl.col(metric).is_not_null().sum()) * 100).round(0))
                .over("season")
                .cast(pl.Int32)
                .alias(f"pct_{metric}")
            )
        if exprs:
            pieces.append(
                sub.select("player_id", "season", *exprs).with_columns(
                    pl.lit(True).alias("qualified")
                )
            )
    if not pieces:
        return df.with_columns(pl.lit(False).alias("qualified"))
    pcts = pl.concat(pieces, how="diagonal")
    return df.join(pcts, on=["player_id", "season"], how="left").with_columns(
        pl.col("qualified").fill_null(False)
    )


# --------------------------------------------------------------- weekly logs

def build_weekly(seasons: list[int]) -> pl.DataFrame:
    with step("player game logs"):
        frames = []
        for season in seasons:
            w = nv.player_stats_weekly(season)
            if w.height == 0:
                continue
            plays = scrimmage(nv.pbp(season))
            wk_epa = (
                plays.filter((pl.col("qb_dropback") == 1) & pl.col("passer_player_id").is_not_null())
                .group_by(["passer_player_id", "week"])
                .agg(
                    pl.len().alias("dropbacks"),
                    pl.col("qb_epa").mean().alias("epa_per_db"),
                    pl.col("wpa").sum().alias("wpa"),
                )
                .rename({"passer_player_id": "player_id"})
            )
            frames.append(w.join(wk_epa, on=["player_id", "week"], how="left"))
        out = round_cols(pl.concat(frames, how="diagonal"), 4)
        write_parquet(out, "player_week")
        return out
