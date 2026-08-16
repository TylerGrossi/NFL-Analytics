"""The NFL tiebreaker tree.

Seeding is not "sort by record". When teams finish level the league walks a
fixed ladder, and the ladder differs for a division title versus a wild card.
Approximating it with point differential got the 2025 field wrong in four
places, all of them real ties.

Two rules that are easy to miss and change answers:

* A multi-team tie is resolved by finding the single top club, then *restarting
  the ladder from step one* for whoever is left. Eliminating from the bottom
  gives different — wrong — answers.
* In the wild card pool only one club per division is compared at a time. The
  others drop out, and re-enter once that club is seeded.

Steps below the ones implemented here (combined rankings in points scored and
allowed, net touchdowns, coin toss) are approximated by net points. They decide
a handful of cases a decade.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TeamSeason:
    team: str
    conf: str
    division: str
    wins: float = 0.0
    losses: float = 0.0
    ties: float = 0.0
    points_for: int = 0
    points_against: int = 0
    # opponent -> [win, loss, tie] counts, for head to head and common games
    vs: dict[str, list[float]] = field(default_factory=dict)
    conf_record: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    div_record: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])

    @property
    def games(self) -> float:
        return self.wins + self.losses + self.ties

    @property
    def pct(self) -> float:
        return (self.wins + 0.5 * self.ties) / self.games if self.games else 0.0

    @property
    def net_points(self) -> int:
        return self.points_for - self.points_against

    @property
    def opponents(self) -> list[str]:
        out: list[str] = []
        for opponent, (w, l, t) in self.vs.items():
            out.extend([opponent] * int(w + l + t))
        return out

    @property
    def beaten(self) -> list[str]:
        out: list[str] = []
        for opponent, (w, _l, _t) in self.vs.items():
            out.extend([opponent] * int(w))
        return out


def _pct(record: list[float]) -> float:
    total = sum(record)
    return (record[0] + 0.5 * record[2]) / total if total else 0.0


def build_records(games: list[dict], teams: dict[str, tuple[str, str]]) -> dict[str, TeamSeason]:
    """games: dicts with home_team, away_team, home_score, away_score.
    teams: team -> (conference, division)."""
    records = {
        t: TeamSeason(team=t, conf=conf, division=div) for t, (conf, div) in teams.items()
    }

    for g in games:
        home, away = g["home_team"], g["away_team"]
        if home not in records or away not in records:
            continue
        hs, as_ = g["home_score"], g["away_score"]
        if hs is None or as_ is None:
            continue

        for team, opponent, scored, allowed in (
            (home, away, hs, as_),
            (away, home, as_, hs),
        ):
            rec = records[team]
            opp = records[opponent]
            rec.points_for += scored
            rec.points_against += allowed
            rec.vs.setdefault(opponent, [0.0, 0.0, 0.0])

            result = 0 if scored > allowed else 1 if scored < allowed else 2
            rec.vs[opponent][result] += 1
            if result == 0:
                rec.wins += 1
            elif result == 1:
                rec.losses += 1
            else:
                rec.ties += 1

            if rec.conf == opp.conf:
                rec.conf_record[result] += 1
            if rec.division == opp.division:
                rec.div_record[result] += 1

    return records


# --------------------------------------------------------------- ladder steps

def _head_to_head(group: list[str], records: dict[str, TeamSeason]) -> dict[str, float]:
    """Record against the other tied clubs only."""
    out: dict[str, float] = {}
    for team in group:
        rec = [0.0, 0.0, 0.0]
        for other in group:
            if other == team:
                continue
            w, l, t = records[team].vs.get(other, [0.0, 0.0, 0.0])
            rec[0] += w
            rec[1] += l
            rec[2] += t
        out[team] = _pct(rec) if sum(rec) else -1.0
    return out


def _head_to_head_sweep(group: list[str], records: dict[str, TeamSeason]) -> dict[str, float]:
    """For three or more, head to head only counts as a clean sweep either way."""
    out: dict[str, float] = {team: 0.0 for team in group}
    for team in group:
        others = [o for o in group if o != team]
        played_all = all(sum(records[team].vs.get(o, [0, 0, 0])) > 0 for o in others)
        if not played_all:
            continue
        if all(records[team].vs[o][0] > records[team].vs[o][1] for o in others):
            out[team] = 1.0
        elif all(records[team].vs[o][1] > records[team].vs[o][0] for o in others):
            out[team] = -1.0
    return out


def _common_games(group: list[str], records: dict[str, TeamSeason], minimum: int = 4) -> dict[str, float]:
    """Record against opponents every tied club faced. Needs four or it is skipped."""
    shared = set(records[group[0]].vs)
    for team in group[1:]:
        shared &= set(records[team].vs)
    shared -= set(group)

    counts = {
        team: sum(sum(records[team].vs[o]) for o in shared if o in records[team].vs)
        for team in group
    }
    if not shared or min(counts.values()) < minimum:
        return {team: -1.0 for team in group}

    out: dict[str, float] = {}
    for team in group:
        rec = [0.0, 0.0, 0.0]
        for o in shared:
            w, l, t = records[team].vs.get(o, [0.0, 0.0, 0.0])
            rec[0] += w
            rec[1] += l
            rec[2] += t
        out[team] = _pct(rec)
    return out


def _strength(group: list[str], records: dict[str, TeamSeason], beaten_only: bool) -> dict[str, float]:
    """Combined record of opponents beaten (victory) or all faced (schedule)."""
    out: dict[str, float] = {}
    for team in group:
        names = records[team].beaten if beaten_only else records[team].opponents
        rec = [0.0, 0.0, 0.0]
        for name in names:
            opp = records.get(name)
            if opp is None:
                continue
            rec[0] += opp.wins
            rec[1] += opp.losses
            rec[2] += opp.ties
        out[team] = _pct(rec)
    return out


def _ladder(group: list[str], records: dict[str, TeamSeason], division: bool) -> list:
    """The ordered comparisons, as (name, values) pairs computed lazily."""
    multi = len(group) > 2
    steps: list[tuple[str, dict[str, float]]] = []

    if division:
        steps.append(("head to head", _head_to_head(group, records)))
        steps.append(("division record", {t: _pct(records[t].div_record) for t in group}))
        steps.append(("common games", _common_games(group, records)))
        steps.append(("conference record", {t: _pct(records[t].conf_record) for t in group}))
    else:
        steps.append((
            "head to head",
            _head_to_head_sweep(group, records) if multi else _head_to_head(group, records),
        ))
        steps.append(("conference record", {t: _pct(records[t].conf_record) for t in group}))
        steps.append(("common games", _common_games(group, records)))

    steps.append(("strength of victory", _strength(group, records, beaten_only=True)))
    steps.append(("strength of schedule", _strength(group, records, beaten_only=False)))
    steps.append(("net points", {t: float(records[t].net_points) for t in group}))
    return steps


def _best(group: list[str], records: dict[str, TeamSeason], division: bool) -> tuple[str, str]:
    """Top club in a tied group, plus the step that decided it."""
    remaining = list(group)
    for name, values in _ladder(remaining, records, division):
        top = max(values[t] for t in remaining)
        leaders = [t for t in remaining if values[t] == top]
        if len(leaders) == 1:
            return leaders[0], name
        if len(leaders) < len(remaining):
            # The ladder restarts for the clubs still level with each other.
            return _best(leaders, records, division)[0], name
    return sorted(remaining)[0], "coin toss"


def order_tied(group: list[str], records: dict[str, TeamSeason], division: bool) -> list[str]:
    """Full ordering of a tied group, restarting the ladder after each pick."""
    remaining = list(group)
    ordered: list[str] = []
    while remaining:
        if len(remaining) == 1:
            ordered.append(remaining[0])
            break
        winner, _step = _best(remaining, records, division)
        ordered.append(winner)
        remaining.remove(winner)
    return ordered


# --------------------------------------------------------------- seeding

def division_winners(records: dict[str, TeamSeason]) -> dict[str, str]:
    winners: dict[str, str] = {}
    divisions: dict[str, list[str]] = {}
    for team, rec in records.items():
        divisions.setdefault(rec.division, []).append(team)

    for division, teams in divisions.items():
        best_pct = max(records[t].pct for t in teams)
        tied = [t for t in teams if records[t].pct == best_pct]
        winners[division] = tied[0] if len(tied) == 1 else order_tied(tied, records, True)[0]
    return winners


def seed_conference(conf: str, records: dict[str, TeamSeason]) -> list[str]:
    """Seeds 1-4 are division winners; 5-7 the best of the rest."""
    in_conf = [t for t, r in records.items() if r.conf == conf]
    winners = {
        div: team
        for div, team in division_winners(records).items()
        if records[team].conf == conf
    }

    seeds = _order_pool(list(winners.values()), records, division_pool=True)
    pool = [t for t in in_conf if t not in winners.values()]
    seeds.extend(_order_pool(pool, records, division_pool=False))
    return seeds


def _order_pool(pool: list[str], records: dict[str, TeamSeason], division_pool: bool) -> list[str]:
    """Repeatedly take the best club, honouring the one-per-division rule."""
    remaining = list(pool)
    ordered: list[str] = []

    while remaining:
        best_pct = max(records[t].pct for t in remaining)
        tied = [t for t in remaining if records[t].pct == best_pct]

        if len(tied) == 1:
            winner = tied[0]
        elif division_pool:
            # Division champions are compared directly to each other.
            winner = order_tied(tied, records, False)[0]
        else:
            # Only the top club from each division is compared; the rest wait.
            by_division: dict[str, list[str]] = {}
            for team in tied:
                by_division.setdefault(records[team].division, []).append(team)
            representatives = [
                group[0] if len(group) == 1 else order_tied(group, records, True)[0]
                for group in by_division.values()
            ]
            winner = (
                representatives[0]
                if len(representatives) == 1
                else order_tied(representatives, records, False)[0]
            )

        ordered.append(winner)
        remaining.remove(winner)
    return ordered
