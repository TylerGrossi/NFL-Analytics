"""Standings, Pythagorean expectation and playoff seeding.

Seeding runs the real NFL tiebreaker tree, which reproduces every playoff field
from 2020 through 2025 exactly. The previous approximation — win percentage
with point differential — got four of the fourteen 2025 seeds wrong.
"""

from __future__ import annotations

import polars as pl

from ..config import PYTHAG_EXPONENT
from ..models import tiebreakers as tb
from ..util import round_cols, step, write_parquet


def _team_rows(games: pl.DataFrame) -> pl.DataFrame:
    """One row per team per played game, from each team's own perspective."""
    played = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    home = played.select(
        "season", "week", "game_id",
        pl.col("home_team").alias("team"),
        pl.col("away_team").alias("opp"),
        pl.col("home_score").alias("pf"),
        pl.col("away_score").alias("pa"),
        pl.lit(True).alias("at_home"),
        "div_game",
    )
    away = played.select(
        "season", "week", "game_id",
        pl.col("away_team").alias("team"),
        pl.col("home_team").alias("opp"),
        pl.col("away_score").alias("pf"),
        pl.col("home_score").alias("pa"),
        pl.lit(False).alias("at_home"),
        "div_game",
    )
    return pl.concat([home, away]).with_columns(
        (pl.col("pf") > pl.col("pa")).alias("win"),
        (pl.col("pf") < pl.col("pa")).alias("loss"),
        (pl.col("pf") == pl.col("pa")).alias("tie"),
    )


def _streak(results) -> str:
    """Current W/L run. polars hands list columns to UDFs as a Series."""
    if hasattr(results, "to_list"):
        results = results.to_list()
    results = [r for r in results if r is not None]
    if not results:
        return "—"
    last = results[-1]
    n = 0
    for r in reversed(results):
        if r != last:
            break
        n += 1
    return f"{'W' if last else 'L'}{n}"


def build(games: pl.DataFrame, teams: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    with step("standings"):
        rows = _team_rows(games)
        if rows.height == 0:
            return pl.DataFrame()

        agg = rows.group_by(["season", "team"]).agg(
            pl.len().alias("games"),
            pl.col("win").sum().alias("w"),
            pl.col("loss").sum().alias("l"),
            pl.col("tie").sum().alias("t"),
            pl.col("pf").sum().alias("pf"),
            pl.col("pa").sum().alias("pa"),
            pl.col("win").filter(pl.col("div_game") == 1).sum().alias("div_w"),
            pl.col("loss").filter(pl.col("div_game") == 1).sum().alias("div_l"),
            pl.col("win").filter(pl.col("at_home")).sum().alias("home_w"),
            pl.col("loss").filter(pl.col("at_home")).sum().alias("home_l"),
            pl.col("win").sort_by("week").alias("_results"),
        )

        agg = agg.with_columns(
            ((pl.col("w") + pl.col("t") * 0.5) / pl.col("games")).alias("pct"),
            (pl.col("pf") - pl.col("pa")).alias("diff"),
            (pl.col("pf") / pl.col("games")).alias("ppg"),
            (pl.col("pa") / pl.col("games")).alias("papg"),
            (
                pl.col("pf").cast(pl.Float64).pow(PYTHAG_EXPONENT)
                / (
                    pl.col("pf").cast(pl.Float64).pow(PYTHAG_EXPONENT)
                    + pl.col("pa").cast(pl.Float64).pow(PYTHAG_EXPONENT)
                )
                * pl.col("games")
            ).alias("pyth_w"),
        ).with_columns(
            (pl.col("w") - pl.col("pyth_w")).alias("luck"),
            pl.col("_results")
            .map_elements(_streak, return_dtype=pl.String)
            .alias("streak"),
        ).drop("_results")

        agg = agg.join(
            teams.select("team", "conf", "division", "name", "nick"), on="team", how="left"
        )

        # Conference record needs the opponent's conference.
        conf_map = teams.select("team", "conf")
        conf_rows = (
            rows.join(conf_map, on="team", how="left")
            .join(conf_map.rename({"team": "opp", "conf": "opp_conf"}), on="opp", how="left")
            .filter(pl.col("conf") == pl.col("opp_conf"))
            .group_by(["season", "team"])
            .agg(
                pl.col("win").sum().alias("conf_w"),
                pl.col("loss").sum().alias("conf_l"),
            )
        )
        agg = agg.join(conf_rows, on=["season", "team"], how="left")

        if team_season.height:
            agg = agg.join(
                team_season.select(
                    "season", "team", "off_rank", "def_rank", "net_rank", "net_adj", "sos"
                ),
                on=["season", "team"],
                how="left",
            )

        # Seeding comes from the real tiebreaker tree, which reproduces every
        # playoff field from 2020 on exactly. Sorting by record and point
        # differential got four of the fourteen 2025 seeds wrong.
        team_meta = {
            r["team"]: (r["conf"], r["division"])
            for r in teams.iter_rows(named=True)
        }
        seed_rows = []
        for season in agg["season"].unique().to_list():
            reg = games.filter(
                (pl.col("season") == season)
                & (pl.col("game_type") == "REG")
                & pl.col("played")
            )
            if reg.height == 0:
                continue
            records = tb.build_records(
                reg.select("home_team", "away_team", "home_score", "away_score").to_dicts(),
                team_meta,
            )
            winners = set(tb.division_winners(records).values())
            division_order: dict[str, int] = {}
            for conf in ("AFC", "NFC"):
                for rank, team in enumerate(tb.seed_conference(conf, records), start=1):
                    seed_rows.append({
                        "season": season, "team": team, "seed": rank,
                        "in_playoffs": rank <= 7,
                        "division_winner": team in winners,
                    })
            # Place within division follows the same ordering.
            for division in {v[1] for v in team_meta.values()}:
                members = [t for t, m in team_meta.items() if m[1] == division]
                ordered = tb.order_tied(members, records, True) if len(members) > 1 else members
                for place, team in enumerate(ordered, start=1):
                    division_order[team] = place
            for row in seed_rows:
                if row["season"] == season:
                    row["div_place"] = division_order.get(row["team"], 9)

        if seed_rows:
            agg = agg.drop([c for c in ("seed", "in_playoffs", "div_place") if c in agg.columns])
            agg = agg.join(pl.DataFrame(seed_rows), on=["season", "team"], how="left")

        out = round_cols(agg, 3).sort(["season", "conf", "seed"])
        write_parquet(out, "standings")
        return out
