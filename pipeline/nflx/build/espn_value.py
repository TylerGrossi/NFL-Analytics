"""Where an ESPN league's own board disagrees with everyone else's.

Most drafters in an ESPN league draft off ESPN's default ranking, so ESPN's
board is not merely another opinion — it is a decent model of the room you are
sitting in. A player the wider consensus rates thirtieth but ESPN ranks
sixtieth tends to still be there in the sixth round of an ESPN draft. That gap
is the exploitable thing, and it exists precisely because the platform's
defaults are sticky.

Both ESPN's published rank and its observed average draft position are carried.
The rank is what the platform tells people; the ADP is what they actually do,
and where the two disagree the ADP is the better guide.
"""

from __future__ import annotations

import polars as pl

from ..sources import espn
from ..util import log, round_cols, step, write_parquet

SKILL = ("QB", "RB", "WR", "TE")

# Share of players sitting on one ADP value before that value is read as a
# floor rather than a measurement.
FLOOR_SHARE = 0.15


def _strip_adp_floor(d: pl.DataFrame) -> pl.DataFrame:
    """Null out ESPN's undrafted floor.

    ESPN reports an average draft position for everybody, including players
    nobody drafts, by parking them all on a single value just past the last
    real pick — 622 of 937 players sat on 169.5-170.0 with a median ownership
    of 0.04%. Compared against a consensus rank those manufacture enormous fake
    disagreements and would dominate any "overpriced" list. The floor is found
    rather than hardcoded: any single value carrying an implausible share of
    the field is the sentinel, and everything from there up is dropped.
    """
    have = d.filter(pl.col("espn_adp") > 0)
    if have.height == 0:
        return d.with_columns(pl.lit(None, dtype=pl.Float64).alias("espn_adp"))

    # Rounded to whole picks: the floor is smeared across 169.5-170.0 and only
    # collapses into one bucket at integer resolution.
    counts = have.with_columns(pl.col("espn_adp").round(0).alias("v")).group_by("v").len()
    crowded = counts.filter(pl.col("len") >= FLOOR_SHARE * have.height)
    floor = float(crowded["v"].min()) - 0.5 if crowded.height else None
    if floor is not None:
        log(f"  ESPN ADP floor detected at {floor} — {int(crowded['len'].sum())} players parked there")

    return d.with_columns(
        pl.when((pl.col("espn_adp") > 0) & (pl.lit(floor).is_null() | (pl.col("espn_adp") < floor)))
        .then(pl.col("espn_adp"))
        .otherwise(None)
        .alias("espn_adp")
    )


def build(season: int, index: pl.DataFrame) -> pl.DataFrame:
    with step("espn draft ranks"):
        payload = espn.fantasy_players(season)
        if not payload:
            log("no ESPN ranks available")
            return pl.DataFrame()

        rows = []
        for e in payload:
            ranks = (e.get("draftRanksByRankType") or {}).get("PPR")
            if not ranks:
                continue
            own = e.get("ownership") or {}
            rows.append({
                "espn_id": str(e.get("id")),
                "espn_name": e.get("fullName"),
                "espn_pos": espn.FANTASY_POSITIONS.get(e.get("defaultPositionId")),
                "espn_rank": ranks.get("rank"),
                "espn_adp": own.get("averageDraftPosition"),
                "espn_pct_owned": own.get("percentOwned"),
                "espn_injured": bool(e.get("injured")),
            })
        if not rows:
            log("ESPN returned no ranked players")
            return pl.DataFrame()

        d = pl.DataFrame(rows).filter(pl.col("espn_pos").is_in(SKILL))
        bridge = (
            index.select("player_id", "espn_id")
            .drop_nulls("espn_id")
            .with_columns(pl.col("espn_id").cast(pl.String))
            .unique(subset=["espn_id"])
        )
        out = (
            d.join(bridge, on="espn_id", how="left")
            .with_columns(pl.lit(season).alias("season"))
        )
        out = _strip_adp_floor(out)
        write_parquet(round_cols(out, 2), "espn_ranks")
        matched = out.filter(pl.col("player_id").is_not_null()).height
        log(f"{out.height} ranked skill players · {matched} bridged to the player index")
        return out
