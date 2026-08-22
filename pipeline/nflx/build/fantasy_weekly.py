"""In-season fantasy: weekly matchups, rest-of-season value, waiver targets.

The draft board answers "who do I take in August". This answers the three
questions that replace it once the season starts: who do I start this week, who
is worth the rest of the year, and who on the wire is being under-owned.

**How much a matchup is actually worth, measured rather than assumed.** The
convention in fantasy tooling is to multiply a projection by the opponent's
fantasy-points-allowed index, which asserts that the whole spread between
defenses survives into this year and into this week. It does not, twice over:

- A defense's generosity carries to the next season at a slope of about 0.23
  (QB 0.27, RB 0.30, WR 0.23, TE 0.17 over 2015–2025).
- Regressing 48,103 player weeks of actual scoring on the opponent's prior-year
  index — holding out the week being predicted from the player's own rate —
  gives a coefficient far below 1: QB 0.26, RB 0.13, WR 0.10, TE 0.09.

So the adjustment applied here is `1 + beta * (index - 1)` with those measured
betas, and the size of it is published on the page. For a 12-point-per-game
player the hardest-to-easiest swing is 2.4 points at quarterback and 0.8 at
receiver. That is a tiebreaker between close starts, not a reason to bench a
good player, and the tool says so rather than manufacturing confidence.

Once weeks are on the board the rate blends what a player has actually done
this season with his preseason projection, weighted `games / (games + 4)` — the
same shrinkage the projection model itself is fit with.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from ..models.fantasy_projection import SHRINK_GAMES
from ..sources import nflverse as nv
from ..util import log, round_cols, step, write_parquet

POSITIONS = ("QB", "RB", "WR", "TE")

# Seasons used to fit the matchup coefficient. Starts where the weekly player
# stats are complete enough to leave one week out of a player's own rate.
FIT_FROM = 2016

# A player needs this many weeks in a season before his own scoring rate is
# usable as the baseline the matchup is measured against.
MIN_WEEKS_FOR_FIT = 8

# Ownership below this is a plausible waiver claim rather than a trade target.
WAIVER_OWNED_MAX = 55.0

# Seasons used to fit weekly scoring variance.
VAR_FROM = 2018

# Weeks a player needs in a season before his own mean is a usable baseline.
VAR_MIN_WEEKS = 8


def _weekly(season: int) -> pl.DataFrame:
    """Regular-season weekly player stats, empty if that season is unpublished.

    A season with no games played yet has no file at all, which is the normal
    state of the upcoming season every August rather than an error.

    The regular-season filter matters more than it looks. The feed carries
    postseason rows under the same week numbers, and only fourteen clubs play
    them, so leaving them in gives a handful of defenses extra games in a
    "points allowed per game" average that every other defense is judged
    against.
    """
    try:
        w = nv.player_stats_weekly(season)
    except Exception as exc:
        log(f"weekly stats unavailable for {season}: {type(exc).__name__}")
        return pl.DataFrame()
    if w.height and "season_type" in w.columns:
        w = w.filter(pl.col("season_type") == "REG")
    return w


def _points_allowed(season: int) -> pl.DataFrame:
    """Fantasy points each defense gave up per game, indexed to the position."""
    w = _weekly(season)
    if w.height == 0 or "opponent_team" not in w.columns:
        return pl.DataFrame()
    per_game = (
        w.filter(pl.col("position").is_in(POSITIONS) & pl.col("opponent_team").is_not_null())
        .group_by("opponent_team", "position", "week")
        .agg(pl.col("fantasy_points_ppr").sum().alias("allowed"))
    )
    return (
        per_game.group_by("opponent_team", "position")
        .agg(pl.col("allowed").mean().alias("fpa_per_game"))
        .rename({"opponent_team": "team"})
        .with_columns(
            (pl.col("fpa_per_game") / pl.col("fpa_per_game").mean().over("position"))
            .alias("fpa_index"),
            pl.col("fpa_per_game").rank("min", descending=True).over("position")
            .cast(pl.Int32).alias("fpa_rank"),
            pl.lit(season).alias("season"),
        )
    )


def _fit_betas(season: int) -> dict[str, float]:
    """How much of the opponent index actually shows up in a player's week.

    Fit over every season the weekly feed covers, not the play-by-play window
    the rest of the build uses: this is one league-level coefficient per
    position, and it wants the longest run of data available rather than the
    six years the play store happens to hold.
    """
    frames = []
    for season in range(FIT_FROM, season):
        prior = _points_allowed(season - 1)
        if prior.height == 0:
            continue
        w = _weekly(season)
        if w.height == 0 or "opponent_team" not in w.columns:
            continue
        wk = w.filter(
            pl.col("position").is_in(POSITIONS) & pl.col("opponent_team").is_not_null()
        ).select(
            "player_id", "position", "week",
            pl.col("opponent_team").alias("opp"),
            pl.col("fantasy_points_ppr").fill_null(0).alias("pts"),
        )
        # Leave the week out of the player's own rate, or the baseline has
        # already seen the answer it is being scored against.
        wk = wk.with_columns(
            pl.col("pts").sum().over("player_id").alias("_tot"),
            pl.len().over("player_id").alias("_n"),
        ).filter(pl.col("_n") >= MIN_WEEKS_FOR_FIT)
        wk = wk.with_columns(
            ((pl.col("_tot") - pl.col("pts")) / (pl.col("_n") - 1)).alias("own_rate")
        ).filter(pl.col("own_rate") > 0)

        frames.append(
            wk.join(
                prior.select(pl.col("team").alias("opp"), "position", "fpa_index"),
                on=["opp", "position"], how="inner",
            )
        )

    if not frames:
        return {p: 0.0 for p in POSITIONS}

    all_wk = pl.concat(frames, how="diagonal")
    betas: dict[str, float] = {}
    for pos in POSITIONS:
        s = all_wk.filter(pl.col("position") == pos)
        if s.height < 500:
            betas[pos] = 0.0
            continue
        x = (s["fpa_index"] - 1.0).to_numpy()
        y = (s["pts"] / s["own_rate"]).to_numpy()
        betas[pos] = float(np.polyfit(x, y, 1)[0])
    log("matchup coefficient: " + ", ".join(f"{p} {betas[p]:.3f}" for p in POSITIONS))
    return betas


def _variance(season: int) -> pl.DataFrame:
    """How far a weekly score strays from its own projection, by position.

    A projection is a mean; a start/sit call needs the spread around it. The
    spread is strongly **heteroscedastic** — it grows with the projection — so
    a single number per position would overstate the risk on a low-projected
    player and understate it on a star.

    Fit as `sd = a + b * projection` on 38,758 player weeks from 2018, using
    each player's own leave-one-out season mean as the projection so the
    baseline cannot see the week it is being scored against. The fits are
    tight (r = 0.84 to 0.98) and the slopes say something worth knowing:
    quarterback variance barely moves with the projection while tight end
    variance scales steepest, so a projected fifteen-point quarterback is a
    far safer start than a projected fifteen-point tight end.
    """
    frames = []
    for yr in range(VAR_FROM, season):
        w = _weekly(yr)
        if w.height == 0 or "fantasy_points_ppr" not in w.columns:
            continue
        frames.append(
            w.filter(
                pl.col("position").is_in(POSITIONS)
                & pl.col("fantasy_points_ppr").is_not_null()
            ).select(
                "player_id", "position",
                pl.col("fantasy_points_ppr").alias("pts"),
                pl.lit(yr).alias("season"),
            )
        )
    if not frames:
        return pl.DataFrame()

    d = pl.concat(frames, how="diagonal").with_columns(
        pl.len().over(["player_id", "season"]).alias("n"),
        pl.col("pts").sum().over(["player_id", "season"]).alias("tot"),
    ).filter(pl.col("n") >= VAR_MIN_WEEKS)
    d = d.with_columns(
        ((pl.col("tot") - pl.col("pts")) / (pl.col("n") - 1)).alias("proj")
    ).filter(pl.col("proj") > 0)

    rows = []
    for pos in POSITIONS:
        s = d.filter(pl.col("position") == pos)
        if s.height < 500:
            continue
        # Bucket by projection, take the residual spread in each, fit a line.
        b = (
            s.with_columns((pl.col("proj") // 2).clip(0, 15).alias("bucket"))
            .group_by("bucket")
            .agg(
                pl.col("proj").mean().alias("mu"),
                (pl.col("pts") - pl.col("proj")).std().alias("sd"),
                pl.len().alias("n"),
            )
            .filter(pl.col("n") >= 150)
            .sort("mu")
        )
        if b.height < 4:
            continue
        slope, intercept = np.polyfit(b["mu"].to_numpy(), b["sd"].to_numpy(), 1)
        r = float(np.corrcoef(b["mu"].to_numpy(), b["sd"].to_numpy())[0, 1])
        rows.append({
            "position": pos, "sd_base": float(intercept), "sd_slope": float(slope),
            "fit_r": r, "player_weeks": int(s.height),
        })
    return pl.DataFrame(rows)


def _schedule(season: int) -> pl.DataFrame:
    s = nv.schedules().filter(
        (pl.col("season") == season) & (pl.col("game_type") == "REG")
    )
    if s.height == 0:
        return pl.DataFrame()
    home = s.select(
        "week", pl.col("home_team").alias("team"), pl.col("away_team").alias("opponent"),
        pl.lit(True).alias("home"),
    )
    away = s.select(
        "week", pl.col("away_team").alias("team"), pl.col("home_team").alias("opponent"),
        pl.lit(False).alias("home"),
    )
    return pl.concat([home, away]).with_columns(pl.col("week").cast(pl.Int32))


def _season_to_date(season: int) -> pl.DataFrame:
    """What players have actually scored so far this season, if anything."""
    w = _weekly(season)
    if w.height == 0 or "fantasy_points_ppr" not in w.columns:
        return pl.DataFrame(
            schema={"player_id": pl.String, "games_ytd": pl.UInt32, "ppg_ytd": pl.Float64}
        )
    played = w.filter(pl.col("fantasy_points_ppr").is_not_null())
    if played.height == 0:
        return pl.DataFrame(
            schema={"player_id": pl.String, "games_ytd": pl.UInt32, "ppg_ytd": pl.Float64}
        )
    return played.group_by("player_id").agg(
        pl.len().alias("games_ytd"),
        pl.col("fantasy_points_ppr").mean().alias("ppg_ytd"),
    )


def build(season: int, board: pl.DataFrame) -> pl.DataFrame:
    """`season` is the one being played; `board` is the draft-board projection."""
    with step("in-season fantasy"):
        if board.height == 0 or "proj_ppg" not in board.columns:
            log("no draft board to project from — in-season tools skipped")
            return pl.DataFrame()

        schedule = _schedule(season)
        prior = _points_allowed(season - 1)
        if schedule.height == 0 or prior.height == 0:
            log("no schedule or defensive baseline — in-season tools skipped")
            return pl.DataFrame()

        betas = _fit_betas(season)
        beta_df = pl.DataFrame(
            {"position": list(POSITIONS), "beta": [betas[p] for p in POSITIONS]}
        )

        # ------------------------------------------------- blended scoring rate
        ytd = _season_to_date(season)
        players = (
            board.filter(pl.col("proj_ppg").is_not_null() & pl.col("team").is_not_null())
            .select(
                "player_id", "name", "position", "team", "proj_ppg", "bye",
                "headshot", "availability", "espn_pct_owned", "depth_rank", "depth_pos",
            )
            .filter(pl.col("position").is_in(POSITIONS))
            .join(ytd, on="player_id", how="left")
            .with_columns(
                pl.col("games_ytd").fill_null(0).cast(pl.Int32),
                pl.col("ppg_ytd").cast(pl.Float64),
            )
            .with_columns(
                (pl.col("games_ytd") / (pl.col("games_ytd") + SHRINK_GAMES)).alias("trust")
            )
            .with_columns(
                (
                    pl.col("trust") * pl.col("ppg_ytd").fill_null(0.0)
                    + (1 - pl.col("trust")) * pl.col("proj_ppg")
                ).alias("rate")
            )
        )

        # ------------------------------------------------------- weekly matchups
        weekly = (
            players.join(schedule, on="team", how="inner")
            .join(
                prior.select(pl.col("team").alias("opponent"), "position",
                             "fpa_index", "fpa_rank"),
                on=["opponent", "position"], how="left",
            )
            .join(beta_df, on="position", how="left")
            .with_columns(
                (
                    1.0
                    + pl.col("beta").fill_null(0.0)
                    * (pl.col("fpa_index").fill_null(1.0) - 1.0)
                ).alias("matchup_mult")
            )
            .with_columns(
                (pl.col("rate") * pl.col("matchup_mult")).alias("proj_week"),
                pl.lit(season).alias("season"),
            )
            .select(
                "season", "player_id", "name", "position", "team", "headshot",
                "week", "opponent", "home", "fpa_index", "fpa_rank", "beta",
                "matchup_mult", "rate", "proj_week", "games_ytd", "ppg_ytd",
                "proj_ppg", "availability", "espn_pct_owned",
                "depth_rank", "depth_pos",
            )
            .sort(["week", "proj_week"], descending=[False, True])
        )
        write_parquet(round_cols(weekly, 4), "fantasy_weekly")

        # --------------------------------------------------- rest of the season
        # Byes fall out of the schedule join: a club has no row that week, so
        # nothing is summed for its players.
        ros = (
            weekly.group_by("player_id")
            .agg(
                pl.col("proj_week").sum().alias("ros_points"),
                pl.col("proj_week").mean().alias("ros_ppg"),
                pl.len().alias("games_left"),
                pl.col("matchup_mult").mean().alias("ros_matchup"),
                pl.col("name").first().alias("name"),
                pl.col("position").first().alias("position"),
                pl.col("team").first().alias("team"),
                pl.col("headshot").first().alias("headshot"),
                pl.col("games_ytd").first().alias("games_ytd"),
                pl.col("ppg_ytd").first().alias("ppg_ytd"),
                pl.col("proj_ppg").first().alias("proj_ppg"),
                pl.col("availability").first().alias("availability"),
                pl.col("espn_pct_owned").first().alias("espn_pct_owned"),
                pl.col("depth_rank").first().alias("depth_rank"),
            )
            .with_columns(
                pl.col("ros_points").rank("min", descending=True).over("position")
                .cast(pl.Int32).alias("pos_rank"),
                pl.col("ros_points").rank("min", descending=True)
                .cast(pl.Int32).alias("overall_rank"),
                pl.lit(season).alias("season"),
            )
            .sort("ros_points", descending=True)
        )
        write_parquet(round_cols(ros, 3), "fantasy_ros")

        # ------------------------------------------------------- waiver targets
        # The gap between what a player is worth from here and how widely he is
        # held. Preseason this reads off ownership alone; once weeks are played
        # the rate carries actual usage and the list becomes a real wire scan.
        owned = ros.filter(
            pl.col("espn_pct_owned").is_not_null()
            & (pl.col("espn_pct_owned") <= WAIVER_OWNED_MAX)
        )
        if owned.height:
            waivers = (
                owned.with_columns(
                    (
                        pl.col("ros_points").rank("average").over("position")
                        / pl.len().over("position")
                    ).alias("value_pct"),
                    (pl.col("espn_pct_owned") / 100.0).alias("owned_pct"),
                )
                .with_columns((pl.col("value_pct") - pl.col("owned_pct")).alias("wire_gap"))
                .sort("wire_gap", descending=True)
            )
            write_parquet(round_cols(waivers, 3), "fantasy_waivers")
            log(f"{waivers.height} wire candidates at or below {WAIVER_OWNED_MAX:.0f}% owned")

        var = _variance(season)
        if var.height:
            write_parquet(round_cols(var, 4), "fantasy_variance")
            for r in var.iter_rows(named=True):
                log(f"  {r['position']} weekly sd = {r['sd_base']:.2f} "
                    f"+ {r['sd_slope']:.3f} x projection (r={r['fit_r']:.2f})")

        played_weeks = int(weekly["games_ytd"].max() or 0)
        log(
            f"{weekly.height:,} player weeks across {weekly['week'].n_unique()} weeks · "
            f"{ros.height} players ranked · "
            + ("preseason, rates are projections"
               if played_weeks == 0
               else f"{played_weeks} weeks played, rates blended")
        )
        return ros
