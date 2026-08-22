"""Player index, season lines, weekly game logs and positional percentiles."""

from __future__ import annotations

import polars as pl

from ..config import POSITION_GROUPS
from ..sources import nflverse as nv
from ..util import log, pct_rank, round_cols, step, write_parquet
from .pbp import scrimmage

# Usage floors for "qualified" — percentile ramps are computed inside these groups.
QUALIFY = {
    "QB": ("dropbacks", 150), "RB": ("carries", 50),
    "WR": ("targets", 30), "TE": ("targets", 25),
    # Defenders qualify on snaps rather than on any counting stat, because the
    # counting stats are what is being ranked. Corners and safeties are ranked
    # among themselves; the front is split into edge and interior, which play
    # different jobs and post different pressure numbers.
    "CB": ("def_snaps", 250), "SAF": ("def_snaps", 250), "FS": ("def_snaps", 250),
    "S": ("def_snaps", 250), "SS": ("def_snaps", 250), "DB": ("def_snaps", 250),
    "LB": ("def_snaps", 250), "OLB": ("def_snaps", 250), "ILB": ("def_snaps", 250),
    "MLB": ("def_snaps", 250),
    "DE": ("def_snaps", 250), "DT": ("def_snaps", 250), "NT": ("def_snaps", 250),
    "DL": ("def_snaps", 250),
}

# Metrics that get a positional percentile, and whether higher is better.
#
# Deliberately wide. The card draws a bar wherever a percentile exists, so a
# metric left out of this table is a row that reads as a bare number beside rows
# that carry a rank. Only genuinely directionless stats are omitted — aDOT,
# aggressiveness and cushion describe a role rather than a quality, and ranking
# them would assert that deeper or more aggressive is simply better.
PERCENTILE_METRICS = {
    "CB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "SAF": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "FS": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "S": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "SS": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "DB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "LB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "OLB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "ILB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "MLB": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "DE": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "DT": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "NT": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "DL": [("def_pressures", True), ("def_hurries", True), ("def_qb_knockdowns", True),
           ("def_sacks", True), ("def_tackles_for_loss", True), ("def_qb_hits", True),
           ("def_tackles_combined", True), ("def_missed_tackle_pct", False),
           ("def_interceptions", True), ("def_pass_defended", True),
           ("def_targets", False), ("def_completion_pct_allowed", False),
           ("def_yards_allowed", False), ("def_passer_rating_allowed", False),
           ("def_yac_allowed", False), ("def_snaps", True),
           ("def_missed_tackles", False), ("def_fumbles_forced", True),
           ("def_tds_allowed", False)],
    "QB": [("total_epa", True), ("passing_epa", True), ("rushing_epa", True),
           ("epa_per_db", True), ("cpoe", True), ("play_success", True),
           ("sack_rate", False), ("passing_yards", True), ("passing_tds", True),
           ("passing_interceptions", False), ("passing_first_downs", True),
           ("passing_20", True), ("total_qb_epa", True), ("deep_epa", True),
           ("completions", True), ("attempts", True), ("completion_pct", True),
           ("yards_per_attempt", True), ("passing_air_yards", True),
           ("sacks_suffered", False), ("rushing_yards", True), ("rushing_tds", True),
           ("epa_per_rush", True), ("yards_per_carry", True), ("rush_success", True),
           ("rushing_first_downs", True),
           ("passing_yards_after_catch", True),
           ("third_epa", True), ("wpa", True), ("pacr", True),
           ("games", True), ("off_snaps", True), ("off_snap_pct", True),
           ("fantasy_points", True), ("fantasy_points_ppr", True),
           ("carries", True), ("explosive_rush_rate", True), ("stuff_rate", False),
           ("penalties", False), ("fumbles_total", False),
           ("rz_carries", True), ("rz_rush_tds", True), ("gl_rush_tds", True),
           ("expected_completion_percentage", True), ("avg_air_yards_to_sticks", True),
           ("avg_air_yards_differential", True), ("passer_rating", True),
           ("max_completed_air_distance", True)],
    "RB": [("total_epa", True), ("rushing_epa", True),
           ("epa_per_rush", True), ("play_success", True), ("rushing_yards", True),
           ("yards_per_carry", True), ("receiving_epa", True), ("yprr", True),
           ("rushing_tds", True), ("rushing_first_downs", True),
           ("explosive_rush_rate", True), ("stuff_rate", False),
           ("rush_yards_over_expected_per_att", True), ("receiving_yards", True),
           ("carries", True), ("receptions", True), ("targets", True),
           ("catch_pct", True), ("yards_per_rec", True),
           ("games", True), ("off_snaps", True), ("off_snap_pct", True),
           ("fantasy_points", True), ("fantasy_points_ppr", True),
           ("rush_success", True), ("epa_per_target", True), ("tprr", True),
           ("target_share", True), ("wopr", True), ("rec_success", True),
           ("receiving_tds", True), ("receiving_first_downs", True),
           ("yac_per_rec", True), ("yards_per_target", True),
           ("routes", True), ("receiving_20", True), ("receiving_air_yards", True),
           ("penalties", False), ("fumbles_total", False),
           ("rz_carries", True), ("rz_rush_yards", True), ("rz_rush_tds", True),
           ("rz_rush_success", True), ("rz_epa_per_rush", True), ("gl_carries", True),
           ("gl_rush_tds", True), ("rz_targets", True), ("rz_rec_tds", True),
           ("rush_yards_over_expected", True), ("rush_pct_over_expected", True),
           ("efficiency", False), ("avg_time_to_los", False)],
    "WR": [("total_epa", True), ("receiving_epa", True), ("rushing_epa", True),
           ("epa_per_target", True), ("play_success", True), ("receiving_yards", True),
           ("wopr", True), ("racr", True), ("avg_separation", True),
           ("avg_yac_above_expectation", True), ("yprr", True), ("tprr", True),
           ("receiving_tds", True), ("receiving_first_downs", True),
           ("yards_per_target", True), ("yac_per_rec", True), ("target_share", True),
           ("air_yards_share", True), ("receptions", True), ("receiving_20", True),
           ("targets", True), ("catch_pct", True), ("yards_per_rec", True),
           ("receiving_air_yards", True),
           ("games", True), ("off_snaps", True), ("off_snap_pct", True),
           ("fantasy_points", True), ("fantasy_points_ppr", True),
           ("routes", True),
           ("rec_success", True),
           ("penalties", False), ("fumbles_total", False),
           ("rz_targets", True), ("rz_receptions", True), ("rz_rec_yards", True),
           ("rz_rec_tds", True), ("rz_epa_per_target", True), ("gl_targets", True),
           ("avg_yac", True), ("avg_expected_yac", True), ("catch_percentage", True)],
    "TE": [("total_epa", True), ("receiving_epa", True),
           ("epa_per_target", True), ("play_success", True), ("receiving_yards", True),
           ("wopr", True), ("avg_separation", True), ("yprr", True), ("tprr", True),
           ("receiving_tds", True), ("receiving_first_downs", True),
           ("yards_per_target", True), ("yac_per_rec", True), ("target_share", True),
           ("air_yards_share", True), ("receptions", True), ("receiving_20", True),
           ("targets", True), ("catch_pct", True), ("yards_per_rec", True),
           ("receiving_air_yards", True),
           ("games", True), ("off_snaps", True), ("off_snap_pct", True),
           ("fantasy_points", True), ("fantasy_points_ppr", True),
           ("routes", True),
           ("rec_success", True), ("racr", True), ("avg_yac_above_expectation", True),
           ("penalties", False), ("fumbles_total", False),
           ("rz_targets", True), ("rz_receptions", True), ("rz_rec_yards", True),
           ("rz_rec_tds", True), ("rz_epa_per_target", True), ("gl_targets", True),
           ("avg_yac", True), ("avg_expected_yac", True), ("catch_percentage", True)],
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
    # Inside the twenty, and inside the five. The second is not a subset worth
    # folding into the first: goal-line work is a different job, and a back who
    # gets the ball at the one is being used in a way that season totals hide.
    rz = pl.col("yardline_100") <= 20
    gl = pl.col("yardline_100") <= 5
    return r.group_by("rusher_player_id").agg(
        pl.len().alias("rush_plays"),
        pl.col("epa").mean().alias("epa_per_rush"),
        pl.col("success").mean().alias("rush_success"),
        (pl.col("yards_gained") >= 10).mean().alias("explosive_rush_rate"),
        (pl.col("yards_gained") <= 0).mean().alias("stuff_rate"),
        rz.sum().alias("rz_carries"),
        pl.col("yards_gained").filter(rz).sum().alias("rz_rush_yards"),
        pl.col("rush_touchdown").filter(rz).sum().alias("rz_rush_tds"),
        pl.col("success").filter(rz).mean().alias("rz_rush_success"),
        pl.col("epa").filter(rz).mean().alias("rz_epa_per_rush"),
        gl.sum().alias("gl_carries"),
        pl.col("rush_touchdown").filter(gl).sum().alias("gl_rush_tds"),
        pl.col("success").filter(gl).mean().alias("gl_rush_success"),
    ).rename({"rusher_player_id": "player_id"})


def _receiving_rates(plays: pl.DataFrame) -> pl.DataFrame:
    rec = plays.filter((pl.col("play_type") == "pass") & pl.col("receiver_player_id").is_not_null())
    rz = pl.col("yardline_100") <= 20
    gl = pl.col("yardline_100") <= 5
    return rec.group_by("receiver_player_id").agg(
        pl.len().alias("target_plays"),
        pl.col("epa").mean().alias("epa_per_target"),
        pl.col("success").mean().alias("rec_success"),
        pl.col("air_yards").mean().alias("rec_adot"),
        pl.col("yards_after_catch").mean().alias("yac_per_rec"),
        rz.sum().alias("rz_targets"),
        pl.col("complete_pass").filter(rz).sum().alias("rz_receptions"),
        pl.col("yards_gained").filter(rz).sum().alias("rz_rec_yards"),
        pl.col("pass_touchdown").filter(rz).sum().alias("rz_rec_tds"),
        pl.col("epa").filter(rz).mean().alias("rz_epa_per_target"),
        gl.sum().alias("gl_targets"),
        pl.col("pass_touchdown").filter(gl).sum().alias("gl_rec_tds"),
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
                      "avg_intended_air_yards", "percent_share_of_intended_air_yards",
                      "avg_yac", "avg_expected_yac", "catch_percentage"],
        "passing": ["avg_time_to_throw", "avg_completed_air_yards", "aggressiveness",
                    "completion_percentage_above_expectation", "avg_air_distance",
                    "expected_completion_percentage", "completion_percentage",
                    "avg_air_yards_to_sticks", "avg_air_yards_differential",
                    "max_completed_air_distance", "max_air_distance", "passer_rating"],
        "rushing": ["efficiency", "percent_attempts_gte_eight_defenders",
                    "avg_time_to_los", "rush_yards_over_expected_per_att",
                    "expected_rush_yards", "rush_yards_over_expected",
                    "rush_pct_over_expected"],
    }[stat_type]
    have = [c for c in cols if c in season_rows.columns]
    return (
        season_rows.group_by("player_gsis_id")
        .agg([pl.col(c).mean().alias(c) for c in have])
        .rename({"player_gsis_id": "player_id"})
        .filter(pl.col("player_id").is_not_null())
    )


# --------------------------------------------------------------- defense

# PFR's charted defensive columns, renamed to say what they are. These are the
# only public per-player pressure and coverage figures: nflverse's own defensive
# stats stop at tackles, sacks and interceptions, which is why a corner having a
# season could not be told from one being thrown at all year.
PFR_DEF = {
    "prss": "def_pressures",
    "hrry": "def_hurries",
    "qbkd": "def_qb_knockdowns",
    "bltz": "def_blitzes",
    "comb": "def_tackles_combined",
    "m_tkl": "def_missed_tackles",
    "m_tkl_percent": "def_missed_tackle_pct",
    "tgt": "def_targets",
    "cmp": "def_completions_allowed",
    "cmp_percent": "def_completion_pct_allowed",
    "yds": "def_yards_allowed",
    "td": "def_tds_allowed",
    "rat": "def_passer_rating_allowed",
    "dadot": "def_adot",
    "yac": "def_yac_allowed",
}


def _pfr_defense(season: int) -> pl.DataFrame:
    """Charted coverage and pass-rush lines, keyed on the PFR id."""
    empty = pl.DataFrame(schema={"pfr_id": pl.String})
    try:
        df = nv.pfr_advstats(season, "def", "season")
    except Exception as exc:
        log(f"! PFR defensive advstats {season} unavailable: {exc}")
        return empty
    if df.height == 0 or "pfr_id" not in df.columns:
        return empty
    have = {k: v for k, v in PFR_DEF.items() if k in df.columns}
    return (
        df.filter(pl.col("pfr_id").is_not_null())
        .group_by("pfr_id")
        .agg([pl.col(k).sum().alias(v) if k not in ("cmp_percent", "m_tkl_percent", "rat", "dadot")
              else pl.col(k).mean().alias(v) for k, v in have.items()])
    )


# --------------------------------------------------------------- routes

# Routes are only as good as the participation feed, which starts in 2016 and is
# published after the postseason ends. Earlier seasons get a null rather than a
# wrong number.
ROUTES_FLOOR = 100


def _routes(season: int, plays: pl.DataFrame) -> pl.DataFrame:
    """Routes run per player, from who was on the field for each dropback.

    This is the standard public approximation, not PFF's charted figure: it
    counts dropback snaps played, so a back who stayed in to block and a tight
    end who chipped both count as having run a route. For receivers the two are
    close; for backs and tight ends this reads a little low per route. The
    alternative — dividing by targets — is a different statistic that already
    exists on the card as yards per target.
    """
    empty = pl.DataFrame(schema={"player_id": pl.String, "routes": pl.UInt32})
    part = nv.participation(season)
    if part.height == 0:
        return empty

    part = part.select(
        pl.col("nflverse_game_id").alias("game_id"),
        pl.col("play_id").cast(pl.Float64),
        "offense_players",
    )
    # Regular season only. The season line this divides into comes from
    # `player_stats(season, "reg")`, so counting January routes against
    # September-to-December yards would quietly penalize every team that went
    # deep — Smith-Njigba's 2025 read 572 routes against a 485-route numerator.
    dropbacks = plays.filter(
        (pl.col("qb_dropback") == 1) & (pl.col("season_type") == "REG")
    ).select("game_id", pl.col("play_id").cast(pl.Float64))
    matched = dropbacks.join(part, on=["game_id", "play_id"], how="inner")
    if matched.height == 0:
        log(f"! participation {season} did not join to play-by-play; no routes")
        return empty

    return (
        matched.filter(
            pl.col("offense_players").is_not_null()
            & (pl.col("offense_players").str.len_chars() > 0)
        )
        .with_columns(pl.col("offense_players").str.split(";"))
        .explode("offense_players")
        .filter(pl.col("offense_players").str.len_chars() > 0)
        .group_by("offense_players")
        .len()
        .rename({"offense_players": "player_id", "len": "routes"})
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
                .join(_pfr_defense(season), on="pfr_id", how="left")
                .join(_routes(season, plays), on="player_id", how="left")
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
                # Ratios the card used to compute at render. Stored so they can
                # be ranked like any other column — a completion rate with no
                # percentile beside it is the one row on the card that reads as
                # a bare number.
                pl.when(pl.col("attempts") > 0)
                .then(pl.col("completions") / pl.col("attempts"))
                .otherwise(None)
                .alias("completion_pct"),
                pl.when(pl.col("attempts") > 0)
                .then(pl.col("passing_yards") / pl.col("attempts"))
                .otherwise(None)
                .alias("yards_per_attempt"),
                pl.when(pl.col("targets") > 0)
                .then(pl.col("receptions") / pl.col("targets"))
                .otherwise(None)
                .alias("catch_pct"),
                pl.when(pl.col("receptions") > 0)
                .then(pl.col("receiving_yards") / pl.col("receptions"))
                .otherwise(None)
                .alias("yards_per_rec"),
                pl.coalesce(pl.col("play_success"), pl.col("rush_success"), pl.col("rec_success"))
                .alias("play_success"),
                (pl.col("passing_epa").fill_null(0)
                 + pl.col("rushing_epa").fill_null(0)
                 + pl.col("receiving_epa").fill_null(0)).alias("total_epa"),
            )

            # Yards and targets per route run. Restricted to the positions that
            # run routes: everyone on the field for a dropback picks up a route
            # in the raw count, so a tackle would otherwise post a 0.00 YPRR and
            # a quarterback would divide his own passing line by his dropbacks.
            # The floor keeps a receiver with nine routes off the leaderboards.
            runs_routes = pl.col("position").is_in(["WR", "TE", "RB", "FB"])
            enough = runs_routes & (pl.col("routes") >= ROUTES_FLOOR)
            df = df.with_columns(
                pl.when(runs_routes).then(pl.col("routes")).otherwise(None).alias("routes"),
                pl.when(enough)
                .then(pl.col("receiving_yards") / pl.col("routes"))
                .otherwise(None)
                .alias("yprr"),
                pl.when(enough)
                .then(pl.col("targets") / pl.col("routes"))
                .otherwise(None)
                .alias("tprr"),
            )
            frames.append(df)

        out = pl.concat(frames, how="diagonal")
        out = _add_percentiles(out)
        out = round_cols(out, 4)
        write_parquet(out, "player_season")
        return out


# ------------------------------------------------------------ career EPA

# A snap the player was the one credited on: a dropback, a carry, or a target.
# Special teams and blocking are absent by construction, which is the honest
# limit of expected points added as a career currency — see `/glossary`.
EPA_PLAYS = ["dropbacks", "rush_plays", "target_plays"]


def build_career_epa(seasons: pl.DataFrame) -> pl.DataFrame:
    """Career expected points added, summed over the regular-season lines.

    EPA replaced WAR as the site's headline figure, and WAR shipped a career
    table while EPA only existed per season. Summing seasons is the whole of
    it — EPA is additive in a way a rate stat is not, so there is nothing to
    fit here, and the career figure means exactly what the season figure means
    with a wider window.
    """
    with step("career EPA"):
        plays = sum(
            (pl.col(c).fill_null(0) for c in EPA_PLAYS if c in seasons.columns),
            pl.lit(0),
        )
        d = seasons.filter(pl.col("season_type") == "REG").with_columns(
            plays.alias("epa_plays"),
            pl.col("total_epa").fill_null(0.0).alias("epa"),
        )
        best = (
            d.sort("epa", descending=True)
            .group_by("player_id")
            .agg(
                pl.col("epa").first().alias("best_season_epa"),
                pl.col("season").first().alias("best_season"),
            )
        )
        out = (
            d.group_by("player_id")
            .agg(
                pl.col("epa").sum().alias("career_epa"),
                pl.col("epa_plays").sum().alias("career_plays"),
                pl.col("season").n_unique().alias("seasons"),
                pl.col("season").min().alias("first_season"),
                pl.col("season").max().alias("last_season"),
                pl.col("passing_epa").fill_null(0.0).sum().alias("epa_passing"),
                pl.col("rushing_epa").fill_null(0.0).sum().alias("epa_rushing"),
                pl.col("receiving_epa").fill_null(0.0).sum().alias("epa_receiving"),
            )
            .join(best, on="player_id", how="left")
            .with_columns(
                (pl.col("career_epa") / pl.col("seasons")).alias("epa_per_season")
            )
        )
        out = round_cols(out, 4)
        write_parquet(out, "epa_career")
        log(f"  {out.height} players")
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
