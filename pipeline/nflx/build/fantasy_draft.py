"""Draft board inputs: a projection, and what the market thinks.

Two independent opinions per player. The projection is this site's own, fit on
twenty years of results and backtested against the naive baseline every
projection has to beat. The consensus ranking is FantasyPros' expert composite,
scraped fresh, and it is the thing to be exploited rather than copied — the
board's whole point is finding where a defensible projection and the room's
opinion disagree.

Ranking formats are selected by `page_type`, never by `ecr_type`. The latter
folds redraft-overall together with redraft-IDP, which puts a linebacker at the
top of a board meant for offensive skill players.
"""

from __future__ import annotations

import polars as pl

import nflreadpy as nfl

from ..config import PARQUET
from ..models import fantasy_projection as fp
from ..util import log, round_cols, step, write_parquet

# The league styles worth carrying, and where each lives in the scrape.
FORMATS = {
    "redraft": "redraft-overall",
    "superflex": "redraft-op",
    "dynasty": "dynasty-overall",
    "dynasty_superflex": "dynasty-op",
    "best_ball": "best-overall",
    "rookie": "dynasty-rk",
}

SKILL = ("QB", "RB", "WR", "TE")


def _rankings() -> tuple[pl.DataFrame, str | None]:
    """Expert consensus rank per player, one column per league format."""
    try:
        raw = nfl.load_ff_rankings()
    except Exception as exc:
        log(f"rankings unavailable: {exc!r}")
        return pl.DataFrame(), None

    scraped = raw["scrape_date"].max() if "scrape_date" in raw.columns else None
    ids = (
        nfl.load_ff_playerids()
        .select("fantasypros_id", "gsis_id")
        .filter(pl.col("fantasypros_id").is_not_null() & pl.col("gsis_id").is_not_null())
        .unique(subset=["fantasypros_id"])
    )

    merged: pl.DataFrame | None = None
    for name, page in FORMATS.items():
        page_rows = raw.filter(pl.col("page_type") == page)
        if page_rows.height == 0:
            continue
        block = (
            page_rows.join(ids, left_on="id", right_on="fantasypros_id", how="inner")
            .select(
                pl.col("gsis_id").alias("player_id"),
                pl.col("ecr").alias(f"ecr_{name}"),
                pl.col("sd").alias(f"ecr_sd_{name}"),
            )
            .unique(subset=["player_id"])
        )
        merged = block if merged is None else merged.join(block, on="player_id", how="full", coalesce=True)
        log(f"  {name}: {block.height} ranked players")

    return (merged if merged is not None else pl.DataFrame()), scraped


def build(season: int, fantasy: pl.DataFrame, players: pl.DataFrame) -> pl.DataFrame:
    with step("fantasy draft board"):
        model = fp.fit(fantasy, players)
        fp.validate(fantasy, players)
        proj = fp.project(fantasy, players, model, season)
        if proj.height == 0:
            log("no projection produced")
            return proj

        ranks, scraped = _rankings()
        board = proj if ranks.height == 0 else proj.join(ranks, on="player_id", how="full", coalesce=True)

        meta = players.select(
            "player_id", "headshot", pl.col("team").alias("team"),
            pl.col("position").alias("pos_index"), pl.col("name").alias("index_name"),
        )
        board = board.join(meta, on="player_id", how="left").with_columns(
            pl.col("name").fill_null(pl.col("index_name")),
            pl.col("position").fill_null(pl.col("pos_index")),
        ).drop("index_name", "pos_index")

        board = board.filter(pl.col("position").is_in(SKILL)).with_columns(
            pl.lit(season).alias("season"),
            pl.lit(scraped).alias("ranked_on"),
            # A projection needs a prior season; a rookie has none, and saying so
            # is better than inventing a number from nothing.
            pl.col("proj_ppg").is_not_null().alias("projected"),
        )

        # Sixteen of seventeen games is the usual availability assumption; the
        # projection is a rate, so games has to come from somewhere explicit.
        board = board.with_columns(
            (pl.col("proj_ppg") * 16).alias("proj_points"),
            (pl.col("proj_rec_pg") * 16).alias("proj_receptions"),
        )

        board = _attach_kit(board)

        write_parquet(round_cols(board.sort("proj_ppg", descending=True, nulls_last=True), 3),
                      "fantasy_draft")

        have = board.filter(pl.col("projected")).height
        log(f"{board.height} board players · {have} projected · "
            f"{board.height - have} ranked only (rookies and returners without a prior season)")
        if scraped:
            log(f"consensus scraped {scraped}")
        return board


def _attach_kit(board: pl.DataFrame) -> pl.DataFrame:
    """Schedule difficulty, bye week and availability, if the kit has been built."""
    def read(name: str) -> pl.DataFrame:
        path = PARQUET / f"{name}.parquet"
        return pl.read_parquet(path) if path.exists() else pl.DataFrame()

    sos = read("fantasy_sos")
    if sos.height > 0:
        board = board.join(
            sos.select("team", "position", "sos_index", "sos_rank", "playoff_rank"),
            on=["team", "position"], how="left",
        )

    byes = read("fantasy_byes")
    if byes.height > 0:
        board = board.join(byes.select("team", "bye"), on="team", how="left")

    avail = read("fantasy_availability")
    if avail.height > 0:
        board = board.join(avail.select("player_id", "availability"), on="player_id", how="left")

    espn = read("espn_ranks")
    if espn.height > 0:
        board = board.join(
            espn.filter(pl.col("player_id").is_not_null()).select(
                "player_id", "espn_rank", "espn_adp", "espn_pct_owned"
            ),
            on="player_id", how="left",
        )

    depth = read("depth_charts")
    if depth.height > 0:
        board = board.join(
            depth.select("player_id", "depth_rank", "depth_pos", "depth_as_of"),
            on="player_id", how="left",
        )

    # Injury designations are only attached when they belong to the season being
    # drafted. The most recent reports on file in August are from last February,
    # and a player listed Questionable for a Super Bowl says nothing about now —
    # showing it as current status would be worse than showing nothing.
    reports = read("injury_reports")
    season = board["season"][0] if board.height else None
    if reports.height > 0 and season is not None:
        current = reports.filter(pl.col("report_season") == season)
        if current.height > 0:
            board = board.join(
                current.select("player_id", "status", "practice", "p_play", "injury"),
                on="player_id", how="left",
            )

    return board
