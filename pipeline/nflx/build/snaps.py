"""Weekly snap counts, by team.

Season snap totals already ride on the player line, but a total cannot show the
thing snaps are actually watched for: the week a back's share moved, the week a
rookie took over, the week someone came back from injury and was eased in. That
is a grid — players down, weeks across — and it needs its own store.

Source is PFR's per-game snap counts, which key on a PFR id. The player index is
joined in so a row can link to the player it describes.
"""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

# The buckets a reader thinks in, rather than the seventeen labels PFR uses.
GROUPS = {
    "QB": "QB",
    "RB": "RB", "FB": "RB",
    "WR": "WR",
    "TE": "TE",
    "T": "OL", "G": "OL", "C": "OL", "OL": "OL", "OT": "OL", "OG": "OL",
    "DE": "DL", "DT": "DL", "NT": "DL", "DL": "DL",
    "LB": "LB", "OLB": "LB", "ILB": "LB", "MLB": "LB",
    "CB": "DB", "S": "DB", "SAF": "DB", "FS": "DB", "SS": "DB", "DB": "DB",
}

GROUP_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "OTHER"]


def build(seasons: list[int], index: pl.DataFrame) -> pl.DataFrame | None:
    with step("weekly snap counts"):
        frames = []
        for season in seasons:
            src = nv.snap_counts(season)
            if src.height == 0:
                continue
            df = (
                src.filter(pl.col("game_type") == "REG")
                .select(
                    pl.col("season").cast(pl.Int32),
                    pl.col("week").cast(pl.Int32),
                    "team", "opponent", "player", "position",
                    pl.col("pfr_player_id").alias("pfr_id"),
                    pl.col("offense_snaps").alias("off_snaps"),
                    pl.col("offense_pct").alias("off_pct"),
                    pl.col("defense_snaps").alias("def_snaps"),
                    pl.col("defense_pct").alias("def_pct"),
                    pl.col("st_snaps"),
                    pl.col("st_pct"),
                )
                .with_columns(
                    pl.col("position")
                    .replace_strict(GROUPS, default="OTHER")
                    .alias("pos_group")
                )
            )
            frames.append(df)
            log(f"{season}: {df.height:,} player-games")

        if not frames:
            log("no snap counts available; skipping")
            return None

        out = pl.concat(frames, how="vertical").join(
            index.select("player_id", "pfr_id").filter(pl.col("pfr_id").is_not_null()),
            on="pfr_id",
            how="left",
        )
        out = round_cols(out, 4).sort(["season", "team", "pos_group", "player", "week"])
        write_parquet(out, "snap_week")
        return out
