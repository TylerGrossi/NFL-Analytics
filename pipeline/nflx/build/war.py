"""Build WAR per player-season, with published backtests.

Intervals were removed deliberately. A bootstrap band on a number this
contested invites the reader to treat the midpoint as precise and the band as
the whole uncertainty, when the real uncertainty is in the attribution model
rather than in resampling games. One number, and the backtests underneath it.
"""

from __future__ import annotations

import numpy as np
import polars as pl

import nflreadpy as nfl

from ..config import roles_available
from ..models import war as war_model
from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_json, write_parquet
from .pbp import scrimmage


# The first season in which every WAR role has a source behind it.
FULL_COVERAGE_SEASON = 2020

# Defence is fit alongside the offensive roles; the label map covers both.
ALL_ROLE_LABELS = {
    **war_model.ROLE_LABEL,
    "def": "defense",
    "line": "line",
    "kick": "kicking",
    "punt": "punting",
    "return": "returns",
}


_FG_MODEL_CACHE: dict[str, object] = {}


def _fg_probability(seasons: list[int]):
    """The fourth-down field goal model, reused so a make is priced the same way."""
    if "fn" not in _FG_MODEL_CACHE:
        try:
            from ..models import fourth_down as fd

            frames = [nv.pbp(s) for s in seasons]
            wp_stub = None  # the FG fit needs no win probability model
            model = fd._fit_field_goal(frames)

            def probability(yardline_100):
                distance = np.asarray(yardline_100, dtype=float) + 17.0
                p = model.predict_proba(distance.reshape(-1, 1))[:, 1]
                return np.where(distance > fd.MAX_FG_DISTANCE, np.nan, p)

            _FG_MODEL_CACHE["fn"] = probability
        except Exception as exc:
            log(f"! field goal model unavailable for special teams: {exc}")
            _FG_MODEL_CACHE["fn"] = None
    return _FG_MODEL_CACHE["fn"]


def _epa_per_line_yard(plays: pl.DataFrame) -> float:
    """How much a yard of run blocking is worth, fit on actual runs."""
    runs = plays.filter((pl.col("play_type") == "run") & pl.col("epa").is_not_null())
    slope, _ = np.polyfit(
        runs["yards_gained"].to_numpy().astype(float), runs["epa"].to_numpy(), 1
    )
    return float(slope)


def _line_snaps(seasons: list[int], index: pl.DataFrame) -> pl.DataFrame | None:
    """Offensive snaps for linemen, keyed to our player ids."""
    frames = []
    for season in seasons:
        try:
            sc = nv.snap_counts(season)
        except Exception:
            continue
        if sc.height == 0:
            continue
        frames.append(
            sc.filter(pl.col("game_type") == "REG")
            .group_by(["pfr_player_id", "team", "position"])
            .agg(pl.col("offense_snaps").sum().alias("off_snaps"))
            .with_columns(pl.lit(season).cast(pl.Int32).alias("season"))
            .rename({"pfr_player_id": "pfr_id"})
        )
    if not frames:
        return None
    snaps = pl.concat(frames, how="diagonal")
    return (
        snaps.join(index.select("player_id", "pfr_id").drop_nulls(), on="pfr_id", how="inner")
        .filter(pl.col("off_snaps") > 0)
        .unique(subset=["player_id", "season"], keep="first")
    )


def _pressure_plays(season: int, plays: pl.DataFrame) -> pl.DataFrame | None:
    """Play-level pressure flags, used only to price what a pressure is worth."""
    try:
        part = nfl.load_participation(season)
    except Exception:
        return None
    if part.height == 0:
        return None
    part = part.select(
        pl.col("nflverse_game_id").alias("game_id"),
        pl.col("play_id").cast(pl.Float64),
        "was_pressure",
    )
    return plays.join(part, on=["game_id", "play_id"], how="inner")


def _defense_inputs(season: int, index: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame] | None:
    """PFR per-player defensive charting joined to our player ids, plus snaps."""
    try:
        charting = nfl.load_pfr_advstats(season, stat_type="def", summary_level="season")
    except Exception as exc:
        log(f"! PFR defensive charting {season} unavailable: {exc}")
        return None
    if charting.height == 0:
        return None

    charting = charting.select(
        "pfr_id", pl.col("tm").alias("team"), "pos", "g",
        pl.col("tgt").cast(pl.Float64), pl.col("cmp").cast(pl.Float64),
        pl.col("yds").cast(pl.Float64), pl.col("sk").cast(pl.Float64),
        pl.col("prss").cast(pl.Float64), pl.col("m_tkl").cast(pl.Float64),
    ).join(
        index.select("player_id", "pfr_id").drop_nulls(), on="pfr_id", how="inner"
    ).unique(subset=["player_id"], keep="first")

    snaps = (
        nv.snap_counts(season)
        .filter(pl.col("game_type") == "REG")
        .group_by("pfr_player_id")
        .agg(pl.col("defense_snaps").sum().alias("def_snaps"))
        .rename({"pfr_player_id": "pfr_id"})
    )
    return charting, snaps


def _all_plays(season: int) -> pl.DataFrame:
    """Every play including kicks and punts — special teams live outside scrimmage."""
    return nv.pbp(season).filter(pl.col("season_type") == "REG")


def _season_plays(season: int) -> pl.DataFrame:
    df = scrimmage(nv.pbp(season)).filter(pl.col("season_type") == "REG")
    return df.select(
        "game_id", "season", "week", "posteam", "defteam", "play_type",
        "play_id", "epa", "qb_epa", "yac_epa", "air_epa", "qb_dropback", "complete_pass",
        "yards_gained", "sack",
        # Situation, so a player is judged against the spots he was actually
        # given rather than against the league at large.
        "down", "ydstogo", "yardline_100", "air_yards", "qb_scramble",
        "passer_player_id", "rusher_player_id", "receiver_player_id",
    ).drop_nulls(subset=["epa", "posteam", "defteam"])


def build(seasons: list[int], games: pl.DataFrame, index: pl.DataFrame,
          line_team: pl.DataFrame | None = None) -> pl.DataFrame:
    with step("WAR"):
        ppw = war_model.points_per_win(games)
        rows: list[dict] = []
        positions = {
            r["player_id"]: (r["pos_group"] or "OTHER")
            for r in index.select("player_id", "pos_group").iter_rows(named=True)
        }

        for season in seasons:
            plays = _season_plays(season)
            log(f"— {season}")

            available = roles_available(season)
            fits = {
                role: war_model.fit_role(plays, role)
                for role in war_model.ROLES
                if role in available
            }
            if len(fits) < len(war_model.ROLES):
                skipped = sorted(set(war_model.ROLES) - set(fits))
                log(f"  {season}: no source yet for {', '.join(skipped)}")
            alphas = {role: fit.alpha for role, fit in fits.items()}


            for role, fit in fits.items():
                for player_id, value in war_model.war_from_fit(fit, ppw).items():
                    rows.append({
                        "player_id": player_id,
                        "season": season,
                        "role": role,
                        "plays": value["plays"],
                        "value_per_play": value["value_per_play"],
                        "above_replacement_per_play": value["above_replacement_per_play"],
                        "war": value["war"],
                        "team": value["team"],
                        "coverage_points": None,
                        "rush_points": None,
                    })

            # Defenders are valued from their own charted production; plus-minus
            # cannot identify them because starters never leave the field.
            inputs = _defense_inputs(season, index) if "def" in available else None
            if inputs is not None:
                charting, snap_counts = inputs
                constants = war_model.measure_constants(plays, _pressure_plays(season, plays))
                defense = war_model.defensive_value(
                    charting, snap_counts, constants, positions, ppw
                )
                for r in defense.iter_rows(named=True):
                    rows.append({
                        "player_id": r["player_id"],
                        "season": season,
                        "role": "def",
                        "plays": int(r["def_snaps"]),
                        "value_per_play": r["points_per_snap"],
                        "above_replacement_per_play": None,
                        "war": r["war"],
                        "team": r["team"],
                        "coverage_points": r["coverage_points"],
                        "rush_points": r["rush_points"],
                    })

            # ------------------------------------------------ special teams
            st_plays = _all_plays(season)
            fg_model = _fg_probability(seasons)
            if fg_model is not None:
                st = war_model.special_teams_value(st_plays, fg_model, ppw)
                for r in st.iter_rows(named=True):
                    rows.append({
                        "player_id": r["player_id"],
                        "season": season,
                        "role": r["role"],
                        "plays": int(r["plays"]),
                        "value_per_play": r["points_per_play"],
                        "above_replacement_per_play": None,
                        "war": r["war"],
                        "team": r["team"],
                        "coverage_points": None,
                        "rush_points": None,
                    })

        # ---------------------------------------------------- offensive line
        if line_team is not None and line_team.height:
            ol_snaps = _line_snaps(seasons, index)
            if ol_snaps is not None and ol_snaps.height:
                base_plays = _season_plays(max(seasons))
                constants = war_model.measure_constants(
                    base_plays, _pressure_plays(max(seasons), base_plays)
                )
                epa_per_line_yard = _epa_per_line_yard(base_plays)
                ol = war_model.offensive_line_value(
                    line_team, ol_snaps, constants, ppw, epa_per_line_yard
                )
                for r in ol.iter_rows(named=True):
                    rows.append({
                        "player_id": r["player_id"],
                        "season": r["season"],
                        "role": "line",
                        "plays": int(r["off_snaps"]),
                        "value_per_play": r["points_per_snap"],
                        "above_replacement_per_play": None,
                        "war": r["war"],
                        "team": r["team"],
                        "coverage_points": None,
                        "rush_points": None,
                    })

        long = pl.DataFrame(rows, infer_schema_length=None).with_columns(
            # Points above replacement is what the model actually computes; WAR
            # is that divided by the cost of a win. Publishing both keeps the
            # conversion visible instead of baked in.
            (pl.col("war") * ppw).alias("par")
        )

        totals = (
            long.group_by(["player_id", "season"])
            .agg(
                pl.col("war").sum().alias("war"),
                pl.col("par").sum().alias("par"),
                pl.col("coverage_points").sum().alias("par_coverage"),
                pl.col("rush_points").sum().alias("par_rush"),
                pl.col("plays").sum().alias("plays"),
                pl.col("team").drop_nulls().first().alias("team"),
                *[
                    pl.col("war").filter(pl.col("role") == role).sum()
                    .alias(f"war_{label}")
                    for role, label in ALL_ROLE_LABELS.items()
                ],
                *[
                    pl.col("plays").filter(pl.col("role") == role).sum()
                    .alias(f"plays_{label}")
                    for role, label in ALL_ROLE_LABELS.items()
                ],
            )
            .join(
                index.select("player_id", "name", "position", "pos_group", "headshot"),
                on="player_id", how="left",
            )
            .sort(["season", "war"], descending=[False, True])
        )

        write_parquet(round_cols(totals, 4), "war_season")

        # Career totals: with 27 seasons loaded these become a real leaderboard
        # rather than a six-year window.
        career = (
            totals.group_by("player_id")
            .agg(
                pl.col("war").sum().alias("career_war"),
                pl.col("par").sum().alias("career_par"),
                pl.col("plays").sum().alias("career_plays"),
                pl.len().alias("seasons"),
                pl.col("season").min().alias("first_season"),
                pl.col("season").max().alias("last_season"),
                pl.col("war").max().alias("best_season_war"),
                pl.col("season").sort_by("war", descending=True).first().alias("best_season"),
                pl.col("name").drop_nulls().first().alias("name"),
                pl.col("position").drop_nulls().first().alias("position"),
                pl.col("team").drop_nulls().last().alias("team"),
                pl.col("headshot").drop_nulls().first().alias("headshot"),
                *[
                    pl.col(f"war_{label}").sum().alias(f"war_{label}")
                    for label in ALL_ROLE_LABELS.values()
                ],
            )
            .with_columns(
                (pl.col("career_war") / pl.col("seasons")).alias("war_per_season")
            )
            .sort("career_war", descending=True)
        )
        write_parquet(round_cols(career, 4), "war_career")
        top_career = career.head(3)
        log("career leaders: " + ", ".join(
            f"{r['name']} {r['career_war']:.1f}" for r in top_career.iter_rows(named=True)
        ))
        write_parquet(round_cols(long, 4), "war_role")
        _validate(totals, long, games, ppw)
        return totals


def _validate(totals: pl.DataFrame, long: pl.DataFrame, games: pl.DataFrame, ppw: float) -> None:
    """The backtests that decide whether this metric is publishable."""
    report: dict[str, object] = {"points_per_win": round(ppw, 2)}
    report["par_note"] = "PAR is points above replacement; WAR = PAR / points_per_win"

    # Stability: does a passer's WAR carry into the next season?
    qb = long.filter((pl.col("role") == "pass") & (pl.col("plays") >= 200))
    pairs = qb.join(
        qb.select("player_id", (pl.col("season") - 1).alias("season"),
                  pl.col("war").alias("next_war")),
        on=["player_id", "season"], how="inner",
    )
    if pairs.height > 10:
        report["qb_year_over_year_r"] = round(
            float(np.corrcoef(pairs["war"].to_numpy(), pairs["next_war"].to_numpy())[0, 1]), 3
        )
        report["qb_year_over_year_n"] = pairs.height

    # WAR multiplies a rate by playing time, so it should be compared to other
    # volume stats, not to rate stats. Passing yards is the fair benchmark.
    benchmarks = _rate_benchmarks()
    if benchmarks:
        report["stability_benchmarks"] = benchmarks

    # Does a roster's summed WAR track the games the team actually won?
    wins = _team_wins(games)
    team_war = (
        totals.filter(pl.col("team").is_not_null())
        .group_by(["season", "team"])
        .agg(pl.col("war").sum().alias("team_war"))
    )
    merged = team_war.join(wins, on=["season", "team"], how="inner")
    if merged.height > 10:
        report["team_war_vs_wins_r"] = round(
            float(np.corrcoef(merged["team_war"].to_numpy(), merged["wins"].to_numpy())[0, 1]), 3
        )
        report["team_seasons"] = merged.height

    # The blended figure understates the model badly once deep history is
    # loaded: before 2006 there is no receiver value, before 2018 no defensive
    # value, before 2012 no line. Those seasons are missing most of a roster, so
    # the era where every role exists is reported separately.
    full = merged.filter(pl.col("season") >= FULL_COVERAGE_SEASON)
    if full.height > 10:
        report["team_war_vs_wins_r_full_coverage"] = round(
            float(np.corrcoef(full["team_war"].to_numpy(), full["wins"].to_numpy())[0, 1]), 3
        )
        report["full_coverage_from"] = FULL_COVERAGE_SEASON
        report["full_coverage_team_seasons"] = full.height

    # Among players with a real sample: including one-snap players would report
    # a near-zero median interval and overstate how precise the metric is.
    # The honest ceiling: even point differential, which already knows every
    # score, cannot predict single-season wins exactly. No metric beats this.
    pyth = _pythagorean(games)
    merged_pyth = team_war.join(pyth, on=["season", "team"], how="inner")
    if merged_pyth.height > 10:
        report["team_war_vs_pythagorean_r"] = round(
            float(np.corrcoef(merged_pyth["team_war"].to_numpy(),
                              merged_pyth["pyth_w"].to_numpy())[0, 1]), 3
        )
    full_pyth = merged_pyth.filter(pl.col("season") >= FULL_COVERAGE_SEASON)
    if full_pyth.height > 10:
        report["team_war_vs_pythagorean_r_full_coverage"] = round(
            float(np.corrcoef(full_pyth["team_war"].to_numpy(),
                              full_pyth["pyth_w"].to_numpy())[0, 1]), 3
        )

    ceiling = pyth.join(wins, on=["season", "team"], how="inner")
    if ceiling.height > 10:
        report["pythagorean_vs_wins_r"] = round(
            float(np.corrcoef(ceiling["pyth_w"].to_numpy(),
                              ceiling["wins"].to_numpy())[0, 1]), 3
        )

    leaders = totals.sort("war", descending=True).head(5)
    report["top_seasons"] = [
        f"{r['name']} {r['season']} {r['position']} {r['war']:.1f}"
        for r in leaders.iter_rows(named=True)
    ]
    by_pos = (
        totals.filter(pl.col("position").is_not_null())
        .group_by("position").agg(pl.col("war").mean().round(3).alias("mean_war"), pl.len())
        .sort("len", descending=True).head(6)
    )
    report["mean_war_by_position"] = {r["position"]: r["mean_war"] for r in by_pos.iter_rows(named=True)}

    for key, value in report.items():
        log(f"{key}: {value}")
    write_json(report, "war_validation")


def _pythagorean(games: pl.DataFrame, exponent: float = 2.37) -> pl.DataFrame:
    played = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    rows = pl.concat([
        played.select("season", pl.col("home_team").alias("team"),
                      pl.col("home_score").alias("pf"), pl.col("away_score").alias("pa")),
        played.select("season", pl.col("away_team").alias("team"),
                      pl.col("away_score").alias("pf"), pl.col("home_score").alias("pa")),
    ])
    return (
        rows.group_by(["season", "team"])
        .agg(pl.col("pf").sum().alias("pf"), pl.col("pa").sum().alias("pa"), pl.len().alias("g"))
        .with_columns(
            (
                pl.col("pf").cast(pl.Float64).pow(exponent)
                / (pl.col("pf").cast(pl.Float64).pow(exponent)
                   + pl.col("pa").cast(pl.Float64).pow(exponent))
                * pl.col("g")
            ).alias("pyth_w")
        )
        .select("season", "team", "pyth_w")
    )


def _rate_benchmarks() -> dict[str, float]:
    """Year-over-year stability of familiar quarterback stats, for context."""
    from ..config import PARQUET

    path = PARQUET / "player_season.parquet"
    if not path.exists():
        return {}
    ps = pl.read_parquet(path).filter(
        (pl.col("position") == "QB") & (pl.col("dropbacks") >= 200)
    )
    out: dict[str, float] = {}
    for column, label in (
        ("epa_per_db", "epa_per_dropback"),
        ("cpoe", "cpoe"),
        ("passing_yards", "passing_yards"),
    ):
        if column not in ps.columns:
            continue
        pairs = ps.select("player_id", "season", column).join(
            ps.select("player_id", (pl.col("season") - 1).alias("season"),
                      pl.col(column).alias("next")),
            on=["player_id", "season"], how="inner",
        ).drop_nulls([column, "next"])
        if pairs.height > 20:
            out[label] = round(
                float(np.corrcoef(pairs[column].to_numpy(), pairs["next"].to_numpy())[0, 1]), 3
            )
    return out


def _team_wins(games: pl.DataFrame) -> pl.DataFrame:
    played = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    return (
        pl.concat([
            played.select("season", pl.col("home_team").alias("team"),
                          (pl.col("home_score") > pl.col("away_score")).cast(pl.Float64).alias("win")),
            played.select("season", pl.col("away_team").alias("team"),
                          (pl.col("away_score") > pl.col("home_score")).cast(pl.Float64).alias("win")),
        ])
        .group_by(["season", "team"]).agg(pl.col("win").sum().alias("wins"))
    )
