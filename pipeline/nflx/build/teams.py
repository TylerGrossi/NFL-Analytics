"""Team reference data: identity, colors, logos."""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import step, write_json, write_parquet

# nflverse keeps historical relocations in load_teams(); these are the 32 current clubs.
CURRENT = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
    "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
}


def build() -> pl.DataFrame:
    with step("teams"):
        df = (
            nv.teams()
            .filter(pl.col("team_abbr").is_in(CURRENT))
            .unique(subset=["team_abbr"], keep="first")
            .select(
                pl.col("team_abbr").alias("team"),
                pl.col("team_name").alias("name"),
                pl.col("team_nick").alias("nick"),
                pl.col("team_conf").alias("conf"),
                pl.col("team_division").alias("division"),
                pl.col("team_color").alias("color"),
                pl.col("team_color2").alias("color2"),
                pl.col("team_color3").alias("color3"),
                pl.col("team_logo_espn").alias("logo"),
                pl.col("team_logo_squared").alias("logo_square"),
                pl.col("team_wordmark").alias("wordmark"),
                pl.col("team_id").alias("espn_id"),
            )
            .sort("team")
        )
        write_parquet(df, "teams")
        write_json(df.to_dicts(), "teams")
        return df
