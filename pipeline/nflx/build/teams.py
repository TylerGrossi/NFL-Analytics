"""Team reference data: identity, colors, logos."""

from __future__ import annotations

import polars as pl

from ..sources import nflverse as nv
from ..util import step, write_json, write_parquet

# nflverse keeps historical relocations in load_teams(); these are the 32 current clubs.
CURRENT = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
    "HOU", "IND", "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
}

# Codes the store still uses because nflverse labels a game with the name the
# club carried that season. They are kept out of `teams` — that table is the
# 32-club league, and drives the team index and its routes — and written
# separately so a 2015 table can still draw San Diego rather than a gray box.
HISTORIC = {"SD", "OAK", "STL"}

# ---------------------------------------------------------------- identity
#
# What a club was called and what mark it wore in a given season, where that
# differs from today. Curated by hand because no feed carries it: nflverse and
# ESPN both key a logo by club code and overwrite it at a rebrand, so the store
# has one identity per franchise and a 2015 table drew 2025's marks.
#
# `first`/`last` are inclusive season bounds. A club is only listed for the
# seasons it differed; anything not covered falls through to the current row.
# Relocations are not here — the play-by-play already labels those seasons with
# the old code (SD, OAK, STL), which `teams_historic` resolves.
#
# `logo` is a path under web/public. A null means the mark could not be sourced
# for that era and the club's current logo stands in: ESPN's 500px archive only
# reaches back to 2014, and before that it served 35px GIFs.
HISTORIC_LOGOS = "/logos/historic"

IDENTITY: list[dict] = [
    # Marks recovered from the Wayback Machine's copies of ESPN's own logo URLs
    # and checked by eye against the club's rebrand dates — a changed archive
    # digest is usually a re-encode, and twice it was ESPN swapping which mark
    # it treats as primary rather than the club changing anything.
    {"team": "CLE", "first": 1999, "last": 2014,
     "name": "Cleveland Browns", "nick": "Browns", "logo": f"{HISTORIC_LOGOS}/cle-1999.png"},
    # The Lions have had four marks since 1999; only the 2009 one is archived.
    {"team": "DET", "first": 2009, "last": 2016,
     "name": "Detroit Lions", "nick": "Lions", "logo": f"{HISTORIC_LOGOS}/det-2009.png"},
    {"team": "LAC", "first": 2017, "last": 2019,
     "name": "Los Angeles Chargers", "nick": "Chargers", "logo": f"{HISTORIC_LOGOS}/lac-2017.png"},
    # The club moved with the gold-horn ram and redrew it a year later.
    {"team": "LA", "first": 2016, "last": 2016,
     "name": "Los Angeles Rams", "nick": "Rams", "logo": f"{HISTORIC_LOGOS}/la-2016.png"},
    {"team": "LA", "first": 2017, "last": 2019,
     "name": "Los Angeles Rams", "nick": "Rams", "logo": f"{HISTORIC_LOGOS}/la-2017.png"},
    # Gold came out of the monogram for 2026, so the six seasons that wore it
    # need it pinned the same way Tennessee's flaming T does.
    {"team": "LA", "first": 2020, "last": 2025,
     "name": "Los Angeles Rams", "nick": "Rams", "logo": f"{HISTORIC_LOGOS}/la-2020.png"},
    # Tennessee rebranded for 2026, which retroactively broke every earlier
    # season: the club's ESPN URL now serves the new circular mark, so 2007
    # drew a logo that did not exist until this year. The flaming T stood from
    # the club's first season as the Titans until the change.
    {"team": "TEN", "first": 1999, "last": 2025,
     "name": "Tennessee Titans", "nick": "Titans", "logo": f"{HISTORIC_LOGOS}/ten-1999.png"},
    {"team": "NYJ", "first": 1999, "last": 2018,
     "name": "New York Jets", "nick": "Jets", "logo": f"{HISTORIC_LOGOS}/nyj-1999.png"},
    {"team": "NYJ", "first": 2019, "last": 2023,
     "name": "New York Jets", "nick": "Jets", "logo": f"{HISTORIC_LOGOS}/nyj-2019.png"},
    {"team": "WAS", "first": 1999, "last": 2019,
     "name": "Washington Redskins", "nick": "Redskins", "logo": f"{HISTORIC_LOGOS}/was-1999.png"},
    {"team": "WAS", "first": 2020, "last": 2021,
     "name": "Washington Football Team", "nick": "Football Team",
     "logo": f"{HISTORIC_LOGOS}/was-2020.png"},
]

_FIELDS = (
    pl.col("team_abbr").alias("team"),
    pl.col("team_name").alias("name"),
    pl.col("team_nick").alias("nick"),
    pl.col("team_conf").alias("conf"),
    pl.col("team_division").alias("division"),
    pl.col("team_color").alias("color"),
    pl.col("team_color2").alias("color2"),
    pl.col("team_color3").alias("color3"),
    pl.col("team_logo_espn").alias("logo"),
    pl.col("team_logo_squared").alias("logo_square"),
    pl.col("team_wordmark").alias("wordmark"),
    pl.col("team_id").alias("espn_id"),
)


def build() -> pl.DataFrame:
    with step("teams"):
        source = nv.teams().unique(subset=["team_abbr"], keep="first")

        df = source.filter(pl.col("team_abbr").is_in(CURRENT)).select(*_FIELDS).sort("team")
        write_parquet(df, "teams")
        write_json(df.to_dicts(), "teams")

        # nflverse points a relocated club's ESPN logo at the mark the franchise
        # wears now — Oakland's row resolves to the Las Vegas shield — and its
        # squared logo is a dark tile, which reads as a foreign object in a
        # table of loose marks. So these are served from the repo instead.
        #
        # Not from ESPN's live URL either: `stl.png` today is the navy ram the
        # club adopted in Los Angeles in 2017, not the gold-horn mark it wore
        # for every season it actually played in St Louis.
        historic = (
            source.filter(pl.col("team_abbr").is_in(HISTORIC))
            .select(*_FIELDS)
            .with_columns(
                pl.format(
                    HISTORIC_LOGOS + "/{}.png", pl.col("team").str.to_lowercase()
                ).alias("logo")
            )
            .sort("team")
        )
        write_parquet(historic, "teams_historic")
        write_json(historic.to_dicts(), "teams_historic")

        identity = pl.DataFrame(
            IDENTITY,
            schema={
                "team": pl.String, "first": pl.Int64, "last": pl.Int64,
                "name": pl.String, "nick": pl.String, "logo": pl.String,
            },
        ).sort(["team", "first"])
        write_parquet(identity, "team_identity")
        write_json(identity.to_dicts(), "team_identity")
        return df
