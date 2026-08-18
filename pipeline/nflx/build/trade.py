"""Aging curves and draft pick value — the two halves of a trade calculator
that this data can actually support.

The third half, pricing a player's contract surplus in dollars, is **not built
here, on purpose.** It was built, it produced Ja'Marr Chase at −$154M and
Amon-Ra St. Brown at −$198M as the worst contracts in football, and it was
removed. The reason is worth recording so nobody rebuilds it the same way.

**WAR on this site is not a cross-position dollar currency.** Over the 2025
season, the 10th-to-90th percentile spread of WAR is 3.17 wins at quarterback
and between 0.14 and 0.80 everywhere else — a consequence of the compression
already documented as a known limitation. A single dollars-per-win constant is
therefore calibrated almost entirely on quarterbacks, and applying it to a
receiver prices a genuinely elite season at about a million dollars against a
thirty-million-dollar cap hit. The arithmetic is right and the answer is absurd.

Fitting dollars per win *within* each position does not rescue it either: the
correlation between WAR and pay inside a position group runs 0.17 for backs,
0.18 for the offensive line and 0.24 for interior defenders. There is no
defensible slope to fit at those correlations.

So this module ships what holds up:

**Aging, by the delta method.** Mean WAR by age is dominated by survivorship —
weak players leave, so the average at 32 is an average over survivors, and a
naive curve "peaks" wherever attrition is harshest. Fit that way, running backs
peaked at 21 and corners at 21, which is nonsense. Comparing the *same player*
in consecutive seasons controls for who he is, and produces the curves the
literature expects: quarterbacks climbing to about 28, backs declining from 22,
corners falling away after 26.

**Pick value, and the thing nobody says out loud.** In Approximate Value a
top-five pick is worth about 1.8x a late first. In WAR it is worth eleven times
as much. The whole of that gap is quarterbacks: among top-ten picks from
2012-2021 a quarterback returned 12.1 career WAR and *every other position
returned under 1.6*, while AV rated them nearly equal (59.8 against 52.8 for
interior linemen). AV deliberately compresses the gap between a franchise
quarterback and a good guard; WAR does not. Both curves are written out, with
the position mix behind each band, because the divergence is the finding.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from sklearn.isotonic import IsotonicRegression

from ..util import log, round_cols, step, write_json, write_parquet

# Draft classes used for the pick curve. Line WAR needs snap counts from 2012,
# so earlier classes are missing value by construction rather than by outcome.
PICK_FIRST, PICK_LAST = 2012, 2021

# Picks either side of center averaged before the monotone fit, matching the
# treatment the AV curve already gets in `draft.py`.
SMOOTH_WINDOW = 9

# Snaps before a season counts toward an aging delta. Below this the difference
# is mostly playing time, not development.
AGING_MIN_PLAYS = 200

# Paired observations before a position group gets its own curve; thinner
# groups fall back to the all-position curve rather than fitting noise.
AGING_MIN_PAIRS = 300

AGE_FROM, AGE_TO = 22, 36

# A rookie deal is four years (five with the fifth-year option on a first
# rounder), and it is cheap — which is the entire reason picks carry surplus.
ROOKIE_YEARS = 4


def _with_age(war: pl.DataFrame, players: pl.DataFrame) -> pl.DataFrame:
    return war.join(
        players.select("player_id", "birth_date", "pos_group"), on="player_id", how="inner"
    ).with_columns(
        (pl.col("season") - pl.col("birth_date").cast(pl.Date).dt.year()).alias("age")
    ).filter(pl.col("age").is_between(AGE_FROM, AGE_TO))


def _aging(war: pl.DataFrame, players: pl.DataFrame) -> pl.DataFrame:
    """Expected WAR change from one age to the next, same player."""
    d = _with_age(war, players).filter(pl.col("plays") >= AGING_MIN_PLAYS)
    nxt = d.select(
        "player_id",
        (pl.col("season") - 1).alias("season"),
        pl.col("war").alias("war_next"),
    )
    pairs = d.join(nxt, on=["player_id", "season"], how="inner").with_columns(
        (pl.col("war_next") - pl.col("war")).alias("delta")
    )
    if pairs.height == 0:
        return pl.DataFrame()

    overall = (
        pairs.group_by("age").agg(pl.col("delta").mean().alias("delta"), pl.len().alias("n"))
        .with_columns(pl.lit("ALL").alias("pos_group"))
    )
    big = (
        pairs.group_by("pos_group")
        .agg(pl.len().alias("pairs"))
        .filter(pl.col("pairs") >= AGING_MIN_PAIRS)["pos_group"]
        .to_list()
    )
    by_pos = (
        pairs.filter(pl.col("pos_group").is_in(big))
        .group_by("pos_group", "age")
        .agg(pl.col("delta").mean().alias("delta"), pl.len().alias("n"))
        .filter(pl.col("n") >= 12)
    )
    out = pl.concat([by_pos, overall.select(by_pos.columns)], how="vertical")

    # Turn per-year deltas into a curve relative to age 24, which is where most
    # second contracts are negotiated from.
    #
    # The raw deltas are noisy enough to be unplottable — quarterbacks came out
    # at +0.32, +0.10, +0.24, -0.38, +0.43 across five consecutive ages, which
    # is sampling error, not development. Each delta is averaged with its
    # neighbours, weighted by how many pairs stand behind it, before the curve
    # is accumulated. That is the same light-smoothing-then-shape treatment the
    # draft curve gets, and it imposes no parametric form on the ageing.
    curves = []
    for grp in out["pos_group"].unique().to_list():
        s = out.filter(pl.col("pos_group") == grp).sort("age")
        ages = s["age"].to_list()
        deltas = s["delta"].to_list()
        counts = [float(c) for c in s["n"].to_list()]

        smoothed = []
        for i in range(len(deltas)):
            lo, hi = max(0, i - 1), min(len(deltas), i + 2)
            wsum = sum(counts[lo:hi]) or 1.0
            smoothed.append(
                sum(deltas[j] * counts[j] for j in range(lo, hi)) / wsum
            )

        level, levels = 0.0, []
        for dlt in smoothed:
            levels.append(level)
            level += dlt
        base = levels[min(range(len(ages)), key=lambda i: abs(ages[i] - 24))]
        curves.append(
            s.with_columns(
                pl.Series("delta_smooth", smoothed),
                pl.Series("rel_war", [v - base for v in levels]),
            )
        )
    return pl.concat(curves)


def _pick_curve(picks: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Expected career WAR by pick number, and the position mix behind it."""
    mature = picks.filter(pl.col("season").is_between(PICK_FIRST, PICK_LAST))
    if mature.height == 0:
        return pl.DataFrame(), pl.DataFrame()

    raw = (
        mature.with_columns(pl.col("career_war").fill_null(0.0).alias("w"))
        .group_by("pick")
        .agg(
            pl.col("w").mean().alias("raw_war"),
            pl.col("value").mean().alias("raw_av"),
            pl.len().alias("n"),
        )
        .sort("pick")
        .filter(pl.col("n") >= 5)
    )
    if raw.height < SMOOTH_WINDOW:
        return pl.DataFrame(), pl.DataFrame()

    pick = raw["pick"].to_numpy().astype(float)
    weight = raw["n"].to_numpy().astype(float)
    half = SMOOTH_WINDOW // 2

    fitted = {}
    for col, out in (("raw_war", "war"), ("raw_av", "av")):
        val = raw[col].to_numpy()
        padded = np.pad(val, (half, half), mode="edge")
        smoothed = np.convolve(padded, np.ones(SMOOTH_WINDOW) / SMOOTH_WINDOW, mode="valid")
        fitted[out] = (
            IsotonicRegression(increasing=False, out_of_bounds="clip")
            .fit(pick, smoothed, sample_weight=weight)
            .predict(pick)
        )

    curve = raw.with_columns(
        pl.Series("war", fitted["war"]),
        pl.Series("av", fitted["av"]),
    ).with_columns(
        (pl.col("war") / max(fitted["war"][0], 1e-9)).alias("war_relative"),
        (pl.col("av") / max(fitted["av"][0], 1e-9)).alias("av_relative"),
    )

    # What each band of the draft actually returns, by position. This is the
    # table that explains why the two currencies disagree.
    mix = (
        mature.with_columns(
            pl.when(pl.col("pick") <= 10).then(pl.lit("1-10"))
            .when(pl.col("pick") <= 32).then(pl.lit("11-32"))
            .when(pl.col("pick") <= 64).then(pl.lit("33-64"))
            .when(pl.col("pick") <= 105).then(pl.lit("65-105"))
            .otherwise(pl.lit("106+")).alias("band"),
            pl.col("career_war").fill_null(0.0).alias("w"),
        )
        .group_by("band", "position")
        .agg(
            pl.len().alias("n"),
            pl.col("w").mean().alias("war"),
            pl.col("value").mean().alias("av"),
        )
        .filter(pl.col("n") >= 5)
        .sort(["band", "war"], descending=[False, True])
    )
    return curve, mix


def _dollars_per_win(contracts: pl.DataFrame, war: pl.DataFrame, season: int) -> dict:
    """What a win costs, from what clubs actually paid for last year's WAR."""
    joined = (
        contracts.filter((pl.col("season") == season) & (pl.col("apy") > 1))
        .join(
            war.filter((pl.col("season") == season - 1) & (pl.col("plays") >= AGING_MIN_PLAYS))
            .select("player_id", "war", "pos_group"),
            on="player_id", how="inner",
        )
    )
    if joined.height < 40:
        return {}
    x = joined["war"].to_numpy()
    y = joined["apy"].to_numpy()
    slope, intercept = np.polyfit(x, y, 1)
    r = float(np.corrcoef(x, y)[0, 1])

    ex_qb = joined.filter(pl.col("pos_group") != "QB")
    ex = {}
    if ex_qb.height >= 40:
        s2, i2 = np.polyfit(ex_qb["war"].to_numpy(), ex_qb["apy"].to_numpy(), 1)
        ex = {
            "per_win_ex_qb": float(s2),
            "r_ex_qb": float(
                np.corrcoef(ex_qb["war"].to_numpy(), ex_qb["apy"].to_numpy())[0, 1]
            ),
        }
    return {
        "per_win": float(slope),
        "floor_apy": float(intercept),
        "r": r,
        "n": int(joined.height),
        "season": season,
        **ex,
    }


def build(
    contracts: pl.DataFrame, war: pl.DataFrame, players: pl.DataFrame,
    picks: pl.DataFrame, season: int,
) -> pl.DataFrame:
    """Aging curves and pick value. Player dollar surplus is deliberately absent."""
    with step("trade value"):
        aging = _aging(war, players)
        if aging.height:
            write_parquet(round_cols(aging, 4), "trade_aging")
            for grp in ("QB", "RB", "WR", "CB", "ALL"):
                s = aging.filter(pl.col("pos_group") == grp).sort("age")
                if s.height:
                    peak = s.sort("rel_war", descending=True).head(1)
                    log(f"  aging {grp:4s} peaks at {int(peak['age'][0])}")

        curve, mix = _pick_curve(picks)
        if curve.height:
            write_parquet(round_cols(curve, 4), "trade_picks")
            write_parquet(round_cols(mix, 3), "trade_pick_mix")
            top = curve.filter(pl.col("pick") <= 5)["war"].mean()
            late = curve.filter(pl.col("pick").is_between(25, 32))["war"].mean()
            top_av = curve.filter(pl.col("pick") <= 5)["av"].mean()
            late_av = curve.filter(pl.col("pick").is_between(25, 32))["av"].mean()
            log(f"  pick 1 = {curve['war'][0]:.1f} career WAR · "
                f"top-5 vs late-1st {top / max(late, 1e-9):.1f}x in WAR, "
                f"{top_av / max(late_av, 1e-9):.1f}x in AV")

        # Published for the record, and as the evidence for why player surplus
        # is not built on top of it. See the module docstring.
        dpw = _dollars_per_win(contracts, war, season)
        if dpw:
            log(f"  ${dpw['per_win']:.1f}M per win (r={dpw['r']:.2f}, n={dpw['n']})"
                + (f" · ${dpw['per_win_ex_qb']:.1f}M ex-QB (r={dpw['r_ex_qb']:.2f})"
                   if "per_win_ex_qb" in dpw else ""))

        spread = (
            war.filter((pl.col("season") == season - 1) & (pl.col("plays") >= AGING_MIN_PLAYS))
            .group_by("pos_group")
            .agg(
                (pl.col("war").quantile(0.9) - pl.col("war").quantile(0.1)).alias("war_spread"),
                pl.len().alias("n"),
            )
            .filter(pl.col("n") >= 25)
            .sort("war_spread", descending=True)
        )
        write_parquet(round_cols(spread, 3), "trade_war_spread")

        write_json(
            {
                **dpw,
                "rookie_years": ROOKIE_YEARS,
                "pick_classes": [PICK_FIRST, PICK_LAST],
                "aging_min_plays": AGING_MIN_PLAYS,
            },
            "trade_constants",
        )
        return curve
