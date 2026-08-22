"""Injury reports, depth charts, and the odds a listed player actually suits up.

The play probability is measured rather than borrowed. Every injury report from
2018 on is joined to whether that player took a snap that week, which turns the
league's own designations into empirical rates. Two things fall out that a flat
rule of thumb throws away:

- Practice participation carries more information than the game designation.
  A Questionable player who practiced fully plays 79% of the time; the same
  designation with no practice at all is 46%. Quoting one number for
  "Questionable" discards a thirty-point swing.
- A player on the report with no designation is not healthy. He plays 93%, not
  100%, and if he did not practice, 77%.

Only players whose id demonstrably bridges to the snap data in that season are
counted. Otherwise a failed id match looks identical to a player who sat out,
and every rate is biased downward.
"""

from __future__ import annotations

import polars as pl

import nflreadpy as nfl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

# Snap counts start in 2012, but the practice-participation fields are only
# reliably populated later; 2018 on is the window where both hold up.
FIRST_SEASON = 2018

# Cells thinner than this fall back to the report status alone.
MIN_CELL = 40

STATUS_ORDER = ["Out", "Doubtful", "Questionable", "None"]


def _played(season: int, idx: pl.DataFrame) -> tuple[pl.DataFrame, list[str]]:
    """Did each player take a snap in each week, and whose ids bridge at all."""
    snaps = nv.snap_counts(season)
    if snaps.height == 0:
        return pl.DataFrame(), []
    s = (
        snaps.filter(pl.col("game_type") == "REG")
        .join(idx, left_on="pfr_player_id", right_on="pfr_id", how="inner")
        .select(
            "player_id",
            pl.col("week").cast(pl.Int32),
            (
                pl.col("offense_snaps").fill_null(0)
                + pl.col("defense_snaps").fill_null(0)
                + pl.col("st_snaps").fill_null(0)
            ).alias("snaps"),
        )
    )
    return s, s["player_id"].unique().to_list()


def _history(seasons: list[int], idx: pl.DataFrame) -> pl.DataFrame:
    frames = []
    for season in seasons:
        if season < FIRST_SEASON:
            continue
        try:
            inj = nfl.load_injuries(season).filter(pl.col("game_type") == "REG")
        except Exception:
            continue
        if inj.height == 0:
            continue
        snaps, bridged = _played(season, idx)
        if not bridged:
            continue
        frames.append(
            inj.with_columns(pl.col("week").cast(pl.Int32))
            .filter(pl.col("gsis_id").is_in(bridged))
            .join(snaps, left_on=["gsis_id", "week"], right_on=["player_id", "week"], how="left")
            .with_columns(
                (pl.col("snaps").fill_null(0) > 0).alias("played"),
                pl.lit(season).alias("season"),
            )
            .select("season", "week", "gsis_id", "position",
                    "report_status", "practice_status", "played")
        )
    return pl.concat(frames, how="diagonal") if frames else pl.DataFrame()


def _normalize() -> tuple[pl.Expr, pl.Expr]:
    """Collapse the league's wordy fields into the four values people recognize."""
    status = (
        pl.when(pl.col("report_status").is_in(["Out", "Doubtful", "Questionable"]))
        .then(pl.col("report_status"))
        .otherwise(pl.lit("None"))
        .alias("status")
    )
    practice = (
        pl.when(pl.col("practice_status").str.contains("(?i)did not"))
        .then(pl.lit("DNP"))
        .when(pl.col("practice_status").str.contains("(?i)limited"))
        .then(pl.lit("Limited"))
        .when(pl.col("practice_status").str.contains("(?i)full"))
        .then(pl.lit("Full"))
        .otherwise(pl.lit("Unknown"))
        .alias("practice")
    )
    return status, practice


def _rates(hist: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
    status, practice = _normalize()
    h = hist.with_columns(status, practice)

    by_both = (
        h.group_by("status", "practice")
        .agg(pl.col("played").mean().alias("p_play"), pl.len().alias("n"))
        .filter(pl.col("n") >= MIN_CELL)
    )
    by_status = h.group_by("status").agg(
        pl.col("played").mean().alias("p_play_status"), pl.len().alias("n_status")
    )
    return by_both, by_status


def _current_reports(season: int, idx: pl.DataFrame) -> pl.DataFrame:
    """The most recent report row per player in the given season."""
    try:
        inj = nfl.load_injuries(season)
    except Exception:
        return pl.DataFrame()
    if inj.height == 0:
        return pl.DataFrame()
    return (
        inj.sort("week")
        .group_by("gsis_id")
        .last()
        .with_columns(pl.lit(season).alias("season"))
    )


def build_depth(season: int, idx: pl.DataFrame) -> pl.DataFrame:
    """Latest depth chart snapshot per club."""
    with step("depth charts"):
        try:
            dc = nfl.load_depth_charts(season)
        except Exception as exc:
            log(f"depth charts unavailable: {exc!r}")
            return pl.DataFrame()
        if dc.height == 0:
            log("no depth charts published yet")
            return pl.DataFrame()

        latest = dc["dt"].max()
        snap = dc.filter(pl.col("dt") == latest)
        # A club missing from the newest snapshot keeps its own most recent one.
        newest_per_team = dc.group_by("team").agg(pl.col("dt").max().alias("dt"))
        snap = dc.join(newest_per_team, on=["team", "dt"], how="inner")

        out = (
            snap.filter(pl.col("gsis_id").is_not_null())
            .select(
                pl.col("gsis_id").alias("player_id"),
                "team",
                pl.col("pos_abb").alias("depth_pos"),
                pl.col("pos_rank").alias("depth_rank"),
                pl.col("dt").alias("depth_as_of"),
            )
            # One row per player: keep the position where he ranks highest.
            .sort("depth_rank")
            .unique(subset=["player_id"], keep="first")
            .with_columns(pl.lit(season).alias("season"))
        )
        write_parquet(out, "depth_charts")
        log(f"{out.height} players on {out['team'].n_unique()} depth charts · as of {latest}")
        return out


def build(seasons: list[int], upcoming: int, index: pl.DataFrame) -> pl.DataFrame:
    with step("injury model"):
        idx = index.select("player_id", "pfr_id").drop_nulls()
        hist = _history(seasons, idx)
        if hist.height == 0:
            log("no injury history available")
            return pl.DataFrame()

        by_both, by_status = _rates(hist)
        rates = by_both.join(by_status, on="status", how="full", coalesce=True)
        write_parquet(round_cols(rates, 4), "injury_rates")

        for r in rates.sort("p_play").iter_rows(named=True):
            if r["practice"] is not None:
                log(f"  {r['status']:12s} {r['practice']:8s} plays {r['p_play']:.1%} (n={r['n']:,})")

        # Reports for whichever season has them: the upcoming one once camp
        # starts, otherwise the last one played.
        reports = _current_reports(upcoming, idx)
        source = upcoming
        if reports.height == 0:
            source = max(seasons)
            reports = _current_reports(source, idx)
        if reports.height == 0:
            log("no injury reports published")
            return rates

        status, practice = _normalize()
        reports = (
            reports.with_columns(status, practice)
            .join(by_both.select("status", "practice", "p_play"), on=["status", "practice"], how="left")
            .join(by_status.select("status", "p_play_status"), on="status", how="left")
            .with_columns(
                pl.col("p_play").fill_null(pl.col("p_play_status")).alias("p_play"),
                pl.lit(source).alias("report_season"),
            )
            .select(
                pl.col("gsis_id").alias("player_id"), "report_season", "week", "team", "position",
                "status", "practice", "p_play",
                pl.col("report_primary_injury").alias("injury"),
            )
        )
        write_parquet(round_cols(reports, 4), "injury_reports")
        log(f"{reports.height} current reports from {source} week {reports['week'].max()}")
        return rates
