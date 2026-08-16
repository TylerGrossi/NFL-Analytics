"""The model against the betting market, backtested honestly.

The projection model already produces a margin, a total and a win probability
for every game. The closing line is sitting in the same table. Nobody had ever
put the two side by side and published the result, and the walk-forward figures
quoted in the README were computed once by hand and pasted in — which is
exactly the kind of number this project does not accept anywhere else.

So this builds it. **Walk-forward only**: for each test season the model is fit
on completed games from earlier seasons and never sees the year it is scoring.
Anything else is a fit reported as a forecast.

Three things are measured, and all three are written out whichever way they
come out:

- **Accuracy** — RMSE and MAE of projected margin against the result, beside
  the closing line's own error over the same games. The market is the benchmark,
  not the opponent.
- **Against the spread** — the hit rate of taking the side the model disagrees
  with the market about, bucketed by the size of that disagreement. A model with
  no edge lands at 50% and that is the expected result.
- **Calibration** — of the win probability, in deciles. A model can be badly
  calibrated while still beating the spread, and vice versa.

Note on breakeven: a standard −110 price needs **52.4%** to break even, so a
hit rate between 50% and 52.4% is still a losing bet. The summary carries that
constant so the page cannot quietly imply otherwise.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from ..models import preview as pv
from ..util import log, round_cols, step, write_json, write_parquet

# Closing lines are reliable in nflverse from the mid-2000s. Earlier seasons
# carry gaps that would silently bias a hit rate.
FIRST_TEST_SEASON = 2006

# Seasons of completed football needed before the first walk-forward fit.
MIN_TRAIN_SEASONS = 4

# A standard -110 price. Below this a hit rate loses money, however far above
# 50% it sits.
BREAKEVEN = 0.5238

# nflverse labels a game with the abbreviation the club used that season, so a
# franchise that moved is split across two or three codes. The draft build folds
# them the same way — a club's record should follow the franchise, or San Diego
# and the Chargers appear as separate teams with half a sample each.
RELOCATED = {"SD": "LAC", "STL": "LA", "OAK": "LV"}


def _walk_forward(games: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    """Score every played game with a model that never saw its season."""
    seasons = sorted(
        games.filter(pl.col("played") & (pl.col("game_type") == "REG"))["season"]
        .unique()
        .to_list()
    )
    frames = []
    for test in seasons:
        train = [s for s in seasons if s < test]
        if test < FIRST_TEST_SEASON or len(train) < MIN_TRAIN_SEASONS:
            continue
        model = pv.fit(
            games.filter(pl.col("season") < test),
            team_season.filter(pl.col("season") < test),
        )
        d = pv.assemble(games, team_season).filter(
            (pl.col("season") == test) & pl.col("played")
        )
        scored = pv.score(d, model)
        if scored.height:
            frames.append(scored)
    return pl.concat(frames, how="diagonal") if frames else pl.DataFrame()


def _grade(df: pl.DataFrame) -> pl.DataFrame:
    """Attach the actual result, and who each side of the market picked.

    Sign convention, which is the easiest thing to get backwards here:
    nflverse stores `spread_line` as the points the **home** team is favoured
    by, so a home favourite is positive and it is directly comparable to
    `proj_margin`.
    """
    d = df.with_columns(
        (pl.col("home_score") - pl.col("away_score")).cast(pl.Float64).alias("margin"),
        (pl.col("home_score") + pl.col("away_score")).cast(pl.Float64).alias("total"),
    ).filter(pl.col("margin").is_not_null())

    return d.with_columns(
        # Positive = the model is higher on the home side than the market is.
        (pl.col("proj_margin") - pl.col("spread_line")).alias("edge"),
        (pl.col("proj_total") - pl.col("total_line")).alias("total_edge"),
        (pl.col("margin") - pl.col("proj_margin")).alias("model_err"),
        (pl.col("margin") - pl.col("spread_line")).alias("market_err"),
    ).with_columns(
        # Did the side the model preferred actually cover? Push is excluded
        # rather than counted as a half win, and the count is reported.
        pl.when(pl.col("margin") == pl.col("spread_line"))
        .then(None)
        .otherwise(
            (pl.col("edge") > 0) == (pl.col("margin") > pl.col("spread_line"))
        )
        .alias("ats_win"),
        pl.when(pl.col("total") == pl.col("total_line"))
        .then(None)
        .otherwise((pl.col("total_edge") > 0) == (pl.col("total") > pl.col("total_line")))
        .alias("total_win"),
        ((pl.col("proj_margin") > 0) == (pl.col("margin") > 0)).alias("su_win"),
    )


def _rate(s: pl.Series) -> tuple[float | None, int]:
    v = s.drop_nulls()
    return (float(v.mean()), int(v.len())) if v.len() else (None, 0)


def _summary(g: pl.DataFrame) -> dict:
    has_line = g.filter(pl.col("spread_line").is_not_null())
    ats, ats_n = _rate(has_line["ats_win"])
    su, su_n = _rate(has_line["su_win"])
    tot, tot_n = _rate(g.filter(pl.col("total_line").is_not_null())["total_win"])

    def err(col: str, frame: pl.DataFrame) -> dict:
        v = frame[col].drop_nulls().to_numpy()
        return {
            "rmse": float(np.sqrt(np.mean(v**2))),
            "mae": float(np.mean(np.abs(v))),
        } if v.size else {}

    # Hit rate by how far the model is from the market. If there is an edge
    # anywhere it should be where the disagreement is largest.
    buckets = []
    for lo, hi in [(0, 1), (1, 3), (3, 6), (6, 10), (10, 99)]:
        b = has_line.filter(
            (pl.col("edge").abs() >= lo) & (pl.col("edge").abs() < hi)
        )
        rate, n = _rate(b["ats_win"])
        if n >= 50:
            buckets.append({
                "from": lo, "to": None if hi == 99 else hi,
                "hit_rate": rate, "games": n,
            })

    # Win-probability calibration in deciles: of the games given a 70-80%
    # chance, how many were actually won.
    calib = []
    for lo in range(0, 100, 10):
        b = g.filter(
            (pl.col("home_wp") >= lo / 100) & (pl.col("home_wp") < (lo + 10) / 100)
        )
        if b.height >= 40:
            calib.append({
                "bucket": f"{lo}-{lo + 10}%",
                "predicted": float(b["home_wp"].mean()),
                "actual": float((b["margin"] > 0).mean()),
                "games": b.height,
            })

    corr = None
    if has_line.height > 2:
        corr = float(
            np.corrcoef(
                has_line["proj_margin"].to_numpy(), has_line["spread_line"].to_numpy()
            )[0, 1]
        )

    return {
        "games": int(g.height),
        "games_with_line": int(has_line.height),
        "first_season": int(g["season"].min()),
        "last_season": int(g["season"].max()),
        "model": err("model_err", has_line),
        "market": err("market_err", has_line),
        "straight_up": su,
        "straight_up_games": su_n,
        "ats_hit_rate": ats,
        "ats_games": ats_n,
        "ats_pushes": int(has_line.height - ats_n),
        "total_hit_rate": tot,
        "total_games": tot_n,
        "breakeven": BREAKEVEN,
        "correlation_with_line": corr,
        "ats_by_edge": buckets,
        "calibration": calib,
    }


def _team_bias(g: pl.DataFrame) -> pl.DataFrame:
    """Clubs the market persistently prices above or below the result."""
    home = g.select(
        pl.col("home_team").replace(RELOCATED).alias("team"),
        (pl.col("margin") - pl.col("spread_line")).alias("vs_line"),
        pl.col("season"),
    )
    away = g.select(
        pl.col("away_team").replace(RELOCATED).alias("team"),
        (pl.col("spread_line") - pl.col("margin")).alias("vs_line"),
        pl.col("season"),
    )
    return (
        pl.concat([home, away])
        .drop_nulls("vs_line")
        .group_by("team")
        .agg(
            pl.col("vs_line").mean().alias("avg_vs_line"),
            (pl.col("vs_line") > 0).mean().alias("cover_rate"),
            pl.len().alias("games"),
        )
        .filter(pl.col("games") >= 100)
        .sort("avg_vs_line", descending=True)
    )


def build(games: pl.DataFrame, team_season: pl.DataFrame) -> pl.DataFrame:
    with step("market backtest"):
        scored = _walk_forward(games, team_season)
        if scored.height == 0:
            log("not enough history for a walk-forward backtest")
            return pl.DataFrame()

        graded = _grade(scored)
        write_parquet(round_cols(graded, 4), "market_games")
        write_parquet(round_cols(_team_bias(graded), 4), "market_teams")

        s = _summary(graded)
        write_json(s, "market_validation")

        log(f"{s['games']:,} games walk-forward from {s['first_season']}")
        if s["model"] and s["market"]:
            log(f"  margin RMSE — model {s['model']['rmse']:.2f} · "
                f"market {s['market']['rmse']:.2f}")
        if s["straight_up"] is not None:
            log(f"  straight up {s['straight_up']:.1%}")
        if s["ats_hit_rate"] is not None:
            verdict = "above" if s["ats_hit_rate"] > BREAKEVEN else "below"
            log(f"  against the spread {s['ats_hit_rate']:.1%} "
                f"({s['ats_games']:,} games) — {verdict} the {BREAKEVEN:.1%} breakeven")
        return graded
