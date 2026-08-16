"""Team efficiency: EPA splits, tendencies, drive stats, opponent adjustment."""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import rank_asc, rank_desc, round_cols, step, write_parquet
from .pbp import scrimmage

DRIVE_POINTS = {
    "Touchdown": 7.0,
    "Field goal": 3.0,
    "Safety": -2.0,
    "Opp touchdown": -7.0,
}

ADJUST_ITERATIONS = 8


# --------------------------------------------------------------- aggregation

def _side_metrics(plays: pl.DataFrame, team_col: str, prefix: str) -> pl.DataFrame:
    """EPA splits for one side of the ball, grouped by the given team column."""
    is_pass = pl.col("play_type") == "pass"
    is_rush = pl.col("play_type") == "run"
    early = pl.col("down").is_in([1, 2])
    explosive = (is_pass & (pl.col("yards_gained") >= 20)) | (
        is_rush & (pl.col("yards_gained") >= 10)
    )

    return plays.group_by(team_col).agg(
        pl.len().alias(f"{prefix}_plays"),
        pl.col("epa").mean().alias(f"{prefix}_epa"),
        pl.col("success").mean().alias(f"{prefix}_success"),
        pl.col("epa").filter(is_pass).mean().alias(f"{prefix}_pass_epa"),
        pl.col("epa").filter(is_rush).mean().alias(f"{prefix}_rush_epa"),
        is_pass.mean().alias(f"{prefix}_pass_rate"),
        pl.col("epa").filter(early).mean().alias(f"{prefix}_early_epa"),
        explosive.mean().alias(f"{prefix}_explosive_rate"),
        pl.col("epa").filter(pl.col("down") == 3).mean().alias(f"{prefix}_third_epa"),
        pl.col("cpoe").mean().alias(f"{prefix}_cpoe"),
        pl.col("pass_oe").mean().alias(f"{prefix}_proe"),
        pl.col("sack").mean().alias(f"{prefix}_sack_rate"),
        pl.col("epa").filter(pl.col("yardline_100") <= 20).mean().alias(f"{prefix}_rz_epa"),
    ).rename({team_col: "team"})


def _drive_metrics(pbp: pl.DataFrame, team_col: str, prefix: str) -> pl.DataFrame:
    """Points per drive, drive success, three-and-out rate, red zone conversion."""
    drives = (
        pbp.filter(
            pl.col("fixed_drive").is_not_null()
            & pl.col("fixed_drive_result").is_not_null()
            & pl.col(team_col).is_not_null()
        )
        .group_by(["game_id", team_col, "fixed_drive"])
        .agg(
            pl.col("fixed_drive_result").first().alias("result"),
            pl.col("yardline_100").min().alias("closest"),
            pl.col("epa").sum().alias("drive_epa"),
            pl.col("play_type").is_in(["pass", "run"]).sum().alias("scrimmage_plays"),
        )
    )
    points = (
        pl.col("result")
        .replace_strict(DRIVE_POINTS, default=0.0, return_dtype=pl.Float64)
    )
    return drives.group_by(team_col).agg(
        pl.len().alias(f"{prefix}_drives"),
        points.mean().alias(f"{prefix}_points_per_drive"),
        (pl.col("result") == "Touchdown").mean().alias(f"{prefix}_td_rate"),
        ((pl.col("result").is_in(["Punt", "Turnover", "Downs"])) & (pl.col("scrimmage_plays") <= 3))
        .mean()
        .alias(f"{prefix}_three_out_rate"),
        (pl.col("result") == "Touchdown")
        .filter(pl.col("closest") <= 20)
        .mean()
        .alias(f"{prefix}_rz_td_rate"),
    ).rename({team_col: "team"})


def _third_down(pbp: pl.DataFrame, team_col: str, prefix: str) -> pl.DataFrame:
    d = pbp.filter(
        (pl.col("down") == 3)
        & pl.col(team_col).is_not_null()
        & (pl.col("third_down_converted") + pl.col("third_down_failed") > 0)
    )
    return d.group_by(team_col).agg(
        pl.col("third_down_converted").mean().alias(f"{prefix}_third_conv"),
    ).rename({team_col: "team"})


def _tendencies(plays: pl.DataFrame) -> pl.DataFrame:
    neutral = pl.col("wp").is_between(0.2, 0.8) & pl.col("down").is_in([1, 2])
    return plays.group_by("posteam").agg(
        pl.col("shotgun").mean().alias("shotgun_rate"),
        pl.col("no_huddle").mean().alias("no_huddle_rate"),
        (pl.col("play_type") == "pass").filter(neutral).mean().alias("neutral_pass_rate"),
        pl.col("pass_oe").filter(neutral).mean().alias("neutral_proe"),
    ).rename({"posteam": "team"})


# --------------------------------------------------------------- adjustment

def _opponent_adjust(plays: pl.DataFrame) -> pl.DataFrame:
    """Iteratively strip opponent strength out of raw EPA per play.

    A team that faced a brutal defensive schedule gets credit for it. This is the
    same idea DVOA uses; converges in well under the iteration cap.
    """
    league = plays["epa"].mean()
    p = plays.select("posteam", "defteam", "epa")

    off = p.group_by("posteam").agg(pl.col("epa").mean().alias("off_adj")).rename(
        {"posteam": "team"}
    )
    dfn = p.group_by("defteam").agg(pl.col("epa").mean().alias("def_adj")).rename(
        {"defteam": "team"}
    )

    for _ in range(ADJUST_ITERATIONS):
        # Offense: subtract how much better/worse than average each opponent defense is.
        joined = p.join(
            dfn.rename({"team": "defteam", "def_adj": "opp_def"}), on="defteam", how="left"
        )
        off = (
            joined.with_columns((pl.col("epa") - (pl.col("opp_def") - league)).alias("adj"))
            .group_by("posteam")
            .agg(pl.col("adj").mean().alias("off_adj"))
            .rename({"posteam": "team"})
        )
        # Defense: same move, against the offenses it faced.
        joined = p.join(
            off.rename({"team": "posteam", "off_adj": "opp_off"}), on="posteam", how="left"
        )
        dfn = (
            joined.with_columns((pl.col("epa") - (pl.col("opp_off") - league)).alias("adj"))
            .group_by("defteam")
            .agg(pl.col("adj").mean().alias("def_adj"))
            .rename({"defteam": "team"})
        )

    return off.join(dfn, on="team", how="full", coalesce=True)


def _strength_of_schedule(games: pl.DataFrame, adj: pl.DataFrame, season: int) -> pl.DataFrame:
    """Average opponent net adjusted EPA, over games actually played."""
    g = games.filter((pl.col("season") == season) & pl.col("played"))
    pairs = pl.concat([
        g.select(pl.col("home_team").alias("team"), pl.col("away_team").alias("opp")),
        g.select(pl.col("away_team").alias("team"), pl.col("home_team").alias("opp")),
    ])
    net = adj.select("team", (pl.col("off_adj") - pl.col("def_adj")).alias("net"))
    return (
        pairs.join(net.rename({"team": "opp", "net": "opp_net"}), on="opp", how="left")
        .group_by("team")
        .agg(pl.col("opp_net").mean().alias("sos"))
    )


# --------------------------------------------------------------- entry point

def build(seasons: list[int], games: pl.DataFrame) -> pl.DataFrame:
    with step("team season efficiency"):
        frames = []
        for season in seasons:
            raw = nv.pbp(season)
            plays = scrimmage(raw)
            if plays.height == 0:
                continue

            df = (
                _side_metrics(plays, "posteam", "off")
                .join(_side_metrics(plays, "defteam", "def"), on="team", how="full", coalesce=True)
                .join(_drive_metrics(raw, "posteam", "off"), on="team", how="left")
                .join(_drive_metrics(raw, "defteam", "def"), on="team", how="left")
                .join(_third_down(raw, "posteam", "off"), on="team", how="left")
                .join(_third_down(raw, "defteam", "def"), on="team", how="left")
                .join(_tendencies(plays), on="team", how="left")
                .join(_opponent_adjust(plays), on="team", how="left")
            )
            df = df.join(_strength_of_schedule(games, df, season), on="team", how="left")
            df = df.with_columns(
                pl.lit(season).cast(pl.Int32).alias("season"),
                (pl.col("off_epa") - pl.col("def_epa")).alias("net_epa"),
                (pl.col("off_adj") - pl.col("def_adj")).alias("net_adj"),
            ).with_columns(
                rank_desc("off_adj").alias("off_rank"),
                rank_asc("def_adj").alias("def_rank"),
                rank_desc("net_adj").alias("net_rank"),
                rank_desc("off_pass_epa").alias("off_pass_rank"),
                rank_desc("off_rush_epa").alias("off_rush_rank"),
                rank_asc("def_pass_epa").alias("def_pass_rank"),
                rank_asc("def_rush_epa").alias("def_rush_rank"),
                rank_desc("off_points_per_drive").alias("off_ppd_rank"),
                rank_asc("def_points_per_drive").alias("def_ppd_rank"),
            )
            frames.append(df)

        out = round_cols(pl.concat(frames, how="diagonal"), 4).sort(["season", "net_rank"])
        write_parquet(out, "team_season")
        return out
