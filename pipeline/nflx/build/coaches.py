"""Coaching analytics — the page `BLUEPRINT.md` §3.4 specified and nobody built.

Coaching is discussed constantly and tabulated almost nowhere. Everything here
already existed in the store; what was missing was a key. `games.parquet`
carries `home_coach` and `away_coach`, so a coach can be followed across the
clubs he has worked for rather than being an attribute of a team-season.

Four things are measured.

**Fourth down aggressiveness** comes straight from `fourth_down_teams`, which
already scores every fourth down against the decision model and totals the win
probability surrendered.

**Pass tendency** is PROE — pass rate over expected — from the play store's own
`pass_oe`, restricted to neutral game states so that trailing teams throwing to
catch up do not read as aggression.

**Play-call entropy**, which is the one nobody publishes. For each down and
distance bucket, take the pass/run split and compute its binary entropy in
bits; average the cells weighted by how often they occur. A coach who runs on
every first-and-ten and throws on every third-and-long scores near 0; one whose
split is 50/50 everywhere scores 1.0. It measures *predictability*, not
quality — and the two are not the same thing, which is the interesting part.

**Tempo and discipline** — no-huddle rate, shotgun rate, and penalties per
play, all per coach-season.

Garbage time is excluded throughout. A coach down twenty-one in the fourth is
not calling the game he wants to call, and letting those snaps in makes every
trailing team look pass-happy and unpredictable.
"""

from __future__ import annotations

import math

import polars as pl

from ..config import PARQUET
from ..util import log, round_cols, step, write_parquet

# Win probability band treated as a neutral game state.
NEUTRAL_LO, NEUTRAL_HI = 0.20, 0.80

# Snaps a coach-season needs before its rates are published.
MIN_PLAYS = 200

# Distance buckets for the entropy cells. Short, medium and long is the split
# every play-caller actually thinks in.
def _distance_bucket() -> pl.Expr:
    return (
        pl.when(pl.col("ydstogo") <= 3).then(pl.lit("short"))
        .when(pl.col("ydstogo") <= 7).then(pl.lit("medium"))
        .otherwise(pl.lit("long"))
        .alias("dist")
    )


def _coach_games(games: pl.DataFrame) -> pl.DataFrame:
    """One row per coach per team-season, with the record attached."""
    reg = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    sides = []
    for side, other in (("home", "away"), ("away", "home")):
        sides.append(
            reg.select(
                pl.col(f"{side}_coach").alias("coach"),
                pl.col(f"{side}_team").alias("team"),
                "season",
                (pl.col(f"{side}_score") > pl.col(f"{other}_score")).alias("win"),
                (pl.col(f"{side}_score") == pl.col(f"{other}_score")).alias("tie"),
            )
        )
    return (
        pl.concat(sides)
        .filter(pl.col("coach").is_not_null())
        .group_by("coach", "team", "season")
        .agg(
            pl.len().alias("games"),
            pl.col("win").sum().alias("wins"),
            pl.col("tie").sum().alias("ties"),
        )
        .with_columns(
            (pl.col("games") - pl.col("wins") - pl.col("ties")).alias("losses"),
            ((pl.col("wins") + 0.5 * pl.col("ties")) / pl.col("games")).alias("win_pct"),
        )
    )


def _entropy(p: float) -> float:
    """Binary entropy in bits. 0 = perfectly predictable, 1 = a coin flip."""
    if p <= 0.0 or p >= 1.0:
        return 0.0
    return -(p * math.log2(p) + (1 - p) * math.log2(1 - p))


# Only what the tendency metrics need. Reading the whole play store breaks on
# schema drift across seasons — `goal_to_go` is Int32 in some years and Float64
# in others — and pulls seventy columns to use nine.
PBP_COLUMNS = [
    "posteam", "season", "down", "ydstogo", "play_type", "wp",
    "pass_oe", "shotgun", "no_huddle", "penalty",
]


def _load_pbp(seasons: list[int]) -> pl.DataFrame:
    frames = []
    for season in seasons:
        path = PARQUET / "pbp" / f"season={season}.parquet"
        if not path.exists():
            continue
        have = pl.read_parquet_schema(path)
        cols = [c for c in PBP_COLUMNS if c in have]
        frames.append(pl.read_parquet(path, columns=cols))
    return pl.concat(frames, how="diagonal") if frames else pl.DataFrame()


def _tendencies(pbp: pl.DataFrame) -> pl.DataFrame:
    """Per team-season play-calling, from neutral-state scrimmage snaps."""
    d = pbp.filter(
        pl.col("posteam").is_not_null()
        & pl.col("down").is_not_null()
        & pl.col("play_type").is_in(["pass", "run"])
        & pl.col("wp").is_between(NEUTRAL_LO, NEUTRAL_HI)
    ).with_columns(_distance_bucket(), (pl.col("play_type") == "pass").alias("is_pass"))

    if d.height == 0:
        return pl.DataFrame()

    base = d.group_by("posteam", "season").agg(
        pl.len().alias("plays"),
        pl.col("is_pass").mean().alias("pass_rate"),
        pl.col("pass_oe").mean().alias("proe"),
        pl.col("shotgun").mean().alias("shotgun_rate"),
        pl.col("no_huddle").mean().alias("no_huddle_rate"),
        pl.col("is_pass").filter(pl.col("down") <= 2).mean().alias("early_pass_rate"),
    )

    # Entropy: pass/run split per (down, distance), averaged over the cells in
    # proportion to how often each comes up.
    cells = (
        d.group_by("posteam", "season", "down", "dist")
        .agg(pl.len().alias("n"), pl.col("is_pass").mean().alias("p"))
        .filter(pl.col("n") >= 10)
    )
    cells = cells.with_columns(
        pl.col("p").map_elements(_entropy, return_dtype=pl.Float64).alias("h")
    )
    ent = (
        cells.group_by("posteam", "season")
        .agg(
            ((pl.col("h") * pl.col("n")).sum() / pl.col("n").sum()).alias("entropy"),
            pl.col("n").sum().alias("entropy_plays"),
        )
    )

    pens = (
        pbp.filter(pl.col("posteam").is_not_null())
        .group_by("posteam", "season")
        .agg(pl.col("penalty").fill_null(0).mean().alias("penalty_rate"))
    )

    return (
        base.join(ent, on=["posteam", "season"], how="left")
        .join(pens, on=["posteam", "season"], how="left")
        .rename({"posteam": "team"})
    )


def build(
    seasons: list[int], games: pl.DataFrame,
    team_season: pl.DataFrame, fourth: pl.DataFrame,
) -> pl.DataFrame:
    with step("coaches"):
        record = _coach_games(games)
        if record.height == 0:
            log("no coach names on the schedule")
            return pl.DataFrame()

        tend = _tendencies(_load_pbp(seasons))
        fourth_cols = [
            c for c in ("go_rate", "go_rate_when_optimal", "optimal_rate", "wp_lost",
                        "situations", "clear_errors")
            if c in fourth.columns
        ]
        net = (
            team_season.select("team", "season", "net_adj", "off_adj", "def_adj")
            if "net_adj" in team_season.columns
            else pl.DataFrame()
        )

        seasonal = record
        if tend.height:
            seasonal = seasonal.join(tend, on=["team", "season"], how="left")
        if fourth_cols:
            seasonal = seasonal.join(
                fourth.select("team", "season", *fourth_cols), on=["team", "season"], how="left"
            )
        if net.height:
            seasonal = seasonal.join(net, on=["team", "season"], how="left")

        seasonal = seasonal.filter(pl.col("plays").fill_null(0) >= MIN_PLAYS).sort(
            ["season", "coach"], descending=[True, False]
        )
        write_parquet(round_cols(seasonal, 4), "coach_seasons")

        # Career: a coach follows his own record across every club he has led.
        career = (
            seasonal.group_by("coach")
            .agg(
                pl.col("season").min().alias("first_season"),
                pl.col("season").max().alias("last_season"),
                pl.col("season").n_unique().alias("seasons"),
                pl.col("team").n_unique().alias("clubs"),
                pl.col("team").sort_by("season", descending=True).first().alias("last_team"),
                pl.col("games").sum().alias("games"),
                pl.col("wins").sum().alias("wins"),
                pl.col("losses").sum().alias("losses"),
                pl.col("ties").sum().alias("ties"),
                # Rates are weighted by snaps, not averaged over seasons — a
                # seventeen-game year should not count the same as three weeks
                # of an interim spell.
                *[
                    ((pl.col(c) * pl.col("plays")).sum() / pl.col("plays").sum()).alias(c)
                    for c in ("pass_rate", "proe", "shotgun_rate", "no_huddle_rate",
                              "early_pass_rate", "entropy", "penalty_rate")
                    if c in seasonal.columns
                ],
                *[
                    ((pl.col(c) * pl.col("games")).sum() / pl.col("games").sum()).alias(c)
                    for c in ("go_rate", "go_rate_when_optimal", "optimal_rate", "net_adj")
                    if c in seasonal.columns
                ],
                *(
                    [pl.col("wp_lost").sum().alias("wp_lost")]
                    if "wp_lost" in seasonal.columns else []
                ),
                pl.col("plays").sum().alias("plays"),
            )
            .with_columns(
                ((pl.col("wins") + 0.5 * pl.col("ties")) / pl.col("games")).alias("win_pct")
            )
            .sort("games", descending=True)
        )
        write_parquet(round_cols(career, 4), "coach_careers")

        log(f"{career.height} coaches · {seasonal.height} coach seasons "
            f"{seasonal['season'].min()}–{seasonal['season'].max()}")
        if "entropy" in career.columns:
            top = career.filter(pl.col("games") >= 48).sort("entropy", descending=True).head(1)
            bot = career.filter(pl.col("games") >= 48).sort("entropy").head(1)
            if top.height and bot.height:
                log(f"  least predictable: {top['coach'][0]} {top['entropy'][0]:.3f} bits · "
                    f"most: {bot['coach'][0]} {bot['entropy'][0]:.3f}")
        return career
