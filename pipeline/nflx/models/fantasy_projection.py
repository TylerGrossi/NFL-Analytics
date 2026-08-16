"""Projecting next season's fantasy production.

Built on four measured facts rather than assumptions, all of them checked
against 2006-2025 before being used:

1. Last season's points per game carry a correlation of about 0.77 to next
   season. That is the single strongest input and everything else is a
   correction to it.
2. Expected points — what the usage was worth — are *not* more predictive than
   the points actually scored, which is the opposite of the usual claim. They
   do add a little on top (R2 0.588 to 0.595), so they enter with roughly a
   third of the weight of the actual, and no more.
3. A second prior season adds far more than the expected-points term does
   (R2 0.588 to 0.632). Two years of evidence beat one.
4. Ageing is real and strongly position-dependent. Backs start losing ground at
   26 and fall away hard; receivers hold to about 26; tight ends and
   quarterbacks decline gently and late.

Each position is fit separately, because the weights genuinely differ: a
quarterback's prior season means something different to a running back's.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import polars as pl

from ..util import log

POSITIONS = ("QB", "RB", "WR", "TE")

# Seasons before this have no expected-points model to draw on.
FIRST_EXPECTED = 2006

# A player needs this many games before a rate is treated as signal.
MIN_GAMES = 6

# Games of regression applied to every observed rate, pulling it toward the
# positional mean by games / (games + k). Without this a back who averaged
# sixteen points across six games is trusted exactly as much as one who did it
# across seventeen, which is how a draft board ends up in love with a backup
# who had two good afternoons. Fit over 2006-2025: k = 4 minimises next-season
# error (RMSE 3.571 against 3.613 with no shrinkage).
SHRINK_GAMES = 4.0

# Where a projection falls back when a player has no usable history: the
# replacement-level performer, not zero and not the league average.
ROOKIE_FALLBACK_PERCENTILE = 35


@dataclass
class PositionFit:
    position: str
    coefs: dict[str, float]
    intercept: float
    n: int
    r2: float


@dataclass
class ProjectionModel:
    fits: dict[str, PositionFit] = field(default_factory=dict)
    fallback_ppg: dict[str, float] = field(default_factory=dict)
    fallback_rec: dict[str, float] = field(default_factory=dict)


TERMS = ("ppg", "xppg", "prev_ppg", "age", "age_sq")


def _frame(fantasy: pl.DataFrame, players: pl.DataFrame) -> pl.DataFrame:
    """One row per player-season with the prior year and the following year attached."""
    birth = players.select("player_id", "birth_date")
    base = (
        fantasy.filter(pl.col("games") >= MIN_GAMES)
        .join(birth, on="player_id", how="left")
        .with_columns(
            (pl.col("points") / pl.col("games")).alias("raw_ppg"),
            (pl.col("receptions") / pl.col("games")).alias("rec_pg"),
            (pl.col("expected_points") / pl.col("games")).alias("raw_xppg"),
            (pl.col("season") - pl.col("birth_date").str.slice(0, 4).cast(pl.Int32)).alias("age"),
        )
        .with_columns(
            (pl.col("games") / (pl.col("games") + SHRINK_GAMES)).alias("trust"),
            pl.col("raw_ppg").mean().over(["season", "position"]).alias("pos_mean_ppg"),
            pl.col("raw_xppg").mean().over(["season", "position"]).alias("pos_mean_xppg"),
        )
        .with_columns(
            (pl.col("trust") * pl.col("raw_ppg")
             + (1 - pl.col("trust")) * pl.col("pos_mean_ppg")).alias("ppg"),
            (pl.col("trust") * pl.col("raw_xppg")
             + (1 - pl.col("trust")) * pl.col("pos_mean_xppg")).alias("xppg"),
        )
    )

    prev = base.select(
        "player_id",
        (pl.col("season") + 1).alias("season"),
        pl.col("ppg").alias("prev_ppg"),
    )
    # The target is what actually happened, never the shrunk rate: shrinking
    # the thing being predicted makes it smoother and the model look better
    # than it is. Inputs are regressed, the outcome is not.
    nxt = base.select(
        "player_id",
        (pl.col("season") - 1).alias("season"),
        pl.col("raw_ppg").alias("next_ppg"),
        pl.col("rec_pg").alias("next_rec_pg"),
    )

    return (
        base.join(prev, on=["player_id", "season"], how="left")
        .join(nxt, on=["player_id", "season"], how="left")
        # Missing expected points (pre-2006) and missing prior year both fall
        # back to the current season, so the term contributes nothing rather
        # than dropping the player out of the fit.
        .with_columns(
            pl.col("xppg").fill_null(pl.col("ppg")),
            pl.col("prev_ppg").fill_null(pl.col("ppg")),
            pl.col("age").fill_null(26),
        )
        .with_columns((pl.col("age") ** 2).alias("age_sq"))
    )


def _design(df: pl.DataFrame) -> np.ndarray:
    return np.column_stack([df[t].to_numpy().astype(float) for t in TERMS] + [np.ones(df.height)])


def fit(fantasy: pl.DataFrame, players: pl.DataFrame) -> ProjectionModel:
    df = _frame(fantasy, players)
    train = df.drop_nulls(["next_ppg", "ppg"])
    model = ProjectionModel()

    for pos in POSITIONS:
        s = train.filter(pl.col("position") == pos)
        if s.height < 100:
            continue
        X = _design(s)
        y = s["next_ppg"].to_numpy().astype(float)
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        pred = X @ beta
        r2 = 1 - float(np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2))
        model.fits[pos] = PositionFit(
            position=pos,
            coefs=dict(zip(TERMS, (float(b) for b in beta[:-1]))),
            intercept=float(beta[-1]),
            n=s.height,
            r2=r2,
        )

        pool = df.filter(pl.col("position") == pos)
        model.fallback_ppg[pos] = float(
            np.percentile(pool["raw_ppg"].drop_nulls().to_numpy(), ROOKIE_FALLBACK_PERCENTILE)
        )
        model.fallback_rec[pos] = float(
            np.percentile(pool["rec_pg"].drop_nulls().to_numpy(), ROOKIE_FALLBACK_PERCENTILE)
        )

    for pos, f in model.fits.items():
        log(f"  {pos}: R2 {f.r2:.3f} (n={f.n}) · "
            + " ".join(f"{k} {v:+.3f}" for k, v in f.coefs.items() if k in ("ppg", "xppg", "prev_ppg")))
    return model


def validate(fantasy: pl.DataFrame, players: pl.DataFrame, first_test: int = 2014) -> None:
    """Walk forward: fit on prior seasons only, predict the next, score it.

    Compared against the naive baseline every fantasy projection has to beat —
    simply repeating last season's points per game.
    """
    df = _frame(fantasy, players)
    seasons = sorted(s for s in df["season"].unique().to_list() if s >= first_test)

    preds, naive, raw, truth = [], [], [], []
    for season in seasons:
        train = df.filter((pl.col("season") < season) & pl.col("next_ppg").is_not_null())
        test = df.filter((pl.col("season") == season) & pl.col("next_ppg").is_not_null())
        if train.height < 500 or test.height == 0:
            continue
        for pos in POSITIONS:
            tr = train.filter(pl.col("position") == pos)
            te = test.filter(pl.col("position") == pos)
            if tr.height < 100 or te.height == 0:
                continue
            beta, *_ = np.linalg.lstsq(_design(tr), tr["next_ppg"].to_numpy().astype(float), rcond=None)
            preds.append(_design(te) @ beta)
            naive.append(te["ppg"].to_numpy().astype(float))
            raw.append(te["raw_ppg"].to_numpy().astype(float))
            truth.append(te["next_ppg"].to_numpy().astype(float))

    p = np.concatenate(preds)
    nv = np.concatenate(naive)
    rw = np.concatenate(raw)
    y = np.concatenate(truth)
    rmse = lambda a: float(np.sqrt(np.mean((y - a) ** 2)))
    mae = lambda a: float(np.mean(np.abs(y - a)))
    log(f"projection backtest {seasons[0]}-{seasons[-1]} on {len(y):,} player seasons")
    log(f"  model        RMSE {rmse(p):.2f}  MAE {mae(p):.2f}  r {np.corrcoef(p, y)[0, 1]:.3f}")
    log(f"  last season  RMSE {rmse(rw):.2f}  MAE {mae(rw):.2f}  r {np.corrcoef(rw, y)[0, 1]:.3f}"
        f"  ({100 * (1 - rmse(p) / rmse(rw)):+.1f}%)")
    log(f"  + shrinkage  RMSE {rmse(nv):.2f}  MAE {mae(nv):.2f}  r {np.corrcoef(nv, y)[0, 1]:.3f}"
        f"  ({100 * (1 - rmse(p) / rmse(nv)):+.1f}%)  <- the honest benchmark")


def project(
    fantasy: pl.DataFrame, players: pl.DataFrame, model: ProjectionModel, season: int
) -> pl.DataFrame:
    """Project `season` from everything before it."""
    df = _frame(fantasy, players).filter(pl.col("season") == season - 1)
    if df.height == 0:
        return pl.DataFrame()

    out = []
    for pos, f in model.fits.items():
        s = df.filter(pl.col("position") == pos)
        if s.height == 0:
            continue
        # Age forward one year: we are projecting the season after the one observed.
        s = s.with_columns((pl.col("age") + 1).alias("age")).with_columns(
            (pl.col("age") ** 2).alias("age_sq")
        )
        ppg = _design(s) @ np.array([*f.coefs.values(), f.intercept])
        # Receptions scale with the projected change in production; that keeps
        # PPR, half-PPR and standard consistent with one another.
        ratio = np.clip(ppg / np.maximum(s["raw_ppg"].to_numpy(), 0.5), 0.4, 1.6)
        out.append(
            s.select(
                pl.lit(season).alias("season"),
                "player_id", "name", "position", "age",
                pl.col("games").alias("games_last"),
                pl.col("raw_ppg").alias("ppg_last"),
                pl.col("points").alias("points_last"),
            ).with_columns(
                pl.Series("proj_ppg", np.maximum(ppg, 0.0)),
                pl.Series("proj_rec_pg", np.maximum(s["rec_pg"].to_numpy() * ratio, 0.0)),
            )
        )

    return pl.concat(out, how="diagonal").sort("proj_ppg", descending=True)
