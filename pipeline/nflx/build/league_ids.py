"""A player-id bridge, so a synced fantasy league can be joined to the store.

Sleeper and ESPN each key players by their own id; everything here keys on the
nflverse gsis id. Without a bridge a synced roster is a list of names we cannot
look anything up for.

**Sleeper's own cross-references are too sparse to rely on.** Of 1,033 active
skill players on their roster feed, only 180 carry a `gsis_id` and 239 an
`espn_id` — and the gsis values arrive with a leading space. Matching on those
alone bridges 23% of a league, which is useless.

So the match is layered, strongest key first, and each player is claimed by the
first layer that finds him:

1. `gsis_id` — exact, when Sleeper supplies it.
2. `espn_id` — against the `espn_id` already in our player index.
3. Normalised name + position + current club.
4. Normalised name + position, for a player who has just changed club.

Together those reach about 91%. The residue is overwhelmingly rookies and
undrafted free agents who have not played an NFL snap, so nflverse has no row
for them at all — that is a real gap rather than a matching failure, and the
league pages show such players by name with no stats rather than dropping them.
"""

from __future__ import annotations

import polars as pl
import requests

from ..sources.espn import HEADERS
from ..util import log, round_cols, step, write_parquet

SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl"

# The feed is ~15MB of every player Sleeper has ever listed. Only people on a
# current roster matter for a league sync.
FANTASY_POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def _norm(col: str) -> pl.Expr:
    """Lowercase, strip punctuation and suffixes so 'A.J. Brown' meets 'AJ Brown'."""
    return (
        pl.col(col)
        .str.to_lowercase()
        .str.replace_all(r"\b(jr|sr|ii|iii|iv|v)\b", "")
        .str.replace_all(r"[^a-z ]", "")
        .str.replace_all(r"\s+", " ")
        .str.strip_chars()
    )


def _sleeper_players() -> pl.DataFrame:
    try:
        r = requests.get(SLEEPER_PLAYERS, headers=HEADERS, timeout=180)
        r.raise_for_status()
        payload = r.json()
    except Exception as exc:
        log(f"sleeper player feed unavailable: {exc!r}")
        return pl.DataFrame()

    rows = []
    for pid, v in payload.items():
        if v.get("position") not in FANTASY_POSITIONS:
            continue
        rows.append({
            "sleeper_id": str(pid),
            # Sleeper ships these with a leading space.
            "sleeper_gsis": (v.get("gsis_id") or "").strip() or None,
            "sleeper_espn": str(v["espn_id"]) if v.get("espn_id") else None,
            "sleeper_name": v.get("full_name") or "",
            "sleeper_pos": v.get("position"),
            "sleeper_team": v.get("team"),
            "active": bool(v.get("team")),
        })
    return pl.DataFrame(rows)


def build(index: pl.DataFrame) -> pl.DataFrame:
    with step("league player ids"):
        sleeper = _sleeper_players()
        if sleeper.height == 0:
            log("no sleeper feed — league sync will fall back to name matching")
            return pl.DataFrame()

        ours = index.select(
            "player_id", "name", "position", "team", "espn_id"
        ).with_columns(_norm("name").alias("nkey"))
        sl = sleeper.with_columns(_norm("sleeper_name").alias("nkey"))

        claimed: list[pl.DataFrame] = []
        remaining = sl

        def take(matched: pl.DataFrame, how: str) -> None:
            nonlocal remaining
            if matched.height == 0:
                return
            claimed.append(matched.with_columns(pl.lit(how).alias("matched_by")))
            remaining = remaining.filter(
                ~pl.col("sleeper_id").is_in(matched["sleeper_id"].implode())
            )

        # 1. gsis, exact.
        take(
            remaining.join(
                ours.select(pl.col("player_id").alias("sleeper_gsis"), "player_id"),
                on="sleeper_gsis", how="inner",
            ),
            "gsis",
        )
        # 2. espn id.
        take(
            remaining.filter(pl.col("sleeper_espn").is_not_null()).join(
                ours.filter(pl.col("espn_id").is_not_null())
                .select(pl.col("espn_id").alias("sleeper_espn"), "player_id"),
                on="sleeper_espn", how="inner",
            ),
            "espn_id",
        )
        # 3. name + position + club.
        take(
            remaining.join(
                ours.select("nkey", pl.col("position").alias("sleeper_pos"),
                            pl.col("team").alias("sleeper_team"), "player_id"),
                on=["nkey", "sleeper_pos", "sleeper_team"], how="inner",
            ).unique(subset=["sleeper_id"]),
            "name_team",
        )
        # 4. name + position, for a player who just moved.
        take(
            remaining.join(
                ours.select("nkey", pl.col("position").alias("sleeper_pos"), "player_id"),
                on=["nkey", "sleeper_pos"], how="inner",
            ).unique(subset=["sleeper_id"]),
            "name",
        )

        if not claimed:
            log("no players bridged")
            return pl.DataFrame()

        bridge = pl.concat(claimed, how="diagonal").select(
            "sleeper_id", "player_id", "sleeper_name", "sleeper_pos",
            "sleeper_team", "sleeper_espn", "active", "matched_by",
        )
        write_parquet(round_cols(bridge, 3), "player_ids")

        act = sleeper.filter(pl.col("active"))
        hit = bridge.filter(pl.col("active"))
        for how in ("gsis", "espn_id", "name_team", "name"):
            n = hit.filter(pl.col("matched_by") == how).height
            if n:
                log(f"  {how:10s} {n:5d}")
        log(f"{hit.height} of {act.height} rostered players bridged "
            f"({hit.height / max(act.height, 1):.0%})")
        return bridge
