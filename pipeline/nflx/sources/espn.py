"""ESPN's undocumented public API.

Used for things nflverse does not carry: live in-game state, drive detail,
news, venue/broadcast metadata and team logos at multiple resolutions.

There is no SLA here. Every call is wrapped so a failure degrades to None
rather than taking a build down, and responses are cached on disk.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests

from ..config import CACHE

SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
CDN = "https://cdn.espn.com/core/nfl"
FANTASY = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons"

# Identify honestly, but without a `name/version` token: ESPN's edge 403s any
# unrecognised agent carrying one, so "hashmark-analytics/0.1 (…)" was being
# refused on every endpoint while the same string minus a version is served.
# Verified deterministic — 4/4 refusals with the version, 4/4 responses without.
HEADERS = {"User-Agent": "gridiron-analytics (personal project)"}
TIMEOUT = 20


def _get(url: str, params: dict | None = None, cache_key: str | None = None,
         ttl: int = 0) -> Any | None:
    """GET JSON with optional on-disk caching. Returns None on any failure."""
    cache_path: Path | None = None
    if cache_key:
        cache_path = CACHE / f"espn_{cache_key}.json"
        if cache_path.exists() and (ttl == 0 or time.time() - cache_path.stat().st_mtime < ttl):
            try:
                return json.loads(cache_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except (requests.RequestException, json.JSONDecodeError) as exc:
        print(f"  ! espn {url} failed: {exc}", flush=True)
        return None
    if cache_path is not None:
        cache_path.write_text(json.dumps(data), encoding="utf-8")
    return data


# ----------------------------------------------------------------- endpoints

def scoreboard(dates: str | None = None, week: int | None = None,
               season: int | None = None, season_type: int = 2) -> Any | None:
    """Live/completed games. `dates` is YYYYMMDD or YYYYMMDD-YYYYMMDD."""
    params: dict[str, Any] = {"limit": 100}
    if dates:
        params["dates"] = dates
    if week:
        params["week"] = week
    if season:
        params["seasontype"] = season_type
        params["year"] = season
    return _get(f"{SITE}/scoreboard", params)


def summary(event_id: str) -> Any | None:
    """Full game detail: drives, plays, box score, leaders, win probability."""
    return _get(f"{SITE}/summary", {"event": event_id})


def standings(season: int) -> Any | None:
    return _get(
        f"{CDN}/standings",
        {"xhr": 1, "season": season},
        cache_key=f"standings_{season}",
        ttl=3600,
    )


def teams_list() -> Any | None:
    return _get(f"{SITE}/teams", cache_key="teams", ttl=86400)


def team_detail(team_id: str | int) -> Any | None:
    return _get(f"{SITE}/teams/{team_id}", cache_key=f"team_{team_id}", ttl=86400)


def team_roster(team_id: str | int) -> Any | None:
    return _get(f"{SITE}/teams/{team_id}/roster", cache_key=f"roster_{team_id}", ttl=86400)


def athlete(espn_id: str | int) -> Any | None:
    """Player bio, headshot and current team."""
    return _get(
        f"{CORE}/athletes/{espn_id}",
        cache_key=f"athlete_{espn_id}",
        ttl=86400 * 7,
    )


def news(limit: int = 30) -> Any | None:
    return _get(f"{SITE}/news", {"limit": limit})


# ----------------------------------------------------------------- shaping

def normalize_scoreboard(payload: Any) -> list[dict]:
    """Flatten an ESPN scoreboard into the shape the app renders."""
    if not payload:
        return []
    out: list[dict] = []
    for ev in payload.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        status = (ev.get("status") or {}).get("type", {})
        teams: dict[str, dict] = {}
        for c in comp.get("competitors", []):
            side = c.get("homeAway", "home")
            team = c.get("team", {})
            teams[side] = {
                "abbr": team.get("abbreviation"),
                "name": team.get("displayName"),
                "logo": team.get("logo"),
                "color": f"#{team['color']}" if team.get("color") else None,
                "score": int(c["score"]) if str(c.get("score", "")).isdigit() else None,
                "record": next(
                    (r.get("summary") for r in c.get("records", []) if r.get("type") == "total"),
                    None,
                ),
                "winner": c.get("winner"),
            }
        situation = comp.get("situation") or {}
        out.append({
            "id": ev.get("id"),
            "date": ev.get("date"),
            "week": (payload.get("week") or {}).get("number"),
            "state": status.get("state"),            # pre | in | post
            "detail": status.get("shortDetail"),
            "period": (ev.get("status") or {}).get("period"),
            "clock": (ev.get("status") or {}).get("displayClock"),
            "venue": (comp.get("venue") or {}).get("fullName"),
            "broadcast": next(
                (b.get("names", [None])[0] for b in comp.get("broadcasts", [])), None
            ),
            "home": teams.get("home"),
            "away": teams.get("away"),
            "down_distance": situation.get("downDistanceText"),
            "possession": situation.get("possession"),
            "last_play": (situation.get("lastPlay") or {}).get("text"),
        })
    return out


# ESPN's own position ids, which do not match anybody else's.
FANTASY_POSITIONS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}


def fantasy_players(season: int) -> list[dict] | None:
    """ESPN's own draft ranks and league-wide ADP for a fantasy season.

    This is what an ESPN league shows its drafters by default, which is the
    reason it is worth having separately from a consensus ranking: it is not
    another opinion, it is the behaviour of the room you are drafting against.

    The endpoint ignores the limit in the filter and returns every player, so
    the caller filters. Ranks are absent for players ESPN does not rank at all.
    """
    filt = json.dumps(
        {"players": {"limit": 5000,
                     "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "PPR"}}}
    )
    url = f"{FANTASY}/{season}/players?view=kona_player_info"
    try:
        r = requests.get(
            url,
            headers={**HEADERS, "x-fantasy-filter": filt},
            timeout=90,
        )
        r.raise_for_status()
        payload = r.json()
    except (requests.RequestException, json.JSONDecodeError) as exc:
        print(f"  espn fantasy ranks unavailable: {exc!r}")
        return None
    return payload if isinstance(payload, list) else payload.get("players")
