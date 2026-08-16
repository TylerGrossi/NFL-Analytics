"""Pre-game projection: margin, win probability and a projected score.

A team that has not played yet still has to be rated, so the projection blends
two sources. Last season's opponent-adjusted rating carries over — measured at
0.47 for net rating, and notably weaker for defence (0.34) than offence (0.49),
which is the long-standing finding that defensive performance is the less
repeatable half. Season-to-date scoring margin then takes over as games
accumulate, weighted n / (n + k).

Every coefficient here is fit against real results at build time rather than
assumed: k, the points per unit of carried rating, the weight on current form,
home field, and the residual spread that turns a margin into a probability.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import polars as pl
from scipy.special import ndtr

from ..util import log

# Games of the current season before in-season form outweighs the carried
# rating. Fit over 1999-2025: error is flat from 6 to 12, minimised at 8.
BLEND_K = 8.0


@dataclass
class MarginModel:
    """Everything needed to turn two team ratings into a projected game."""

    carry_coef: float      # points per unit of prior-season adjusted EPA gap
    form_coef: float       # points per point of season-to-date margin gap
    home_field: float
    sd: float              # residual spread of actual margin around projection
    total_base: float      # league average game total
    total_coef: float      # points added per unit of combined offensive edge
    total_sd: float


def _form_table(played: pl.DataFrame) -> pl.DataFrame:
    """Season-to-date scoring margin per game, per team, entering each week."""
    home = played.select(
        "season", "week", pl.col("home_team").alias("team"),
        (pl.col("home_score") - pl.col("away_score")).alias("m"),
        (pl.col("home_score") + pl.col("away_score")).alias("t"),
    )
    away = played.select(
        "season", "week", pl.col("away_team").alias("team"),
        (pl.col("away_score") - pl.col("home_score")).alias("m"),
        (pl.col("home_score") + pl.col("away_score")).alias("t"),
    )
    both = pl.concat([home, away]).sort(["season", "team", "week"])
    # Cumulative through the *previous* week: a projection cannot see its own game.
    return both.with_columns(
        pl.col("m").cum_sum().shift(1).over(["season", "team"]).alias("form_sum"),
        pl.col("t").cum_sum().shift(1).over(["season", "team"]).alias("total_sum"),
        pl.int_range(pl.len()).over(["season", "team"]).cast(pl.Float64).alias("n"),
    ).with_columns(
        (pl.col("form_sum") / pl.col("n")).fill_nan(0.0).fill_null(0.0).alias("form"),
        (pl.col("total_sum") / pl.col("n")).fill_nan(0.0).fill_null(0.0).alias("scored"),
    ).select("season", "week", "team", "form", "scored", "n")


def _carry(team_season: pl.DataFrame) -> pl.DataFrame:
    """Prior-season ratings, keyed to the season they are used to predict."""
    return team_season.select(
        (pl.col("season") + 1).alias("season"),
        "team",
        pl.col("net_adj").alias("carry"),
        pl.col("off_adj").alias("carry_off"),
        pl.col("def_adj").alias("carry_def"),
    )


def _assemble(games: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    """Join every game to both sides' carried rating and season-to-date form."""
    reg = games.filter(pl.col("game_type") == "REG")
    played = reg.filter(pl.col("played"))
    form = _form_table(played)
    carry = _carry(team_season)

    out = reg
    for side in ("home", "away"):
        out = out.join(
            carry.rename({
                "team": f"{side}_team", "carry": f"{side}_carry",
                "carry_off": f"{side}_carry_off", "carry_def": f"{side}_carry_def",
            }),
            on=["season", f"{side}_team"], how="left",
        ).join(
            form.rename({
                "team": f"{side}_team", "form": f"{side}_form",
                "scored": f"{side}_scored", "n": f"{side}_n",
            }),
            on=["season", "week", f"{side}_team"], how="left",
        )

    # Week 1 has no form row to join, and an expansion-era club may lack a carry.
    return out.with_columns(
        *[pl.col(c).fill_null(0.0) for c in
          ("home_form", "away_form", "home_n", "away_n",
           "home_carry", "away_carry", "home_carry_off", "away_carry_off",
           "home_carry_def", "away_carry_def")],
        pl.col("home_scored").fill_null(21.5), pl.col("away_scored").fill_null(21.5),
    )


def fit(games: pl.DataFrame, team_season: pl.DataFrame) -> MarginModel:
    """Fit the projection against every completed regular season game."""
    d = _assemble(games, team_season).filter(pl.col("played"))

    n = np.minimum(d["home_n"].to_numpy(), d["away_n"].to_numpy())
    w = n / (n + BLEND_K)
    carry_gap = (d["home_carry"] - d["away_carry"]).to_numpy()
    form_gap = (d["home_form"] - d["away_form"]).to_numpy()
    margin = (d["home_score"] - d["away_score"]).to_numpy().astype(float)

    X = np.column_stack([(1 - w) * carry_gap, w * form_gap, np.ones_like(margin)])
    beta, *_ = np.linalg.lstsq(X, margin, rcond=None)
    resid = margin - X @ beta
    sd = float(np.std(resid))

    # Totals: combined offence minus combined defence, same blend.
    off_edge = (d["home_carry_off"] + d["away_carry_off"]
                - d["home_carry_def"] - d["away_carry_def"]).to_numpy()
    scored = (d["home_scored"] + d["away_scored"]).to_numpy()
    total = (d["home_score"] + d["away_score"]).to_numpy().astype(float)
    T = np.column_stack([(1 - w) * off_edge, w * (scored - 43.0), np.ones_like(total)])
    tbeta, *_ = np.linalg.lstsq(T, total, rcond=None)
    total_sd = float(np.std(total - T @ tbeta))

    log(f"preview margin model — carry {beta[0]:.1f} pts/EPA · form {beta[1]:.2f} · "
        f"home field {beta[2]:+.2f} · residual sd {sd:.1f} ({d.height:,} games)")
    log(f"preview total model — base {tbeta[2]:.1f} · residual sd {total_sd:.1f}")

    return MarginModel(
        carry_coef=float(beta[0]), form_coef=float(beta[1]), home_field=float(beta[2]),
        sd=sd, total_base=float(tbeta[2]), total_coef=float(tbeta[0]), total_sd=total_sd,
    )


def _normal_cdf(x: np.ndarray) -> np.ndarray:
    return ndtr(x)


def score(d: pl.DataFrame, model: MarginModel) -> pl.DataFrame:
    """Apply a fitted model to an already-assembled frame of games.

    Split out from `project()` so the market backtest can score games that were
    actually played. There must be exactly one implementation of the formula —
    a backtest that scores games differently from the live projection is not a
    backtest of anything.
    """
    if d.height == 0:
        return d

    n = np.minimum(d["home_n"].to_numpy(), d["away_n"].to_numpy())
    w = n / (n + BLEND_K)
    carry_gap = (d["home_carry"] - d["away_carry"]).to_numpy()
    form_gap = (d["home_form"] - d["away_form"]).to_numpy()

    margin = (model.carry_coef * (1 - w) * carry_gap
              + model.form_coef * w * form_gap
              + model.home_field)

    off_edge = (d["home_carry_off"] + d["away_carry_off"]
                - d["home_carry_def"] - d["away_carry_def"]).to_numpy()
    scored = (d["home_scored"] + d["away_scored"]).to_numpy()
    total = (model.total_coef * (1 - w) * off_edge
             + w * (scored - 43.0) + model.total_base)

    home_wp = _normal_cdf(margin / model.sd)

    keep = [c for c in (
        "game_id", "season", "week", "gameday", "gametime", "home_team", "away_team",
        "spread_line", "total_line", "played", "home_score", "away_score",
    ) if c in d.columns]
    return d.select(keep).with_columns(
        pl.Series("proj_margin", margin),
        pl.Series("proj_total", total),
        pl.Series("home_wp", home_wp),
        pl.Series("proj_home_score", (total + margin) / 2.0),
        pl.Series("proj_away_score", (total - margin) / 2.0),
        # How much of the rating is last year vs this year, for the page to show.
        pl.Series("carry_weight", 1 - w),
        pl.Series("games_used", n),
    )


def project(
    games: pl.DataFrame, team_season: pl.DataFrame, model: MarginModel
) -> pl.DataFrame:
    """Project every unplayed regular season game on the schedule."""
    return score(_assemble(games, team_season).filter(~pl.col("played")), model)


def assemble(games: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    """Public handle on the join, for callers that score played games."""
    return _assemble(games, team_season)


def preseason_ratings(
    games: pl.DataFrame, team_season: pl.DataFrame, model: MarginModel, season: int
) -> dict[str, float]:
    """Team strength in points, blended exactly as the game projections blend it.

    The season simulation needs the same numbers the preview pages show, or the
    site contradicts itself: a club cannot be a 62% favourite in every game it
    plays and simultaneously 99% to reach the playoffs. Applying last season's
    rating at full strength to a season nobody has played is what produces that,
    since ratings only carry over at 0.47.

    Returned in points of expected margin, so the caller passes slope 1.0.
    """
    d = _assemble(games, team_season).filter(pl.col("season") == season)
    if d.height == 0:
        return {}

    out: dict[str, float] = {}
    for side in ("home", "away"):
        rows = d.select(
            pl.col(f"{side}_team").alias("team"),
            pl.col(f"{side}_carry").alias("carry"),
            pl.col(f"{side}_form").alias("form"),
            pl.col(f"{side}_n").alias("n"),
        )
        for r in rows.iter_rows(named=True):
            w = r["n"] / (r["n"] + BLEND_K)
            out[r["team"]] = (
                model.carry_coef * (1 - w) * r["carry"] + model.form_coef * w * r["form"]
            )
    return out
