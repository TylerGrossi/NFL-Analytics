"""A callable win probability function.

nflfastR ships a `wp` value for every play that actually happened. A fourth-down
decision needs win probability for states that *didn't* happen — "what is my WP
if I convert" — so we distill those per-play values into a model we can evaluate
at arbitrary states.

This is deliberately a distillation, not an independent WP model: the target is
nflfastR's own output, so the numbers stay consistent with the EPA/WPA columns
shown everywhere else on the site. Refitting WP from scratch on game outcomes is
a later project; it would change every win-probability number at once.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import train_test_split

from ..util import log

FEATURES = [
    "score_differential",
    "game_seconds_remaining",
    "half_seconds_remaining",
    "yardline_100",
    "down",
    "ydstogo",
    "posteam_timeouts_remaining",
    "defteam_timeouts_remaining",
]


class WinProbability:
    """Wraps the fitted regressor and keeps feature order in one place."""

    def __init__(self, model: HistGradientBoostingRegressor):
        self.model = model

    def predict(self, states: np.ndarray) -> np.ndarray:
        """states: (n, len(FEATURES)) in FEATURES order. Returns WP for the
        team in possession, clipped to a sane range."""
        return np.clip(self.model.predict(states), 0.001, 0.999)

    def predict_one(self, **kwargs: float) -> float:
        row = np.array([[float(kwargs[f]) for f in FEATURES]])
        return float(self.predict(row)[0])


def train(frames: list[pl.DataFrame], seed: int = 17) -> WinProbability:
    """Fit on every play with a usable WP label."""
    df = pl.concat([f.select(FEATURES + ["wp"]) for f in frames], how="vertical")
    df = df.drop_nulls()

    X = df.select(FEATURES).to_numpy()
    y = df["wp"].to_numpy()

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.15, random_state=seed)

    model = HistGradientBoostingRegressor(
        max_iter=400,
        learning_rate=0.08,
        max_leaf_nodes=63,
        min_samples_leaf=60,
        l2_regularization=1.0,
        random_state=seed,
    )
    model.fit(X_train, y_train)

    pred = np.clip(model.predict(X_test), 0.001, 0.999)
    mae = float(np.mean(np.abs(pred - y_test)))
    r2 = float(1 - np.sum((pred - y_test) ** 2) / np.sum((y_test - y_test.mean()) ** 2))
    log(f"WP distillation — {len(y):,} plays · holdout MAE {mae:.4f} · R² {r2:.4f}")

    return WinProbability(model)
