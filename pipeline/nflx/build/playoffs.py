"""Playoff seeding and odds.

Completed seasons get exact seeding from the tiebreaker tree. The scheduled
season gets Monte Carlo odds: play the remaining games from team ratings, seed
each simulated season the same way, and count.
"""

from __future__ import annotations

import polars as pl

from ..models import preview as pv
from ..models import simulate as sim
from ..models import tiebreakers as tb
from ..util import log, round_cols, step, write_parquet

SIMULATIONS = 10000


def team_map(teams: pl.DataFrame) -> dict[str, tuple[str, str]]:
    return {r["team"]: (r["conf"], r["division"]) for r in teams.iter_rows(named=True)}


def records_for(games: pl.DataFrame, season: int, teams: dict[str, tuple[str, str]]):
    reg = games.filter(
        (pl.col("season") == season) & (pl.col("game_type") == "REG") & pl.col("played")
    )
    if reg.height == 0:
        return None
    rows = reg.select("home_team", "away_team", "home_score", "away_score").to_dicts()
    return tb.build_records(rows, teams)


def build(seasons: list[int], games: pl.DataFrame, teams_df: pl.DataFrame,
          team_season: pl.DataFrame, upcoming: int) -> pl.DataFrame:
    with step("playoff seeding and odds"):
        teams = team_map(teams_df)

        # ---------------------------------------------------- exact seeding
        seed_rows = []
        for season in seasons:
            records = records_for(games, season, teams)
            if records is None:
                continue
            winners = set(tb.division_winners(records).values())
            for conf in ("AFC", "NFC"):
                for rank, team in enumerate(tb.seed_conference(conf, records), start=1):
                    seed_rows.append({
                        "season": season, "conf": conf, "team": team, "seed": rank,
                        "division_winner": team in winners,
                        "in_playoffs": rank <= 7,
                    })
        seeds = pl.DataFrame(seed_rows)
        write_parquet(seeds, "playoff_seeds")

        # ---------------------------------------------------- odds
        slope, hfa, sd = sim.fit_margin_model(games, team_season)
        margin_model = pv.fit(games, team_season)
        latest = max(seasons)
        ratings = {
            r["team"]: r["net_adj"]
            for r in team_season.filter(pl.col("season") == latest).iter_rows(named=True)
        }

        odds_frames = []
        for season in sorted({latest, upcoming}):
            has_games = games.filter(
                (pl.col("season") == season) & (pl.col("game_type") == "REG")
            ).height > 0
            if not has_games:
                continue
            # A season still to be played is rated the way the game previews
            # rate it — last year regressed toward the mean, current form
            # taking over as it accumulates. Using last season's rating at full
            # strength puts clubs at 99% and 0% before anyone has kicked off.
            played = games.filter(
                (pl.col("season") == season) & (pl.col("game_type") == "REG") & pl.col("played")
            ).height
            total = games.filter(
                (pl.col("season") == season) & (pl.col("game_type") == "REG")
            ).height
            if played < total:
                preseason = pv.preseason_ratings(games, team_season, margin_model, season)
                out = sim.simulate(
                    season, games, preseason, teams,
                    1.0, margin_model.home_field, margin_model.sd, n_sims=SIMULATIONS,
                )
            else:
                out = sim.simulate(
                    season, games, ratings, teams, slope, hfa, sd, n_sims=SIMULATIONS
                )
            odds_frames.append(out)
            done = games.filter(
                (pl.col("season") == season) & (pl.col("game_type") == "REG") & pl.col("played")
            ).height
            log(f"{season}: {SIMULATIONS:,} simulations · {done} games already played")

        odds = round_cols(pl.concat(odds_frames), 4) if odds_frames else pl.DataFrame()
        if odds.height:
            write_parquet(odds, "playoff_odds")
        return seeds
