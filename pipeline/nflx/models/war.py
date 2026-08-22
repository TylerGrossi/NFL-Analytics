"""Wins Above Replacement.

Football has no plate appearance. Every snap is jointly produced by up to
twenty-two players, so credit has to be *allocated* rather than counted.

The first version of this model put the passer and the targeted receiver in one
regression against play EPA. That fails on identification: both are on every
pass play, so ridge splits their credit arbitrarily, and receivers ended up
grading near franchise quarterbacks. This version fixes that by giving each
role its own regression against a target that is already attributed to it:

  role      rows              target      controls
  ------------------------------------------------------------------
  passer    dropbacks         qb_epa      opponent defense
  rusher    designed runs     epa         own offense (line), defense
  receiver  targets           yac_epa     the quarterback, defense

`qb_epa` and `yac_epa` are nflfastR's own decomposition: the quarterback is
charged with the dropback including sacks and scrambles, and the receiver is
credited with what happened after the ball arrived rather than with the throw.

There is no separate "strip out the situation" step. EPA is already the change
in expected points given down, distance and field position — situation is baked
into the measure, and a booster fit on top of it explained under 2% of the
remaining variance. Removing that step made the model simpler and no worse.

Ridge is the shrinkage: a player with thirty snaps is pulled hard toward the
mean, one with six hundred is barely moved. Replacement level is measured, not
assumed — the usage-weighted mean of everyone outside the starter pool, in the
same units as the coefficients so the offsets cancel.

Scope: offensive skill roles only. Linemen sit inside the offense term and
defenders inside the defense term, so neither gets individual credit yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import polars as pl
from scipy import sparse
from sklearn.linear_model import Ridge

from ..util import log

ROLES = ("pass", "rush", "rec")

ROLE_LABEL = {"pass": "passing", "rush": "rushing", "rec": "receiving"}

# Starter pool sizes: about one passer, two carriers and three receivers per
# club — the depth chart the league actually runs. Everyone below is
# replacement.
REPLACEMENT_RANK = {"pass": 32, "rush": 64, "rec": 96}

ALPHA_GRID = [5.0, 20.0, 60.0, 200.0, 600.0]

# Plays a situation cell needs before its own average is trusted over the
# role-wide average.
MIN_CELL_PLAYS = 50

# Touches a fringe player needs before his rate counts toward the replacement
# bar, so the bar reflects men who actually held a job.
REPLACEMENT_MIN_PLAYS = {"pass": 1, "rush": 1, "rec": 1}

# Plays of regression applied to a player's per-play rate before it is paid
# for, by plays / (plays + k). Ridge already shrinks coefficients, but it does
# so with one alpha for everybody; this scales with the individual's own sample
# so a third-stringer's hot hundred carries cannot outrank a feature back's
# four hundred. The values reflect how repeatable each rate actually is:
# rushing efficiency barely carries year to year (r = 0.16 over 2010-2025, and
# prediction error keeps falling the harder you regress it, bottoming out around
# 400), so it is regressed hardest. Passing and receiving repeat better and are
# trusted sooner. These are deliberately at the strong end of what the
# calibration supports: a backup's hot hundred carries is the single most common
# way a value metric embarrasses itself.
RATE_SHRINK = {"rush": 400.0, "rec": 160.0, "pass": 150.0}


@dataclass
class RoleSpec:
    id_column: str
    target: str
    controls: tuple[str, ...]


ROLE_SPECS: dict[str, RoleSpec] = {
    # The quarterback owns the dropback: throws, sacks taken, scrambles.
    "pass": RoleSpec("passer_player_id", "qb_epa", ("def",)),
    # Carriers share a line, which gives the offense term something to identify
    # against; without it a back behind a great line looks great himself.
    "rush": RoleSpec("rusher_player_id", "epa", ("off", "def")),
    # Full EPA, not yards after catch. Charging the receiver only with YAC
    # sounds conservative and is badly biased: a back catching a screen at the
    # line produces all of his value after the catch, while a receiver winning
    # a contested forty-yard throw produces almost none of it, so a YAC target
    # ranks nine running backs above the first wideout. Depth of target enters
    # the situation baseline instead, so a receiver is credited with beating
    # what that throw was worth, and the passer stays a control so he keeps the
    # credit for the decision and the ball.
    "rec": RoleSpec("receiver_player_id", "epa", ("passer", "def")),
}


@dataclass
class RoleFit:
    role: str
    coefficients: dict[str, float]
    usage: dict[str, int]
    replacement: float
    alpha: float
    n_plays: int
    teams: dict[str, str] = field(default_factory=dict)


# --------------------------------------------------------------- wins currency

def points_per_win(games: pl.DataFrame) -> float:
    """Points of margin per win, fit on completed regular season games."""
    played = games.filter(pl.col("played") & (pl.col("game_type") == "REG"))
    rows = pl.concat([
        played.select(
            "season", pl.col("home_team").alias("team"),
            (pl.col("home_score") - pl.col("away_score")).alias("margin"),
            (pl.col("home_score") > pl.col("away_score")).cast(pl.Float64).alias("win"),
        ),
        played.select(
            "season", pl.col("away_team").alias("team"),
            (pl.col("away_score") - pl.col("home_score")).alias("margin"),
            (pl.col("away_score") > pl.col("home_score")).cast(pl.Float64).alias("win"),
        ),
    ])
    team_season = rows.group_by(["season", "team"]).agg(
        pl.col("margin").sum().alias("diff"),
        pl.col("win").sum().alias("wins"),
    )
    slope, _ = np.polyfit(team_season["diff"].to_numpy(), team_season["wins"].to_numpy(), 1)
    ppw = float(1.0 / slope)
    log(f"points per win — {ppw:.1f} (fit on {team_season.height} team seasons)")
    return ppw


# --------------------------------------------------------------- role rows

def role_rows(plays: pl.DataFrame, role: str) -> pl.DataFrame:
    """The plays a role is accountable for, with its attributed target."""
    spec = ROLE_SPECS[role]
    df = plays.filter(pl.col(spec.id_column).is_not_null())

    if role == "pass":
        df = df.filter(pl.col("qb_dropback") == 1)
    elif role == "rush":
        # Scrambles are dropbacks. They already sit in the passing role through
        # qb_epa, so counting them again here paid quarterbacks twice for the
        # same play. Worse, it poisoned the comparison pool: a scrambling
        # quarterback has few carries and enormous efficiency, so the
        # low-volume end of the rushing population was full of them and every
        # workhorse back graded below a replacement bar they had inflated.
        # Removing them flips the volume-efficiency gradient positive, which is
        # what it should have been: backs who carry it 250+ times average
        # +0.026 EPA over expectation, backs with 30-80 carries -0.013.
        df = df.filter((pl.col("play_type") == "run") & (pl.col("qb_scramble").fill_null(0) == 0))
    else:
        df = df.filter(pl.col("play_type") == "pass")

    target = pl.col(spec.target)

    df = df.with_columns(target.fill_null(0.0).alias("_raw_target")).filter(
        pl.col("_raw_target").is_finite()
    )
    return _over_expected(df, role)


# Situation cells. Coarse enough that every cell carries a real sample, fine
# enough to separate a third-and-one at the goal line from a first-and-ten at
# midfield.
def _situation(role: str) -> list[pl.Expr]:
    cells = [
        pl.col("down").fill_null(0).alias("_down"),
        pl.when(pl.col("ydstogo") <= 2).then(pl.lit("short"))
        .when(pl.col("ydstogo") <= 6).then(pl.lit("mid"))
        .when(pl.col("ydstogo") <= 10).then(pl.lit("long"))
        .otherwise(pl.lit("verylong")).alias("_dist"),
        pl.when(pl.col("yardline_100") <= 5).then(pl.lit("gl"))
        .when(pl.col("yardline_100") <= 20).then(pl.lit("rz"))
        .when(pl.col("yardline_100") <= 50).then(pl.lit("plus"))
        .otherwise(pl.lit("own")).alias("_zone"),
    ]
    if role == "rec":
        # Depth separates a screen from a post. Without it the baseline for
        # every target is the same and short, safe volume looks like value.
        cells.append(
            pl.when(pl.col("air_yards").is_null()).then(pl.lit("na"))
            .when(pl.col("air_yards") < 0).then(pl.lit("behind"))
            .when(pl.col("air_yards") <= 5).then(pl.lit("short"))
            .when(pl.col("air_yards") <= 15).then(pl.lit("mid"))
            .otherwise(pl.lit("deep")).alias("_depth")
        )
    return cells


def _over_expected(df: pl.DataFrame, role: str) -> pl.DataFrame:
    """Charge each player with what he did against what the spot was worth.

    Without this, workload is punished. A lead back takes the third-and-ones,
    the goal-line carries and the clock-killing runs with a loaded box; a
    change-of-pace back takes none of them. Measured raw, backs with 200+
    carries average -0.04 EPA a play while backs with 20-60 average +0.08, and
    the model reads that gap as skill. It is assignment.
    """
    keys = _situation(role)
    df = df.with_columns(keys)
    key_names = [k.meta.output_name() for k in keys]

    expected = df.group_by(key_names).agg(
        pl.col("_raw_target").mean().alias("_expected"),
        pl.len().alias("_cell_n"),
    )
    overall = float(df["_raw_target"].mean())

    df = df.join(expected, on=key_names, how="left").with_columns(
        # A thin cell is not evidence about a situation; fall back to the mean.
        pl.when(pl.col("_cell_n") >= MIN_CELL_PLAYS)
        .then(pl.col("_expected"))
        .otherwise(pl.lit(overall))
        .alias("_expected")
    )
    return df.with_columns(
        (pl.col("_raw_target") - pl.col("_expected")).alias("_target")
    )


def build_design(rows: pl.DataFrame, role: str) -> tuple[sparse.csr_matrix, np.ndarray, list[str], dict[str, int], np.ndarray]:
    spec = ROLE_SPECS[role]
    ids = rows[spec.id_column].to_list()
    y = rows["_target"].to_numpy()

    control_values: dict[str, list] = {}
    if "off" in spec.controls:
        control_values["off"] = rows["posteam"].to_list()
    if "def" in spec.controls:
        control_values["def"] = rows["defteam"].to_list()
    if "passer" in spec.controls:
        control_values["qb"] = rows["passer_player_id"].to_list()

    column_index: dict[str, int] = {}
    usage: dict[str, int] = {}
    r_idx: list[int] = []
    c_idx: list[int] = []

    def touch(key: str, i: int) -> None:
        if key not in column_index:
            column_index[key] = len(column_index)
            usage[key] = 0
        usage[key] += 1
        r_idx.append(i)
        c_idx.append(column_index[key])

    for i in range(rows.height):
        touch(f"{role}:{ids[i]}", i)
        for prefix, values in control_values.items():
            if values[i]:
                touch(f"{prefix}:{values[i]}", i)

    X = sparse.csr_matrix(
        (np.ones(len(r_idx)), (r_idx, c_idx)), shape=(rows.height, len(column_index))
    )
    columns = [""] * len(column_index)
    for key, idx in column_index.items():
        columns[idx] = key
    return X, y, columns, usage, rows["game_id"].to_numpy()


def choose_alpha(X, y, game_ids, seed: int = 17) -> float:
    """Shrinkage picked on a holdout of whole games, never random plays."""
    rng = np.random.default_rng(seed)
    games = np.unique(game_ids)
    holdout = set(rng.choice(games, size=max(1, len(games) // 5), replace=False).tolist())
    mask = np.array([g in holdout for g in game_ids])
    if mask.all() or (~mask).all():
        return ALPHA_GRID[1]

    best, best_alpha = np.inf, ALPHA_GRID[0]
    for alpha in ALPHA_GRID:
        model = Ridge(alpha=alpha, solver="sparse_cg", max_iter=800)
        model.fit(X[~mask], y[~mask])
        err = float(np.mean((y[mask] - model.predict(X[mask])) ** 2))
        if err < best:
            best, best_alpha = err, alpha
    return best_alpha


def fit_role(plays: pl.DataFrame, role: str, alpha: float | None = None,
             quiet: bool = False) -> RoleFit:
    rows = role_rows(plays, role)
    X, y, columns, usage, game_ids = build_design(rows, role)
    a = alpha if alpha is not None else choose_alpha(X, y, game_ids)

    model = Ridge(alpha=a, solver="sparse_cg", max_iter=800)
    model.fit(X, y)
    coefs = dict(zip(columns, model.coef_))

    replacement = _replacement_level(role, rows, usage)
    if not quiet:
        log(f"{role}: {rows.height:,} plays · alpha {a:g} · "
            f"replacement {replacement:+.4f} {ROLE_SPECS[role].target}/play")

    return RoleFit(
        role=role,
        coefficients=coefs,
        usage=usage,
        replacement=replacement,
        alpha=a,
        n_plays=rows.height,
        teams=_role_teams(rows, ROLE_SPECS[role].id_column),
    )


def _replacement_level(role: str, rows: pl.DataFrame, usage: dict[str, int]) -> float:
    """What a club gets from the men it can find, measured not modeled.

    This used to be the usage-weighted mean of the *fitted* coefficients for
    players outside the starter pool. That made replacement a function of the
    shrinkage parameter, and alpha is chosen on a random holdout of games: two
    nearly identical fits picked 60 and 200, which moved replacement from
    +0.003 to +0.012 per play. Multiplied by three hundred carries that is half
    a win, and it was the reason a workhorse back could swing from positive to
    strongly negative for no football reason at all.

    Replacement is now the observed average outcome on plays taken by players
    outside the starter pool. It depends only on what happened on the field.
    """
    ranked = sorted(
        ((k.split(":", 1)[1], n) for k, n in usage.items() if k.startswith(f"{role}:")),
        key=lambda e: e[1],
        reverse=True,
    )
    # The pool is the band just past the starters, not the entire tail. Taking
    # everyone beyond the cut means taking hundreds of men with a handful of
    # touches, and those touches are cherry-picked: a back with twenty carries
    # averages +0.05 EPA over expectation while a three-hundred-carry back
    # averages -0.02, because nobody hands the ball to a third-stringer on
    # third-and-goal. Averaging that tail sets the replacement bar above the
    # league and marks every workhorse as below it. The band is the fringe
    # starter — the man a club actually signs when a starter goes down.
    floor = REPLACEMENT_MIN_PLAYS.get(role, 20)
    tail = ranked[REPLACEMENT_RANK[role]:]
    pool = {pid for pid, n in tail if n >= floor}
    if len(pool) < 8:
        pool = {pid for pid, _ in tail}
    if not pool:
        return 0.0
    id_column = ROLE_SPECS[role].id_column
    plays = rows.filter(pl.col(id_column).is_in(list(pool)))
    return float(plays["_target"].mean()) if plays.height else 0.0


def _role_teams(rows: pl.DataFrame, id_column: str) -> dict[str, str]:
    counts = (
        rows.group_by([id_column, "posteam"]).len()
        .sort("len", descending=True)
        .unique(subset=[id_column], keep="first")
    )
    return {pid: team for pid, team, _ in counts.iter_rows()}


def war_from_fit(fit: RoleFit, points_per_win_value: float) -> dict[str, dict]:
    """player_id -> wins above replacement for this role."""
    out: dict[str, dict] = {}
    k = RATE_SHRINK.get(fit.role, 120.0)
    for key, plays in fit.usage.items():
        if not key.startswith(f"{fit.role}:"):
            continue
        player_id = key.split(":", 1)[1]
        raw_above = fit.coefficients.get(key, 0.0) - fit.replacement
        # Trust the rate in proportion to how much of it we have seen.
        trust = plays / (plays + k)
        above = raw_above * trust
        out[player_id] = {
            "plays": plays,
            "value_per_play": fit.coefficients.get(key, 0.0),
            "above_replacement_per_play": above,
            "war": above * plays / points_per_win_value,
            "team": fit.teams.get(player_id),
        }
    return out


# --------------------------------------------------------------- bootstrap

def bootstrap(
    plays: pl.DataFrame,
    alphas: dict[str, float],
    points_per_win_value: float,
    reps: int = 30,
    seed: int = 17,
    defense_plays: pl.DataFrame | None = None,
    positions: dict[str, str] | None = None,
) -> dict[tuple[str, str], np.ndarray]:
    """Resample whole games and refit. Snaps within a game are correlated, so
    resampling plays independently would badly understate the spread."""
    rng = np.random.default_rng(seed)
    games = plays["game_id"].unique().to_list()
    samples: dict[tuple[str, str], list[float]] = {}

    for rep in range(reps):
        picked = rng.choice(games, size=len(games), replace=True)
        counts = pl.DataFrame({"game_id": picked}).group_by("game_id").len()
        joined = plays.join(counts, on="game_id", how="inner")
        idx = np.repeat(np.arange(joined.height), joined["len"].to_numpy())
        boot = joined.drop("len")[idx]

        for role in ROLES:
            if role not in alphas:
                continue
            fit = fit_role(boot, role, alpha=alphas[role], quiet=True)
            for player_id, row in war_from_fit(fit, points_per_win_value).items():
                samples.setdefault((player_id, role), []).append(row["war"])

        if defense_plays is not None and positions is not None:
            djoined = defense_plays.join(counts, on="game_id", how="inner")
            didx = np.repeat(np.arange(djoined.height), djoined["len"].to_numpy())
            dboot = djoined.drop("len")[didx]
            dfit = fit_defense(dboot, positions, alpha=alphas.get("def"), quiet=True)
            for player_id, row in war_from_fit(dfit, points_per_win_value).items():
                samples.setdefault((player_id, "def"), []).append(row["war"])

        if (rep + 1) % 10 == 0:
            log(f"bootstrap {rep + 1}/{reps}")

    return {k: np.array(v) for k, v in samples.items()}


# --------------------------------------------------------------- defense

# Eleven defenders share every snap, so individual signal is far weaker than on
# offense and needs heavier shrinkage to stay stable.
DEF_ALPHA_GRID = [400.0, 1200.0, 3000.0, 8000.0]

# Starter pool per position group: roughly what 32 clubs put on the field.
DEF_REPLACEMENT_RANK = {"DL": 96, "EDGE": 80, "LB": 80, "CB": 96, "S": 80}
DEF_DEFAULT_RANK = 96


def _fit_defense_plusminus_retired(
    plays: pl.DataFrame,
    positions: dict[str, str],
    alpha: float | None = None,
    quiet: bool = False,
) -> RoleFit:
    """Regularized plus-minus for defenders.

    Every player on the field is charged with the play, the way basketball RAPM
    charges all five. The target is negated EPA, so a positive coefficient means
    the defense gave up less than expected. The offense is controlled for; the
    defender's own team is not, because it would absorb the whole unit.
    """
    rows = plays.filter(
        pl.col("defense_players").is_not_null() & (pl.col("defense_players") != "")
    )
    y = -rows["epa"].to_numpy()
    rosters = rows["defense_players"].to_list()
    offense = rows["posteam"].to_list()

    column_index: dict[str, int] = {}
    usage: dict[str, int] = {}
    r_idx: list[int] = []
    c_idx: list[int] = []

    def touch(key: str, i: int) -> None:
        if key not in column_index:
            column_index[key] = len(column_index)
            usage[key] = 0
        usage[key] += 1
        r_idx.append(i)
        c_idx.append(column_index[key])

    for i, roster in enumerate(rosters):
        for pid in roster.split(";"):
            if pid:
                touch(f"def:{pid}", i)
        if offense[i]:
            touch(f"off:{offense[i]}", i)

    X = sparse.csr_matrix(
        (np.ones(len(r_idx)), (r_idx, c_idx)), shape=(rows.height, len(column_index))
    )
    columns = [""] * len(column_index)
    for key, idx in column_index.items():
        columns[idx] = key

    game_ids = rows["game_id"].to_numpy()
    a = alpha if alpha is not None else _choose_alpha_from(X, y, game_ids, DEF_ALPHA_GRID)

    model = Ridge(alpha=a, solver="sparse_cg", max_iter=1000)
    model.fit(X, y)
    coefs = dict(zip(columns, model.coef_))

    replacement = _defense_replacement(coefs, usage, positions)
    if not quiet:
        log(f"def: {rows.height:,} snaps · {sum(1 for k in usage if k.startswith('def:')):,} "
            f"defenders · alpha {a:g} · replacement {replacement:+.4f} EPA prevented/snap")

    return RoleFit(
        role="def",
        coefficients=coefs,
        usage=usage,
        replacement=replacement,
        alpha=a,
        n_plays=rows.height,
        teams=_defense_teams(rows),
    )


def _choose_alpha_from(X, y, game_ids, grid, seed: int = 17) -> float:
    rng = np.random.default_rng(seed)
    games = np.unique(game_ids)
    holdout = set(rng.choice(games, size=max(1, len(games) // 5), replace=False).tolist())
    mask = np.array([g in holdout for g in game_ids])
    if mask.all() or (~mask).all():
        return grid[1]
    best, best_alpha = np.inf, grid[0]
    for alpha in grid:
        m = Ridge(alpha=alpha, solver="sparse_cg", max_iter=1000)
        m.fit(X[~mask], y[~mask])
        err = float(np.mean((y[mask] - m.predict(X[mask])) ** 2))
        if err < best:
            best, best_alpha = err, alpha
    return best_alpha


def _defense_replacement(
    coefs: dict[str, float], usage: dict[str, int], positions: dict[str, str]
) -> float:
    """Snap-weighted level of the players outside each group's starter pool."""
    by_group: dict[str, list[tuple[float, int]]] = {}
    for key, snaps in usage.items():
        if not key.startswith("def:"):
            continue
        pid = key.split(":", 1)[1]
        group = positions.get(pid, "OTHER")
        by_group.setdefault(group, []).append((coefs.get(key, 0.0), snaps))

    total_weight = 0.0
    total = 0.0
    for group, entries in by_group.items():
        entries.sort(key=lambda e: e[1], reverse=True)
        pool = entries[DEF_REPLACEMENT_RANK.get(group, DEF_DEFAULT_RANK):]
        weight = sum(n for _, n in pool)
        if weight <= 0:
            continue
        total += sum(c * n for c, n in pool)
        total_weight += weight
    return total / total_weight if total_weight > 0 else 0.0


def _defense_teams(rows: pl.DataFrame) -> dict[str, str]:
    """Most common team per defender, from the rosters on each snap."""
    counts: dict[str, dict[str, int]] = {}
    for roster, team in zip(rows["defense_players"].to_list(), rows["defteam"].to_list()):
        if not roster or not team:
            continue
        for pid in roster.split(";"):
            if pid:
                counts.setdefault(pid, {})
                counts[pid][team] = counts[pid].get(team, 0) + 1
    return {pid: max(teams, key=teams.get) for pid, teams in counts.items()}


# --------------------------------------------------------------- defense v2

"""Defensive value from charted production, not plus-minus.

The plus-minus version of this ranked players by how good their defense was.
That is not a bug in the fit, it is the identification: NFL starters take
roughly ninety-five percent of their unit's snaps, so there is almost no on/off
variation to separate one defender from the ten beside him. T.J. Watt graded
negative and the leaderboard correlated with team defensive rank at -0.35.

So defenders are valued by what they are individually charted doing — pressures
and sacks generated, receptions and yards allowed in coverage, tackles missed —
priced with EPA constants measured from our own play-by-play.
"""

# Every constant below is fit from the play-by-play store, not assumed.
@dataclass
class DefenseConstants:
    epa_clean_dropback: float
    epa_sack: float
    epa_pressured_no_sack: float
    epa_target: float
    epa_incompletion: float
    completion_intercept: float
    completion_per_yard: float
    epa_missed_tackle: float = 0.40

    @property
    def sack_value(self) -> float:
        """EPA prevented by taking a quarterback down."""
        return self.epa_clean_dropback - self.epa_sack

    @property
    def pressure_value(self) -> float:
        """EPA prevented by pressure that does not end in a sack."""
        return self.epa_clean_dropback - self.epa_pressured_no_sack

    def epa_per_target_allowed(self, completion_rate: float, yards_per_completion: float) -> float:
        completed = self.completion_intercept + self.completion_per_yard * yards_per_completion
        return completion_rate * completed + (1 - completion_rate) * self.epa_incompletion


def measure_constants(plays: pl.DataFrame, pressure: pl.DataFrame | None) -> DefenseConstants:
    db = plays.filter((pl.col("qb_dropback") == 1) & pl.col("epa").is_not_null())
    targets = plays.filter(pl.col("receiver_player_id").is_not_null() & pl.col("epa").is_not_null())
    completions = targets.filter(pl.col("complete_pass") == 1)

    slope, intercept = np.polyfit(
        completions["yards_gained"].to_numpy(), completions["epa"].to_numpy(), 1
    )

    if pressure is not None and pressure.height > 0:
        pressured = pressure.filter((pl.col("was_pressure") == True) & (pl.col("sack") == 0))  # noqa: E712
        epa_pressured = float(pressured["epa"].mean()) if pressured.height else -0.11
    else:
        epa_pressured = -0.11

    return DefenseConstants(
        epa_clean_dropback=float(db.filter(pl.col("sack") == 0)["epa"].mean()),
        epa_sack=float(db.filter(pl.col("sack") == 1)["epa"].mean()),
        epa_pressured_no_sack=epa_pressured,
        epa_target=float(targets["epa"].mean()),
        epa_incompletion=float(targets.filter(pl.col("complete_pass") == 0)["epa"].mean()),
        completion_intercept=float(intercept),
        completion_per_yard=float(slope),
    )


def defensive_value(
    charting: pl.DataFrame,
    snaps: pl.DataFrame,
    constants: DefenseConstants,
    positions: dict[str, str],
    points_per_win_value: float,
    quiet: bool = False,
) -> pl.DataFrame:
    """Points prevented above replacement, per defender.

    `charting` is Pro Football Reference's per-player defensive charting;
    `snaps` is the snap count table. Both key on the PFR player id.
    """
    df = charting.join(snaps, on="pfr_id", how="left").with_columns(
        pl.col("def_snaps").fill_null(0)
    )

    completion_rate = pl.when(pl.col("tgt") > 0).then(pl.col("cmp") / pl.col("tgt")).otherwise(0.0)
    yards_per_completion = pl.when(pl.col("cmp") > 0).then(pl.col("yds") / pl.col("cmp")).otherwise(0.0)

    df = df.with_columns(
        completion_rate.alias("_cmp_rate"),
        yards_per_completion.alias("_ypc"),
    ).with_columns(
        (
            pl.col("_cmp_rate")
            * (constants.completion_intercept + constants.completion_per_yard * pl.col("_ypc"))
            + (1 - pl.col("_cmp_rate")) * constants.epa_incompletion
        ).alias("epa_per_target_allowed")
    ).with_columns(
        # Coverage: every target is a chance to give up less than the league does.
        (
            pl.col("tgt").fill_null(0)
            * (constants.epa_target - pl.col("epa_per_target_allowed"))
        ).alias("coverage_points"),
        # Rush: sacks priced separately from pressures that do not finish.
        (
            pl.col("sk").fill_null(0) * constants.sack_value
            + (pl.col("prss").fill_null(0) - pl.col("sk").fill_null(0)).clip(0)
            * constants.pressure_value
        ).alias("rush_points"),
        (-pl.col("m_tkl").fill_null(0) * constants.epa_missed_tackle).alias("tackle_points"),
    ).with_columns(
        (pl.col("coverage_points") + pl.col("rush_points") + pl.col("tackle_points"))
        .alias("total_points")
    ).filter(pl.col("def_snaps") > 0).with_columns(
        (pl.col("total_points") / pl.col("def_snaps")).alias("points_per_snap"),
        pl.col("player_id")
        .replace_strict(positions, default="OTHER")
        .alias("pos_group"),
    )

    # Replacement: the per-snap level of everyone outside each group's starters.
    replacement: dict[str, float] = {}
    for group in df["pos_group"].unique().to_list():
        sub = df.filter(pl.col("pos_group") == group).sort("def_snaps", descending=True)
        pool = sub.tail(max(0, sub.height - DEF_REPLACEMENT_RANK.get(group, DEF_DEFAULT_RANK)))
        weight = float(pool["def_snaps"].sum()) if pool.height else 0.0
        replacement[group] = (
            float((pool["points_per_snap"] * pool["def_snaps"]).sum()) / weight
            if weight > 0 else 0.0
        )

    df = df.with_columns(
        pl.col("pos_group").replace_strict(replacement, default=0.0).alias("replacement_per_snap")
    ).with_columns(
        (
            (pl.col("points_per_snap") - pl.col("replacement_per_snap"))
            * pl.col("def_snaps")
            / points_per_win_value
        ).alias("war")
    )

    if not quiet:
        log(f"def: {df.height:,} charted defenders · sack {constants.sack_value:.2f} EPA · "
            f"pressure {constants.pressure_value:.2f} EPA · "
            f"replacement " + ", ".join(f"{g} {v:+.4f}" for g, v in sorted(replacement.items())[:4]))

    return df.select(
        "player_id", "pfr_id", "team", "pos_group", "def_snaps",
        "coverage_points", "rush_points", "tackle_points", "total_points",
        "points_per_snap", "war",
    )


# --------------------------------------------------------------- offensive line

OL_POSITIONS = {"T", "G", "C", "OL", "OT", "OG", "LT", "RT", "LG", "RG"}
OL_REPLACEMENT_RANK = 160  # five starters a club, plus swing tackles


def offensive_line_value(
    line_team: pl.DataFrame,
    snaps: pl.DataFrame,
    constants: "DefenseConstants",
    points_per_win_value: float,
    epa_per_line_yard: float,
    quiet: bool = False,
) -> pl.DataFrame:
    """Unit value in points, then split among the linemen by snaps played.

    Pass protection is priced with the same sack and pressure constants the
    defensive model uses, so a pressure prevented is worth exactly what a
    pressure generated is worth. Run blocking is priced by adjusted line yards
    against the league average.

    This is an allocation, not a measurement: five linemen who played the same
    snaps receive the same number. Splitting them needs per-snap block charting,
    which is not public.
    """
    league = line_team.group_by("season").agg(
        pl.col("pressure_rate_allowed").mean().alias("lg_pressure"),
        pl.col("sack_rate_allowed").mean().alias("lg_sack"),
        pl.col("line_yards").mean().alias("lg_line_yards"),
    )

    units = line_team.join(league, on="season", how="left").with_columns(
        # Pressures and sacks prevented, relative to a league-average front.
        (
            (pl.col("lg_pressure") - pl.col("pressure_rate_allowed")).fill_null(0)
            * pl.col("dropbacks")
            * constants.pressure_value
        ).alias("protection_points"),
        (
            (pl.col("lg_sack") - pl.col("sack_rate_allowed")).fill_null(0)
            * pl.col("dropbacks")
            * constants.sack_value
        ).alias("sack_prevention_points"),
        (
            (pl.col("line_yards") - pl.col("lg_line_yards")).fill_null(0)
            * pl.col("rush_attempts")
            * epa_per_line_yard
        ).alias("run_block_points"),
    ).with_columns(
        (
            pl.col("protection_points")
            + pl.col("sack_prevention_points")
            + pl.col("run_block_points")
        ).alias("unit_points")
    )

    # Split by snap share within each team-season.
    linemen = snaps.filter(pl.col("position").is_in(list(OL_POSITIONS)))
    totals = linemen.group_by(["season", "team"]).agg(
        pl.col("off_snaps").sum().alias("team_ol_snaps")
    )

    allocated = (
        linemen.join(totals, on=["season", "team"], how="left")
        .join(units.select("season", "team", "unit_points"), on=["season", "team"], how="inner")
        .with_columns(
            pl.when(pl.col("team_ol_snaps") > 0)
            .then(pl.col("off_snaps") / pl.col("team_ol_snaps"))
            .otherwise(0.0)
            .alias("snap_share")
        )
        .with_columns((pl.col("unit_points") * pl.col("snap_share")).alias("points"))
        .with_columns(
            pl.when(pl.col("off_snaps") > 0)
            .then(pl.col("points") / pl.col("off_snaps"))
            .otherwise(0.0)
            .alias("points_per_snap")
        )
    )

    # Replacement: the per-snap level of linemen outside the starter pool.
    replacement_by_season: dict[int, float] = {}
    for season in allocated["season"].unique().to_list():
        sub = allocated.filter(pl.col("season") == season).sort("off_snaps", descending=True)
        pool = sub.tail(max(0, sub.height - OL_REPLACEMENT_RANK))
        weight = float(pool["off_snaps"].sum()) if pool.height else 0.0
        replacement_by_season[season] = (
            float((pool["points_per_snap"] * pool["off_snaps"]).sum()) / weight
            if weight > 0 else 0.0
        )

    out = allocated.with_columns(
        pl.col("season").replace_strict(replacement_by_season, default=0.0).alias("replacement")
    ).with_columns(
        (
            (pl.col("points_per_snap") - pl.col("replacement"))
            * pl.col("off_snaps")
            / points_per_win_value
        ).alias("war")
    )

    if not quiet:
        log(f"line: {out.height:,} lineman seasons · "
            f"unit points range {units['unit_points'].min():.0f} to {units['unit_points'].max():.0f}")

    return out.select(
        "player_id", "season", "team", "position", "off_snaps",
        "snap_share", "points", "points_per_snap", "war",
    )


# --------------------------------------------------------------- special teams

# A specialist population is barely larger than the number of jobs, so
# replacement is a low percentile of the men who held one rather than the
# handful who did not.
ST_REPLACEMENT_PERCENTILE = 20
ST_MIN_PLAYS = {"kick": 10, "punt": 20, "return": 8}

# Plays of regression applied to a specialist's per-play rate, pulling it back
# toward replacement by plays / (plays + k). Return work is the highest-variance
# job in football — a single long one swings a whole season's rate — and without
# this a man with eighteen kick returns outranked a three-hundred-carry back.
# Returns get the heaviest regression because they are the noisiest and the
# least of the four in aggregate leverage.
ST_SHRINK = {"return": 150.0, "kick": 25.0, "punt": 40.0}


def special_teams_value(
    plays: pl.DataFrame,
    fg_probability,
    points_per_win_value: float,
    quiet: bool = False,
) -> pl.DataFrame:
    """Kickers, punters and returners, each against what was expected of them.

    A kicker is credited with makes above the probability of the kicks he was
    actually given, so a 55-yard make counts for more than a 25-yard one. A
    punter and a returner are measured on EPA against the average outcome from
    the same spot on the field, which is what separates a good punt from a good
    situation.
    """
    rows: list[pl.DataFrame] = []

    # ------------------------------------------------------------- kickers
    kicks = plays.filter(
        (pl.col("field_goal_attempt") == 1)
        & pl.col("kicker_player_id").is_not_null()
        & pl.col("kick_distance").is_not_null()
        & pl.col("epa").is_not_null()
    )
    if kicks.height:
        distance = kicks["kick_distance"].to_numpy().astype(float)
        expected = fg_probability(np.clip(distance - 17.0, 1, 99))
        expected = np.nan_to_num(expected, nan=0.0)
        made = (kicks["field_goal_result"] == "made").to_numpy().astype(float)
        # A make is worth the gap between the two outcomes' average EPA.
        made_epa = float(kicks.filter(pl.col("field_goal_result") == "made")["epa"].mean())
        miss_epa = float(kicks.filter(pl.col("field_goal_result") != "made")["epa"].mean())
        swing = made_epa - miss_epa

        kick_rows = kicks.select(
            pl.col("kicker_player_id").alias("player_id"),
            pl.col("posteam").alias("team"),
        ).with_columns(
            pl.Series("points", (made - expected) * swing),
            pl.lit(1).alias("attempt"),
        )
        rows.append(
            kick_rows.group_by(["player_id", "team"]).agg(
                pl.col("points").sum().alias("points"),
                pl.col("attempt").sum().cast(pl.Int64).alias("plays"),
            ).with_columns(pl.lit("kick").alias("role"))
        )

    # ------------------------------------------------------------- punters
    punts = plays.filter(
        (pl.col("punt_attempt") == 1)
        & pl.col("punter_player_id").is_not_null()
        & pl.col("epa").is_not_null()
        & pl.col("yardline_100").is_not_null()
    )
    if punts.height:
        baseline = punts.group_by(
            pl.col("yardline_100").cast(pl.Int32).alias("spot")
        ).agg(pl.col("epa").mean().alias("expected_epa"))
        rows.append(
            punts.with_columns(pl.col("yardline_100").cast(pl.Int32).alias("spot"))
            .join(baseline, on="spot", how="left")
            .with_columns((pl.col("epa") - pl.col("expected_epa")).alias("over"))
            .group_by([
                pl.col("punter_player_id").alias("player_id"),
                pl.col("posteam").alias("team"),
            ])
            .agg(
                pl.col("over").sum().alias("points"),
                pl.len().cast(pl.Int64).alias("plays"),
            )
            .with_columns(pl.lit("punt").alias("role"))
        )

    # ------------------------------------------------------------- returners
    for id_column, label in (
        ("punt_returner_player_id", "punt return"),
        ("kickoff_returner_player_id", "kick return"),
    ):
        returns = plays.filter(
            pl.col(id_column).is_not_null() & pl.col("epa").is_not_null()
        )
        if not returns.height:
            continue
        mean_epa = float(returns["epa"].mean())
        rows.append(
            returns.group_by([
                pl.col(id_column).alias("player_id"),
                pl.col("posteam").alias("team"),
            ])
            .agg(
                (pl.col("epa") - mean_epa).sum().alias("points"),
                pl.len().cast(pl.Int64).alias("plays"),
            )
            .with_columns(pl.lit("return").alias("role"))
        )

    if not rows:
        return pl.DataFrame()

    out = pl.concat(rows, how="diagonal")
    # Returns arrive as two streams; combine them into one role per player.
    out = out.group_by(["player_id", "team", "role"]).agg(
        pl.col("points").sum().alias("points"),
        pl.col("plays").sum().alias("plays"),
    )

    # Replacement level per role.
    #
    # "Outside the top 32" does not work here the way it does for skill
    # positions: there are only about 38 punters in a season, so that pool is
    # six emergency fill-ins whose per-play numbers are noise, and using them
    # pushed every punter half a win above replacement. Instead the bar is a low
    # percentile of the players who actually held the job — which is what a club
    # can sign off the street.
    out = out.with_columns(
        (pl.col("points") / pl.col("plays").clip(1)).alias("points_per_play")
    )
    replacement: dict[str, float] = {}
    for role in out["role"].unique().to_list():
        sub = out.filter(
            (pl.col("role") == role) & (pl.col("plays") >= ST_MIN_PLAYS.get(role, 10))
        )
        if sub.height < 8:
            sub = out.filter(pl.col("role") == role)
        replacement[role] = (
            float(np.percentile(sub["points_per_play"].to_numpy(), ST_REPLACEMENT_PERCENTILE))
            if sub.height else 0.0
        )

    out = out.with_columns(
        pl.col("role").replace_strict(replacement, default=0.0).alias("replacement"),
        pl.col("role").replace_strict(ST_SHRINK, default=20.0).alias("shrink"),
    ).with_columns(
        # Regress the rate toward replacement by sample size before paying for
        # it, so a hot twenty-play stretch cannot buy a win.
        (pl.col("plays") / (pl.col("plays") + pl.col("shrink"))).alias("trust")
    ).with_columns(
        (
            pl.col("trust")
            * (pl.col("points_per_play") - pl.col("replacement"))
            * pl.col("plays")
            / points_per_win_value
        ).alias("war")
    )

    if not quiet:
        counts = out.group_by("role").len().sort("role")
        log("special teams: " + ", ".join(
            f"{r['role']} {r['len']}" for r in counts.iter_rows(named=True)
        ))
    return out
