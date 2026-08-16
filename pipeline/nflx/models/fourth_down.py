"""Fourth down decision model.

Three branch models — convert, kick, punt — evaluated through the win
probability distillation, so every choice is priced in the same currency:
the possessing team's chance of winning the game.

    WP(go)   = p(convert) · WP(1st & 10 at the new spot)
             + (1 − p(convert)) · (1 − WP(opponent takes over at the spot))

    WP(fg)   = p(make) · (1 − WP(opponent after kickoff, down 3 more))
             + (1 − p(make)) · (1 − WP(opponent takes over at the kick spot))

    WP(punt) = 1 − WP(opponent at the expected net field position)

Conversion is fit on third and fourth down run/pass plays pooled — the standard
approach, since fourth-down attempts alone are a biased sample of situations
coaches chose to go for.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingClassifier

from ..util import log
from .win_probability import FEATURES, WinProbability

# Clock burned by each choice, in seconds. Rough but consistent.
SECONDS_GO = 6.0
SECONDS_FG = 5.0
SECONDS_PUNT = 12.0

# Where a touchback puts the receiving team (dynamic kickoff, 2024 rules:
# own 30 → 70 yards from the opponent's end zone).
TOUCHBACK_YARDLINE_100 = 70.0

# A missed field goal is spotted where the kick was taken, ~8 yards behind the
# line of scrimmage, but never worse for the defense than their own 20.
MISSED_FG_SETBACK = 8.0
MISSED_FG_WORST = 80.0

# Longest field goal in NFL history is 66 yards. The gradient booster has no
# training data past its longest observed kick and extrapolates flat, which
# produced a confident probability for a 93-yard attempt. Anything past this is
# not an available option.
MAX_FG_DISTANCE = 68.0


class FourthDownModel:
    def __init__(
        self,
        wp: WinProbability,
        convert: HistGradientBoostingClassifier,
        field_goal: HistGradientBoostingClassifier,
        punt_curve: np.ndarray,
    ):
        self.wp = wp
        self.convert = convert
        self.field_goal = field_goal
        # punt_curve[i] = expected opponent yardline_100 when punting from
        # yardline_100 == i
        self.punt_curve = punt_curve

    # ---------------------------------------------------------------- branches

    def p_convert(self, ydstogo: np.ndarray, yardline_100: np.ndarray) -> np.ndarray:
        X = np.column_stack([ydstogo, yardline_100, np.full(len(ydstogo), 4.0)])
        return self.convert.predict_proba(X)[:, 1]

    def p_field_goal(self, yardline_100: np.ndarray) -> np.ndarray:
        """NaN past the model's range, so an impossible kick never gets a number."""
        distance = yardline_100 + 17.0
        p = self.field_goal.predict_proba(distance.reshape(-1, 1))[:, 1]
        return np.where(distance > MAX_FG_DISTANCE, np.nan, p)

    def punt_result(self, yardline_100: np.ndarray) -> np.ndarray:
        idx = np.clip(yardline_100.astype(int), 0, len(self.punt_curve) - 1)
        return self.punt_curve[idx]

    # ---------------------------------------------------------------- states

    def _state(
        self,
        score_differential,
        game_seconds_remaining,
        half_seconds_remaining,
        yardline_100,
        down,
        ydstogo,
        posteam_timeouts,
        defteam_timeouts,
    ) -> np.ndarray:
        n = len(np.atleast_1d(score_differential))

        def col(v) -> np.ndarray:
            """Scalars (a fresh 1st & 10) broadcast to the batch length."""
            arr = np.asarray(v, dtype=float)
            return np.full(n, float(arr)) if arr.ndim == 0 else arr

        return np.column_stack([
            col(score_differential),
            np.maximum(col(game_seconds_remaining), 0),
            np.maximum(col(half_seconds_remaining), 0),
            np.clip(col(yardline_100), 1, 99),
            col(down),
            np.clip(col(ydstogo), 1, 30),
            col(posteam_timeouts),
            col(defteam_timeouts),
        ])

    def evaluate(
        self,
        yardline_100: np.ndarray,
        ydstogo: np.ndarray,
        score_differential: np.ndarray,
        game_seconds_remaining: np.ndarray,
        half_seconds_remaining: np.ndarray | None = None,
        posteam_timeouts: np.ndarray | None = None,
        defteam_timeouts: np.ndarray | None = None,
    ) -> dict[str, np.ndarray]:
        """Win probability for each choice. All arrays are the same length."""
        n = len(yardline_100)
        yardline_100 = np.asarray(yardline_100, dtype=float)
        ydstogo = np.asarray(ydstogo, dtype=float)
        sd = np.asarray(score_differential, dtype=float)
        gsr = np.asarray(game_seconds_remaining, dtype=float)
        hsr = (
            np.asarray(half_seconds_remaining, dtype=float)
            if half_seconds_remaining is not None
            else np.minimum(gsr, 1800.0)
        )
        po = np.full(n, 3.0) if posteam_timeouts is None else np.asarray(posteam_timeouts, float)
        do = np.full(n, 3.0) if defteam_timeouts is None else np.asarray(defteam_timeouts, float)

        # ---- go for it
        p_conv = self.p_convert(ydstogo, yardline_100)
        gained = np.clip(yardline_100 - ydstogo, 1, 99)
        # Converting inside the 10 leaves goal-to-go distance, not a fresh 10.
        new_togo = np.minimum(10.0, gained)
        wp_success = self.wp.predict(
            self._state(sd, gsr - SECONDS_GO, hsr - SECONDS_GO, gained, 1, new_togo, po, do)
        )
        # A stop hands the ball over at the line of scrimmage.
        opp_spot_fail = np.clip(100.0 - yardline_100, 1, 99)
        wp_fail_opp = self.wp.predict(
            self._state(-sd, gsr - SECONDS_GO, hsr - SECONDS_GO, opp_spot_fail, 1, 10, do, po)
        )
        wp_go = p_conv * wp_success + (1 - p_conv) * (1 - wp_fail_opp)

        # ---- field goal
        p_fg = self.p_field_goal(yardline_100)
        wp_made_opp = self.wp.predict(
            self._state(
                -(sd + 3), gsr - SECONDS_FG, hsr - SECONDS_FG,
                np.full(n, TOUCHBACK_YARDLINE_100), 1, 10, do, po,
            )
        )
        miss_spot = np.minimum(100.0 - (yardline_100 + MISSED_FG_SETBACK), MISSED_FG_WORST)
        wp_miss_opp = self.wp.predict(
            self._state(-sd, gsr - SECONDS_FG, hsr - SECONDS_FG, np.clip(miss_spot, 1, 99), 1, 10, do, po)
        )
        # p_fg is already NaN out of range, which carries through to wp_fg.
        wp_fg = p_fg * (1 - wp_made_opp) + (1 - p_fg) * (1 - wp_miss_opp)

        # ---- punt
        opp_after_punt = self.punt_result(yardline_100)
        wp_punt_opp = self.wp.predict(
            self._state(-sd, gsr - SECONDS_PUNT, hsr - SECONDS_PUNT,
                        np.clip(opp_after_punt, 1, 99), 1, 10, do, po)
        )
        wp_punt = 1 - wp_punt_opp

        # Punting from inside the opponent's 35 is not a real option; the model
        # would otherwise recommend it in spots no team would ever punt from.
        wp_punt = np.where(yardline_100 <= 35, np.nan, wp_punt)

        return {
            "wp_go": wp_go,
            "wp_fg": wp_fg,
            "wp_punt": wp_punt,
            "p_convert": p_conv,
            "p_fg": p_fg,
            "punt_to": opp_after_punt,
        }


# -------------------------------------------------------------------- fitting

def _fit_conversion(frames: list[pl.DataFrame], seed: int = 17) -> HistGradientBoostingClassifier:
    df = pl.concat(
        [
            f.filter(
                pl.col("down").is_in([3, 4])
                & pl.col("play_type").is_in(["pass", "run"])
                & pl.col("ydstogo").is_between(1, 30)
                & pl.col("yardline_100").is_not_null()
            ).select("ydstogo", "yardline_100", "down", "first_down", "touchdown")
            for f in frames
        ],
        how="vertical",
    ).drop_nulls(subset=["ydstogo", "yardline_100", "down"])

    y = (
        (df["first_down"].fill_null(0) > 0) | (df["touchdown"].fill_null(0) > 0)
    ).to_numpy().astype(int)
    X = df.select("ydstogo", "yardline_100", "down").to_numpy().astype(float)

    model = HistGradientBoostingClassifier(
        max_iter=250, learning_rate=0.06, max_leaf_nodes=15,
        min_samples_leaf=150, l2_regularization=1.0, random_state=seed,
    )
    model.fit(X, y)
    log(f"conversion model — {len(y):,} third/fourth down plays · base rate {y.mean():.3f}")
    return model


def _fit_field_goal(frames: list[pl.DataFrame], seed: int = 17) -> HistGradientBoostingClassifier:
    df = pl.concat(
        [
            f.filter(
                (pl.col("field_goal_attempt") == 1)
                & pl.col("kick_distance").is_between(15, 75)
                & pl.col("field_goal_result").is_not_null()
            ).select("kick_distance", "field_goal_result")
            for f in frames
        ],
        how="vertical",
    )
    y = (df["field_goal_result"] == "made").to_numpy().astype(int)
    X = df.select("kick_distance").to_numpy().astype(float)

    model = HistGradientBoostingClassifier(
        max_iter=200, learning_rate=0.06, max_leaf_nodes=8,
        min_samples_leaf=60, l2_regularization=1.0, random_state=seed,
    )
    model.fit(X, y)
    log(f"field goal model — {len(y):,} attempts · make rate {y.mean():.3f}")
    return model


def _fit_punts(frames: list[pl.DataFrame]) -> np.ndarray:
    """Expected opponent field position after a punt, by punting spot.

    Derived from where the next drive actually started, so returns, touchbacks
    and coffin corners are all baked in rather than modeled separately.
    """
    rows = []
    for f in frames:
        df = f.sort(["game_id", "play_id"]).with_columns(
            pl.col("posteam").shift(-1).over("game_id").alias("next_posteam"),
            pl.col("yardline_100").shift(-1).over("game_id").alias("next_yardline"),
        )
        rows.append(
            df.filter(
                (pl.col("punt_attempt") == 1)
                & pl.col("yardline_100").is_not_null()
                & pl.col("next_yardline").is_not_null()
                & (pl.col("next_posteam") == pl.col("defteam"))
            ).select("yardline_100", "next_yardline")
        )
    punts = pl.concat(rows, how="vertical")

    by_spot = (
        punts.group_by(pl.col("yardline_100").cast(pl.Int32))
        .agg(pl.col("next_yardline").mean().alias("opp"), pl.len().alias("n"))
        .sort("yardline_100")
    )

    # Smooth into a lookup over every yard line; sparse spots fall back to the
    # league-wide relationship rather than a one-punt average.
    curve = np.full(100, np.nan)
    for spot, opp, n in by_spot.iter_rows():
        if 0 <= spot < 100 and n >= 5:
            curve[spot] = opp

    known = ~np.isnan(curve)
    xs = np.arange(100)
    curve = np.interp(xs, xs[known], curve[known])
    # Light smoothing pass.
    kernel = np.ones(5) / 5
    curve = np.convolve(np.pad(curve, 2, mode="edge"), kernel, mode="valid")

    log(f"punt model — {punts.height:,} punts · net from own 20: "
        f"opponent starts at their {100 - curve[80]:.0f}")
    return curve


def train(frames: list[pl.DataFrame], wp: WinProbability) -> FourthDownModel:
    return FourthDownModel(
        wp=wp,
        convert=_fit_conversion(frames),
        field_goal=_fit_field_goal(frames),
        punt_curve=_fit_punts(frames),
    )
