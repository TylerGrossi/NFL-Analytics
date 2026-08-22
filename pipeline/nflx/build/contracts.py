"""Contracts and the salary cap, from Over The Cap.

`season_history` on each contract carries real year-by-year accounting — base
salary, prorated bonus, guaranteed salary and the resulting cap number — which
is what makes cut and restructure math honest rather than a guess at APY.

Two mechanics are modeled:

* **Release.** Prorated bonus for the current year and every year after it
  accelerates onto this year's cap. Guaranteed salary for the current year stays
  owed. Everything else comes off. That is a pre-June-1 cut; the post-June-1
  split is not modeled.
* **Restructure.** Base salary above the league minimum converts to signing
  bonus and spreads over the remaining years, capped at five. It creates cap
  room now and a larger bill later.
"""

from __future__ import annotations

import nflreadpy as nfl
import polars as pl

from ..util import log, round_cols, step, write_parquet

# Roughly the veteran minimum; a restructure cannot convert below it.
MINIMUM_SALARY = 1.2
MAX_PRORATION_YEARS = 5


def build(teams: pl.DataFrame, seasons: list[int], upcoming: int) -> pl.DataFrame:
    with step("contracts and cap"):
        raw = nfl.load_contracts()
        nick_to_abbr = {r["nick"]: r["team"] for r in teams.iter_rows(named=True)}

        active = raw.filter(pl.col("is_active") == True)  # noqa: E712
        log(f"{active.height:,} active contracts, "
            f"{active.filter(pl.col('gsis_id').is_not_null()).height:,} with a player id")

        # One row per contract-year. The nested struct carries its own `team`,
        # so the contract-level one is renamed before unnesting to avoid a clash.
        years = (
            active.select(
                "player", "position", "gsis_id", "otc_id",
                pl.col("team").alias("contract_team"),
                "year_signed", "years", "value", "apy", "guaranteed", "apy_cap_pct",
                "season_history",
            )
            .explode("season_history")
            .filter(pl.col("season_history").is_not_null())
            .unnest("season_history")
        )

        # `year` arrives as a string and sometimes carries a suffix like "2026*".
        years = years.with_columns(
            pl.col("year").str.extract(r"(\d{4})", 1).cast(pl.Int32).alias("season"),
        ).filter(pl.col("season").is_not_null())

        # After unnesting, `team` is the season-level club from the struct.
        years = years.with_columns(
            pl.col("team").replace_strict(nick_to_abbr, default=None).alias("team"),
            pl.col("gsis_id").alias("player_id"),
        ).filter(pl.col("team").is_not_null())

        # season_history spans a player's whole career and can list the same year
        # under both an expiring deal and its extension. Keep one row per year —
        # the largest cap number, which is the one actually on the books — and
        # drop seasons already in the past before anything is accumulated.
        years = (
            years.sort(["player_id", "season", "cap_number"], nulls_last=True)
            .unique(subset=["player_id", "season"], keep="last")
            .filter(pl.col("season") >= upcoming)
        )

        # Dead money if released: proration for this year and every year still
        # to come accelerates onto this year's cap.
        remaining_proration = (
            pl.col("prorated_bonus")
            .fill_null(0)
            .reverse()
            .cum_sum()
            .reverse()
            .over("player_id")
        )

        years = years.sort(["player_id", "season"]).with_columns(
            remaining_proration.alias("dead_if_cut_raw"),
        ).with_columns(
            (pl.col("dead_if_cut_raw") + pl.col("guaranteed_salary").fill_null(0))
            .alias("dead_if_cut"),
        ).with_columns(
            (pl.col("cap_number").fill_null(0) - pl.col("dead_if_cut")).alias("cut_savings"),
            # Restructure: convertible salary spread over the years that remain.
            (pl.col("base_salary").fill_null(0) - MINIMUM_SALARY).clip(0).alias("convertible"),
            (
                pl.len().over("player_id")
                - pl.col("season").rank("ordinal").over("player_id")
                + 1
            ).alias("years_remaining"),
        ).with_columns(
            pl.min_horizontal(pl.col("years_remaining"), pl.lit(MAX_PRORATION_YEARS))
            .alias("proration_years")
        ).with_columns(
            (
                pl.col("convertible")
                * (pl.col("proration_years") - 1)
                / pl.col("proration_years").clip(1)
            ).alias("restructure_savings")
        )

        out = years.select(
            "player_id", "otc_id", "player", "position", "team", "season",
            "year_signed", "years", "value", "apy", "guaranteed", "apy_cap_pct",
            pl.col("cap_number").alias("cap_hit"),
            "base_salary", "prorated_bonus", "guaranteed_salary",
            "dead_if_cut", "cut_savings", "restructure_savings",
            "years_remaining",
        )

        write_parquet(round_cols(out, 3), "contracts")

        # The cap itself is derivable: every contract stores its APY as a share
        # of the cap it was signed against, so apy / apy_cap_pct recovers it.
        implied = raw.filter(
            (pl.col("is_active") == True)  # noqa: E712
            & (pl.col("year_signed") == upcoming)
            & pl.col("apy_cap_pct").is_not_null()
            & (pl.col("apy_cap_pct") > 0)
        ).select((pl.col("apy") / pl.col("apy_cap_pct")).alias("cap"))
        cap_limit = float(implied["cap"].median()) if implied.height else 0.0
        log(f"{upcoming} salary cap derived at ${cap_limit:.1f}M "
            f"from {implied.height:,} contracts")

        cap = (
            out.filter(pl.col("season") == upcoming)
            .group_by("team")
            .agg(
                pl.col("cap_hit").sum().alias("committed"),
                pl.len().alias("contracts"),
                pl.col("cap_hit").filter(pl.col("cap_hit") >= 10).len().alias("big_hits"),
            )
            .with_columns(
                pl.lit(cap_limit).alias("cap_limit"),
                pl.lit(upcoming).cast(pl.Int32).alias("season"),
            )
            .with_columns((pl.col("cap_limit") - pl.col("committed")).alias("space"))
            .sort("committed", descending=True)
        )
        write_parquet(round_cols(cap, 3), "cap_summary")
        log(f"{upcoming} cap: {cap.height} teams, "
            f"median committed ${cap['committed'].median():.1f}M")
        return out
