"""The queryable play-by-play store.

Written as one parquet per season so DuckDB can prune whole files when the
app filters on season, which is what most queries do.
"""

from __future__ import annotations

import polars as pl

from ..config import PARQUET
from ..sources import nflverse as nv
from ..util import log, step


def scrimmage(df: pl.DataFrame) -> pl.DataFrame:
    """Pass and run plays with a valid EPA — the denominator for every rate stat.

    Excludes deleted/aborted plays and the penalty-only 'no_play' rows, which
    otherwise drag team EPA toward zero.
    """
    out = df.filter(
        pl.col("play_type").is_in(["pass", "run"])
        & pl.col("epa").is_not_null()
        & pl.col("posteam").is_not_null()
    )
    for col in ("play_deleted", "aborted_play"):
        if col in out.columns:
            out = out.filter(pl.col(col).fill_null(0) == 0)
    return out


def build(seasons: list[int]) -> int:
    """Write one parquet per season; returns the total play count."""
    with step(f"play-by-play ({len(seasons)} seasons)"):
        pbp_dir = PARQUET / "pbp"
        pbp_dir.mkdir(parents=True, exist_ok=True)
        total = 0
        for season in seasons:
            df = nv.pbp(season)
            path = pbp_dir / f"season={season}.parquet"
            df.write_parquet(path, compression="zstd")
            total += df.height
            log(f"{season}: {df.height:,} plays ({path.stat().st_size / 1e6:.1f} MB)")
        log(f"{total:,} plays total")
        return total
