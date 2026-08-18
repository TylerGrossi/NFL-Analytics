"""The draft: what each pick is actually worth, and who converts.

Value is measured in Pro Football Reference's weighted career Approximate
Value. WAR would be the natural currency for this site, but it cannot carry the
question: defensive WAR needs charting that starts in 2018 and line WAR needs
snap counts from 2012, so a defender drafted in 2004 has no WAR at all and
would silently count as a bust. AV is a cruder measure that exists for every
position in every year, which is the property this analysis needs. Career WAR
is joined on anyway, for the modern classes where it is complete.

A pick that never played is a zero, not a missing row. Dropping those inflates
late-round value badly, which is the most common way this analysis goes wrong.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from sklearn.isotonic import IsotonicRegression

import nflreadpy as nfl

from ..config import FIRST_DRAFT_SEASON
from ..util import log, round_cols, step, write_parquet

# Career length needed before a class can be judged. A 2024 pick has not had
# the chance to accumulate value, and including them drags the curve down at
# the end of the sample rather than telling us anything about the picks.
MATURE_AFTER = 4

# Picks either side of center averaged before the monotone fit.
SMOOTH_WINDOW = 9

# A pick number needs this many players behind it before its mean is worth
# fitting. With enough classes every pick clears it easily; with only a couple
# it clears for none of them, which is what used to empty the frame.
MIN_PICKS_PER_SLOT = 5

# Draft classes needed before the curve can be fit at all. Below this the
# per-pick means are too thin to smooth and the build should say so rather than
# fail inside numpy.
MIN_CLASSES = 8

# Games played that separates "found a player" from "found a roster body".
CONTRIBUTOR_GAMES = 48

# The draft table carries Pro Football Reference club codes, and franchises that
# have moved keep their old ones. Both are folded onto the abbreviations the rest
# of the site uses, so a club's draft record follows the franchise.
PFR_TEAM = {
    "GNB": "GB", "KAN": "KC", "NWE": "NE", "NOR": "NO", "TAM": "TB", "SFO": "SF",
    "LVR": "LV", "OAK": "LV", "SDG": "LAC", "STL": "LA", "LAR": "LA", "RAM": "LA",
    "CRD": "ARI", "RAV": "BAL", "OTI": "TEN", "HTX": "HOU", "CLT": "IND",
    "RAI": "LV", "JAC": "JAX", "WSH": "WAS",
}


def _standard_team() -> pl.Expr:
    return pl.col("team").replace(PFR_TEAM).alias("team")


def _picks(first: int, last: int) -> pl.DataFrame:
    d = nfl.load_draft_picks().filter(pl.col("season").is_between(first, last))
    return d.with_columns(
        _standard_team(),
        pl.col("w_av").fill_null(0.0).alias("value"),
        pl.col("dr_av").fill_null(0.0).alias("value_with_team"),
        pl.col("games").fill_null(0).alias("games"),
        pl.col("probowls").fill_null(0).alias("probowls"),
        pl.col("allpro").fill_null(0).alias("allpro"),
        pl.col("seasons_started").fill_null(0).alias("seasons_started"),
    )


def _curve(mature: pl.DataFrame) -> pl.DataFrame:
    """Expected value by pick number.

    About twenty players sit behind each pick, so the raw per-pick averages are
    noisy enough that a curve drawn through them alone would overstate what is
    known. An exponential was the obvious parametric choice and is the wrong
    one: nothing with a single decay rate can hold both the very steep fall
    across the first few picks and the long flat tail, so it either overshoots
    pick 1 or undershoots it depending on which space it is fit in.

    Instead the raw means are lightly smoothed and then forced monotone with
    isotonic regression, weighted by how many players stand behind each pick.
    Monotonicity is the one thing genuinely known in advance — an earlier pick
    cannot be worth less — and the fit cannot leave the range of the data.
    """
    raw = (
        mature.group_by("pick")
        .agg(
            pl.col("value").mean().alias("raw_value"),
            pl.len().alias("n"),
            (pl.col("games") >= CONTRIBUTOR_GAMES).mean().alias("contributor_rate"),
            (pl.col("probowls") > 0).mean().alias("probowl_rate"),
        )
        .sort("pick")
        .filter(pl.col("n") >= MIN_PICKS_PER_SLOT)
    )
    if raw.height < SMOOTH_WINDOW:
        return pl.DataFrame()

    pick = raw["pick"].to_numpy().astype(float)
    val = raw["raw_value"].to_numpy()
    weight = raw["n"].to_numpy().astype(float)

    half = SMOOTH_WINDOW // 2
    padded = np.pad(val, (half, half), mode="edge")
    smoothed = np.convolve(padded, np.ones(SMOOTH_WINDOW) / SMOOTH_WINDOW, mode="valid")

    fitted = (
        IsotonicRegression(increasing=False, out_of_bounds="clip")
        .fit(pick, smoothed, sample_weight=weight)
        .predict(pick)
    )

    ss_res = float(np.sum((val - fitted) ** 2))
    ss_tot = float(np.sum((val - val.mean()) ** 2))
    log(f"pick value curve — isotonic over a {SMOOTH_WINDOW}-pick mean · "
        f"R2 {1 - ss_res / ss_tot:.3f} · pick 1 {fitted[0]:.1f} AV, pick {int(pick[-1])} {fitted[-1]:.1f}")

    return raw.with_columns(
        pl.Series("value", fitted),
        # Relative to the first pick, which is how a trade chart is read.
        pl.Series("relative", fitted / fitted[0]),
    )


def _team_returns(mature: pl.DataFrame, curve: pl.DataFrame) -> pl.DataFrame:
    """Value produced against what each club's slots were worth."""
    expected = curve.select("pick", pl.col("value").alias("expected"))
    joined = mature.join(expected, on="pick", how="inner")
    return (
        joined.group_by("team")
        .agg(
            pl.len().alias("picks"),
            pl.col("value").sum().alias("value"),
            pl.col("expected").sum().alias("expected"),
            (pl.col("games") >= CONTRIBUTOR_GAMES).mean().alias("contributor_rate"),
            (pl.col("probowls") > 0).sum().alias("probowlers"),
            pl.col("value").filter(pl.col("round") == 1).mean().alias("first_round_value"),
            pl.col("value").filter(pl.col("round") >= 4).mean().alias("late_round_value"),
        )
        .with_columns(
            (pl.col("value") - pl.col("expected")).alias("surplus"),
            ((pl.col("value") - pl.col("expected")) / pl.col("picks")).alias("surplus_per_pick"),
        )
        .sort("surplus_per_pick", descending=True)
    )


def build(seasons: list[int], index: pl.DataFrame, war_career: pl.DataFrame) -> pl.DataFrame:
    with step("draft"):
        # The draft is a historical question and does not touch play-by-play, so
        # it spans every class on record rather than the caller's pbp window.
        # Handing it a six-season window left two mature classes, no pick number
        # cleared the minimum sample, and the curve fit died on an empty array.
        first, last = FIRST_DRAFT_SEASON, max(seasons)
        picks = _picks(first, last)
        mature = picks.filter(pl.col("season") <= last - MATURE_AFTER)
        classes = mature["season"].n_unique() if mature.height else 0
        log(f"{picks.height:,} picks {first}-{last} · {mature.height:,} mature "
            f"across {classes} classes")

        curve = _curve(mature) if classes >= MIN_CLASSES else pl.DataFrame()
        if curve.height == 0:
            log(f"only {classes} mature classes — pick value curve skipped")
            return picks
        write_parquet(round_cols(curve, 3), "draft_curve")
        write_parquet(round_cols(_team_returns(mature, curve), 2), "draft_teams")

        # Combine testing, joined on the PFR id the draft table already carries.
        combine = nfl.load_combine().select(
            pl.col("pfr_id"), "forty", "bench", "vertical", "broad_jump", "cone", "shuttle",
        ).filter(pl.col("pfr_id").is_not_null()).unique(subset=["pfr_id"])

        detail = (
            picks.select(
                "season", "round", "pick", "team", "position", "category", "side", "college",
                "age", "games", "seasons_started", "probowls", "allpro", "hof",
                "value", "value_with_team",
                pl.col("gsis_id").alias("player_id"),
                pl.col("pfr_player_id").alias("pfr_id"),
                pl.col("pfr_player_name").alias("name"),
            )
            .join(combine, on="pfr_id", how="left")
            .join(
                index.select("player_id", "headshot", pl.col("position").alias("pos_now")),
                on="player_id", how="left",
            )
            .join(
                war_career.select("player_id", "career_war", "career_par"),
                on="player_id", how="left",
            )
            .join(curve.select("pick", pl.col("value").alias("pick_expected")), on="pick", how="left")
            .with_columns(
                (pl.col("value") - pl.col("pick_expected")).alias("over_expected")
            )
            .sort(["season", "pick"])
        )
        write_parquet(round_cols(detail, 3), "draft_picks")

        best = (
            detail.filter(
                (pl.col("season") <= last - MATURE_AFTER)
                & pl.col("over_expected").is_not_null()
            )
            .sort("over_expected", descending=True)
            .head(5)
        )
        for r in best.iter_rows(named=True):
            log(f"  steal: {r['name']} ({r['season']} #{r['pick']}) "
                f"{r['value']:.0f} AV vs {r['pick_expected']:.0f} expected")
        return detail
