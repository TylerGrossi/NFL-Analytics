"""Small shared helpers: logging, timing, and writing outputs."""

from __future__ import annotations

import json
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import polars as pl

from .config import JSON, PARQUET

# Windows consoles default to cp1252; nflverse data contains player names that aren't.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


@contextmanager
def step(name: str):
    print(f"> {name}", flush=True)
    t0 = time.perf_counter()
    try:
        yield
    finally:
        print(f"  done in {time.perf_counter() - t0:.1f}s", flush=True)


def write_parquet(df: pl.DataFrame, name: str) -> Path:
    """Write a dataframe to data/parquet/<name>.parquet."""
    path = PARQUET / f"{name}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path, compression="zstd")
    log(f"{name}.parquet — {df.height:,} rows, {path.stat().st_size / 1e6:.1f} MB")
    return path


def write_json(obj: Any, name: str) -> Path:
    """Write a JSON payload to data/json/<name>.json."""
    path = JSON / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False, default=_default)
    log(f"{name}.json — {path.stat().st_size / 1e3:.0f} KB")
    return path


def _default(o: Any) -> Any:
    if hasattr(o, "isoformat"):
        return o.isoformat()
    raise TypeError(f"not JSON serializable: {type(o)}")


def rank_desc(col: str) -> pl.Expr:
    """1 = best, for metrics where higher is better."""
    return pl.col(col).rank(method="min", descending=True).cast(pl.Int32)


def rank_asc(col: str) -> pl.Expr:
    """1 = best, for metrics where lower is better (defensive EPA allowed)."""
    return pl.col(col).rank(method="min").cast(pl.Int32)


def pct_rank(col: str) -> pl.Expr:
    """Percentile 0-100, higher = better."""
    return (pl.col(col).rank(method="average") / pl.len() * 100).round(0).cast(pl.Int32)


def safe_div(a: pl.Expr, b: pl.Expr) -> pl.Expr:
    return pl.when(b > 0).then(a / b).otherwise(None)


def round_cols(df: pl.DataFrame, digits: int = 4, exclude: tuple[str, ...] = ()) -> pl.DataFrame:
    """Round every float column — keeps JSON payloads small and readable."""
    return df.with_columns(
        [
            pl.col(c).round(digits)
            for c, dt in zip(df.columns, df.dtypes)
            if dt in (pl.Float32, pl.Float64) and c not in exclude
        ]
    )
