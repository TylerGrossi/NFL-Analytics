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

# nflverse labels a game with the abbreviation the club used that season, and
# the teams table holds only the 32 current codes. The tiebreaker tree drops
# any game whose participants it does not recognize, so without this fold every
# St Louis, San Diego and Oakland game vanished from the 1999–2019 records —
# taking three divisions down to three clubs and skewing conference record,
# common games and strength of victory for everyone who played them.
RELOCATED = {"SD": "LAC", "STL": "LA", "OAK": "LV"}


def _berths(season: int) -> int:
    """Clubs per conference that reach the playoffs. Seven only from 2020."""
    return 7 if season >= 2020 else 6


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

        # Joined on the franchise, not the abbreviation: a 1999 St Louis row
        # keeps its own code but takes the Rams' conference and division, so it
        # stands in the NFC West table it actually played in rather than
        # dropping out of the standings with a null division.
        franchise = pl.col("team").replace(RELOCATED)
        meta = teams.select("team", "conf", "division", "name", "nick")
        agg = agg.join(
            meta.rename({"team": "_franchise"}),
            left_on=franchise, right_on="_franchise", how="left",
        )

        # Conference record needs the opponent's conference.
        conf_map = teams.select("team", "conf")
        conf_rows = (
            rows.with_columns(franchise.alias("_fr"), pl.col("opp").replace(RELOCATED).alias("_fo"))
            .join(conf_map.rename({"team": "_fr"}), on="_fr", how="left")
            .join(conf_map.rename({"team": "_fo", "conf": "opp_conf"}), on="_fo", how="left")
            .filter(pl.col("conf") == pl.col("opp_conf"))
            .group_by(["season", "team"])
            .agg(
                pl.col("win").sum().alias("conf_w"),
                pl.col("loss").sum().alias("conf_l"),
            )
        )
        agg = agg.join(conf_rows, on=["season", "team"], how="left")

        if team_season.height:
            # Efficiency is already folded onto the franchise, so a 2015 San
            # Diego row has to look itself up as the Chargers or it shows no
            # rating at all.
            agg = agg.join(
                team_season.select(
                    "season",
                    pl.col("team").alias("_franchise"),
                    "off_rank", "def_rank", "net_rank", "net_adj", "sos",
                ),
                left_on=["season", franchise], right_on=["season", "_franchise"], how="left",
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
            played = reg.select(
                pl.col("home_team").replace(RELOCATED),
                pl.col("away_team").replace(RELOCATED),
                "home_score", "away_score",
            )
            # Seeds come back under the current code; the standings rows carry
            # the code the club used that season, so they are mapped back.
            era_code = {
                RELOCATED[code]: code
                for code in set(reg["home_team"]) | set(reg["away_team"])
                if code in RELOCATED
            }
            records = tb.build_records(played.to_dicts(), team_meta)
            winners = set(tb.division_winners(records).values())
            berths = _berths(season)
            division_order: dict[str, int] = {}
            for conf in ("AFC", "NFC"):
                for rank, team in enumerate(tb.seed_conference(conf, records), start=1):
                    seed_rows.append({
                        "season": season, "team": era_code.get(team, team), "seed": rank,
                        "in_playoffs": rank <= berths,
                        "division_winner": team in winners,
                    })
            # Place within division follows the same ordering.
            for division in {v[1] for v in team_meta.values()}:
                members = [t for t, m in team_meta.items() if m[1] == division]
                ordered = tb.order_division(members, records) if len(members) > 1 else members
                for place, team in enumerate(ordered, start=1):
                    division_order[era_code.get(team, team)] = place
            for row in seed_rows:
                if row["season"] == season:
                    row["div_place"] = division_order.get(row["team"], 9)

        if seed_rows:
            agg = agg.drop([c for c in ("seed", "in_playoffs", "div_place") if c in agg.columns])
            agg = agg.join(pl.DataFrame(seed_rows), on=["season", "team"], how="left")

        out = round_cols(agg, 3).sort(["season", "conf", "seed"])
        write_parquet(out, "standings")
        return out
