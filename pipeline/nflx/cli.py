"""Pipeline entry point.

    python -m nflx.cli build                 # default: the full 1999+ history
    python -m nflx.cli build --seasons 2025
    python -m nflx.cli build --history 6     # shallow store for a fast dev loop
    python -m nflx.cli live                  # refresh ESPN scoreboard only
"""

from __future__ import annotations

import argparse
import datetime as dt
import json

import polars as pl

from .config import LIVE, PARQUET, PBP_SEASONS_DEFAULT
from .sources import espn
from .sources import nflverse as nv
from .build import charted as build_charted
from .build import coaches as build_coaches
from .build import contracts as build_contracts
from .build import draft as build_draft
from .build import fantasy as build_fantasy
from .build import fantasy_draft as build_fantasy_draft
from .build import fantasy_tools as build_fantasy_tools
from .build import fantasy_weekly as build_fantasy_weekly
from .build import injuries as build_injuries
from .build import espn_value as build_espn_value
from .build import coverage as build_coverage
from .build import fourth_down as build_fourth_down
from .build import games as build_games
from .build import league_ids as build_league_ids
from .build import line as build_line
from .build import market as build_market
from .build import participation as build_participation
from .build import pbp as build_pbp
from .build import gaps as build_gaps
from .build import players as build_players
from .build import snaps as build_snaps
from .build import playoffs as build_playoffs
from .build import previews as build_previews
from .build import standings as build_standings
from .build import team_season as build_team_season
from .build import teams as build_teams
from .build import trade as build_trade
from .build import war as build_war
from .util import log, step, write_json


def resolve_seasons(args) -> list[int]:
    if args.seasons:
        return sorted({int(s) for s in args.seasons})
    latest = nv.latest_played_season()
    depth = args.history or PBP_SEASONS_DEFAULT
    return list(range(latest - depth + 1, latest + 1))


def cmd_build(args) -> None:
    seasons = resolve_seasons(args)
    stats_season = nv.latest_played_season()
    upcoming = nv.scheduled_season()
    print(f"Building seasons {seasons[0]}–{seasons[-1]} "
          f"(stats season {stats_season}, scheduled {upcoming})\n")

    teams = build_teams.build()
    # Schedules cover the upcoming season too, so the app can show a real calendar.
    games = build_games.build(sorted(set(seasons) | {upcoming}))
    total_plays = build_pbp.build(seasons)
    team_season = build_team_season.build(seasons, games)
    build_standings.build(games, teams, team_season)
    index = build_players.build_index()
    player_seasons = build_players.build_seasons(seasons, index)
    # EPA is the site's headline figure, so it gets a career table of its own.
    career_epa = build_players.build_career_epa(player_seasons)
    build_players.build_weekly(seasons)
    build_snaps.build(seasons, index)
    build_fourth_down.build(seasons, games)
    build_gaps.build(seasons)
    participation = build_participation.build(seasons)
    line_team = build_line.build(seasons, participation)
    build_charted.build(seasons)
    build_war.build(seasons, games, index, line_team)
    build_playoffs.build(seasons, games, teams, team_season, upcoming)
    build_previews.build(games, team_season)
    build_market.build(games, team_season)
    # Reads the fourth-down team table written above, and the play store.
    build_coaches.build(
        seasons, games, team_season,
        pl.read_parquet(PARQUET / "fourth_down_teams.parquet"),
    )
    build_contracts.build(teams, seasons, upcoming)
    # WAR's career table is written to parquet by the step above; the draft
    # board prices picks in career EPA and keeps WAR alongside for /war.
    build_draft.build(
        seasons, index, pl.read_parquet(PARQUET / "war_career.parquet"), career_epa
    )
    # Aging curves and pick value; reads the draft table the step above writes.
    build_trade.build(
        pl.read_parquet(PARQUET / "contracts.parquet"),
        pl.read_parquet(PARQUET / "war_season.parquet"),
        player_seasons,
        index,
        pl.read_parquet(PARQUET / "draft_picks.parquet"),
        upcoming,
    )
    fantasy_season = build_fantasy.build(seasons)
    build_espn_value.build(upcoming, index)
    build_injuries.build_depth(upcoming, index)
    build_injuries.build(seasons, upcoming, index)
    build_fantasy_tools.build(upcoming, index, fantasy_season)
    board = build_fantasy_draft.build(upcoming, fantasy_season, index)
    # Reads the draft board's projections, so it has to follow it.
    build_fantasy_weekly.build(upcoming, board)
    # Bridges Sleeper/ESPN player ids to ours so a synced league can be joined.
    build_league_ids.build(index)
    build_coverage.build(seasons, index)

    with step("manifest"):
        write_json(
            {
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "stats_season": stats_season,
                "scheduled_season": upcoming,
                "seasons": seasons,
                "season_state": nv.season_state(upcoming),
                "prev_season_state": nv.season_state(stats_season),
                "coverage": {
                    "plays": int(total_plays),
                    "games": int(games.filter(pl.col("played")).height),
                    "players": int(
                        player_seasons.select(pl.col("player_id").n_unique()).item()
                    ),
                    "teams": int(teams.height),
                },
                "sources": [
                    "nflverse play-by-play", "nflverse player stats", "Next Gen Stats",
                    "Pro Football Reference advanced stats", "Over The Cap", "ESPN",
                ],
            },
            "manifest",
        )
    print("\nBuild complete.")


def cmd_live(args) -> None:
    with step("espn scoreboard"):
        payload = espn.scoreboard()
        games = espn.normalize_scoreboard(payload)
        LIVE.mkdir(parents=True, exist_ok=True)
        path = LIVE / "scoreboard.json"
        path.write_text(
            json.dumps(
                {"fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(), "games": games},
                indent=None,
            ),
            encoding="utf-8",
        )
        log(f"{len(games)} games -> {path.name}")


def cmd_inspect(args) -> None:
    """Print the shape of a built table — handy when wiring the app."""
    from .config import PARQUET

    df = pl.read_parquet(PARQUET / f"{args.table}.parquet")
    print(f"{args.table}: {df.height:,} rows x {df.width} cols")
    print(df.columns)
    print(df.head(args.rows))


def main() -> None:
    p = argparse.ArgumentParser(prog="nflx", description="NFL analytics ingestion")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="full nflverse build")
    b.add_argument("--seasons", nargs="*", help="explicit seasons, e.g. 2023 2024 2025")
    b.add_argument("--history", type=int, help=f"seasons of history (default {PBP_SEASONS_DEFAULT})")
    b.set_defaults(func=cmd_build)

    live = sub.add_parser("live", help="refresh ESPN live scoreboard")
    live.set_defaults(func=cmd_live)

    i = sub.add_parser("inspect", help="print a built table")
    i.add_argument("table")
    i.add_argument("--rows", type=int, default=5)
    i.set_defaults(func=cmd_inspect)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
