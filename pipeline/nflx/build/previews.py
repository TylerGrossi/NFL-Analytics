"""Projections for games that have not been played.

The site can already describe a game in progress and a game that is over. This
covers the third case, which is most of the calendar: a game on the schedule.
"""

from __future__ import annotations

import polars as pl

from ..models import preview as pv
from ..util import log, round_cols, step, write_parquet


def build(games: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    with step("game previews"):
        model = pv.fit(games, team_season)
        out = pv.project(games, team_season, model)

        if out.height == 0:
            log("no unplayed games on the schedule")
            write_parquet(out, "game_previews")
            return out

        out = round_cols(out, 3)
        write_parquet(out, "game_previews")

        by_season = out.group_by("season").agg(pl.len().alias("games")).sort("season")
        for r in by_season.iter_rows(named=True):
            log(f"{r['season']}: {r['games']} games projected")
        return out
