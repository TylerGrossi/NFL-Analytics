"""Season simulation: play out what is left, seed it, count how often.

Games are simulated from a margin model fit on real results — expected margin
from the difference in opponent-adjusted rating plus home field, with the
residual spread measured rather than assumed. Every simulated season is then
seeded through the real tiebreaker tree, so a club that wins a division on
head-to-head in the simulation wins it for the same reason it would in January.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from ..util import log
from . import tiebreakers as tb


def fit_margin_model(games: pl.DataFrame, ratings: pl.DataFrame) -> tuple[float, float, float]:
    """Returns (points per unit of rating difference, home field, residual sd)."""
    played = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    r = ratings.select("season", "team", "net_adj")

    df = (
        played.select("season", "home_team", "away_team", "home_score", "away_score")
        .join(r.rename({"team": "home_team", "net_adj": "home_rating"}),
              on=["season", "home_team"], how="inner")
        .join(r.rename({"team": "away_team", "net_adj": "away_rating"}),
              on=["season", "away_team"], how="inner")
        .with_columns(
            (pl.col("home_score") - pl.col("away_score")).alias("margin"),
            (pl.col("home_rating") - pl.col("away_rating")).alias("gap"),
        )
    )
    slope, intercept = np.polyfit(df["gap"].to_numpy(), df["margin"].to_numpy(), 1)
    residual = df["margin"].to_numpy() - (slope * df["gap"].to_numpy() + intercept)
    sd = float(np.std(residual))
    log(f"margin model — {slope:.1f} points per rating unit · "
        f"home field {intercept:+.2f} · residual sd {sd:.1f} ({df.height:,} games)")
    return float(slope), float(intercept), sd


def simulate(
    season: int,
    games: pl.DataFrame,
    ratings: dict[str, float],
    teams: dict[str, tuple[str, str]],
    slope: float,
    home_field: float,
    sd: float,
    n_sims: int = 5000,
    seed: int = 17,
) -> pl.DataFrame:
    """Play the remaining schedule n_sims times and seed every outcome."""
    rng = np.random.default_rng(seed)
    schedule = games.filter((pl.col("season") == season) & (pl.col("game_type") == "REG"))

    played = schedule.filter(pl.col("played")).select(
        "home_team", "away_team", "home_score", "away_score"
    ).to_dicts()
    upcoming = schedule.filter(~pl.col("played")).select("home_team", "away_team").to_dicts()

    gaps = np.array([
        ratings.get(g["home_team"], 0.0) - ratings.get(g["away_team"], 0.0) for g in upcoming
    ])
    expected = slope * gaps + home_field

    # One draw per game per simulation, all at once.
    draws = rng.normal(loc=expected, scale=sd, size=(n_sims, len(upcoming))) if upcoming else None

    counts = {t: {"playoffs": 0, "division": 0, "top_seed": 0, "wins": 0.0, "seeds": [0] * 8}
              for t in teams}

    for s in range(n_sims):
        simulated = list(played)
        if draws is not None:
            for i, g in enumerate(upcoming):
                margin = draws[s, i]
                # A tie needs an exact zero, which a continuous draw never gives;
                # nudge the rare near-zero into one so ties can happen at all.
                if abs(margin) < 0.35:
                    hs = as_ = 20
                else:
                    hs, as_ = (24, 17) if margin > 0 else (17, 24)
                simulated.append({
                    "home_team": g["home_team"], "away_team": g["away_team"],
                    "home_score": hs, "away_score": as_,
                })

        records = tb.build_records(simulated, teams)
        winners = set(tb.division_winners(records).values())

        for conf in ("AFC", "NFC"):
            seeds = tb.seed_conference(conf, records)
            for rank, team in enumerate(seeds[:7], start=1):
                counts[team]["playoffs"] += 1
                counts[team]["seeds"][rank] += 1
                if rank == 1:
                    counts[team]["top_seed"] += 1
        for team in winners:
            counts[team]["division"] += 1
        for team, rec in records.items():
            counts[team]["wins"] += rec.wins + 0.5 * rec.ties

    rows = []
    for team, c in counts.items():
        rows.append({
            "season": season,
            "team": team,
            "conf": teams[team][0],
            "division": teams[team][1],
            "sims": n_sims,
            "expected_wins": c["wins"] / n_sims,
            "playoff_odds": c["playoffs"] / n_sims,
            "division_odds": c["division"] / n_sims,
            "top_seed_odds": c["top_seed"] / n_sims,
            **{f"seed_{i}_odds": c["seeds"][i] / n_sims for i in range(1, 8)},
        })
    return pl.DataFrame(rows).sort(["conf", "playoff_odds"], descending=[False, True])
