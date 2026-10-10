#!/usr/bin/env python3
"""Validate the candidate design's finite structural constraints, not win rates.

The profession enumeration assumes the declared uniform faction draw occurs
after the public profession roster is fixed. No client protocol is implemented
or inspected here. The attrition model ignores strategy, movement, combat,
resources and evidence; it conservatively permits any living target to be
sealed, and either faction to be the target of a permitted wolf finisher.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
from fractions import Fraction
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def enumerate_assignment(roster: list[str], wolves: int) -> dict[str, int]:
    """Check exact seat and profession marginals over every possible wolf set."""
    n = len(roster)
    assignments = list(itertools.combinations(range(n), wolves))
    total = math.comb(n, wolves)
    assert len(assignments) == total
    expected = Fraction(wolves, n)
    seat_counts = [0] * n
    profession_counts = {profession: 0 for profession in set(roster)}
    for assignment in assignments:
        wolf_set = set(assignment)
        for seat, profession in enumerate(roster):
            if seat in wolf_set:
                seat_counts[seat] += 1
                profession_counts[profession] += 1
    for count in seat_counts:
        assert Fraction(count, total) == expected
        assert 0 < count < total
    for profession, count in profession_counts.items():
        assert Fraction(count, total * roster.count(profession)) == expected
    return {"assignments": total, "majority": n // 2 + 1}


# (living humans, living wolves, unused human ghost votes,
#  unused wolf ghost votes, permanent finishers used, council seals used)
State = tuple[int, int, int, int, int, int]


def enumerate_attrition(config: dict, rules: dict) -> dict:
    """Enumerate abstract losses and ghost-vote use at all council windows.

    Finishers happen before the vote. Ghost voters may spend or retain a token;
    a player sealed by this vote receives a token after this vote. The number
    of eligible voters and the majority threshold are frozen before ballots.
    A removal beyond the global cap is temporary and does not change this
    abstract state. It cannot change the permanent-loss or voting bounds.
    """
    n, wolves = config["players"], config["wolves"]
    removal_cap = config["permanentRemovalCap"]
    finisher_cap = config["wolfFinisherGameCap"]
    states: set[State] = {(config["humans"], wolves, 0, 0, 0, 0)}
    chapter_states: list[int] = []
    vote_windows = 0
    solo_wolf_majority_windows = 0
    min_bodies = n
    can_seal_all_wolves = False

    for chapter in range(1, config["chapters"] + 1):
        after_finishers: set[State] = set(states)
        if chapter > 1 and config["wolfPermanentFinisher"]:
            for ah, aw, gh, gw, finishers, seals in states:
                if aw == 0 or finishers >= finisher_cap or n - ah - aw >= removal_cap:
                    continue
                if ah:
                    after_finishers.add((ah - 1, aw, gh + 1, gw, finishers + 1, seals))
                if aw:
                    after_finishers.add((ah, aw - 1, gh, gw + 1, finishers + 1, seals))

        next_states: set[State] = set()
        for ah, aw, gh, gw, finishers, seals in after_finishers:
            eligible = ah + aw + gh + gw
            threshold = eligible // 2 + 1
            vote_windows += 1
            solo_wolf_majority_windows += int(aw + gw >= threshold)
            assert eligible > 0
            assert ah + aw >= n - removal_cap
            assert finishers <= finisher_cap
            for spent_h in range(gh + 1):
                for spent_w in range(gw + 1):
                    base = (ah, aw, gh - spent_h, gw - spent_w, finishers, seals)
                    next_states.add(base)
                    if chapter == 1 or n - ah - aw >= removal_cap:
                        continue
                    if ah:
                        next_states.add((ah - 1, aw, gh - spent_h + 1, gw - spent_w, finishers, seals + 1))
                    if aw:
                        next_states.add((ah, aw - 1, gh - spent_h, gw - spent_w + 1, finishers, seals + 1))
        states = next_states
        chapter_states.append(len(states))
        for ah, aw, gh, gw, finishers, seals in states:
            assert 0 <= gh <= config["humans"] - ah
            assert 0 <= gw <= wolves - aw
            assert finishers + seals == n - ah - aw
            assert finishers + seals <= removal_cap
            assert finishers <= removal_cap - wolves
            assert seals <= chapter - 1
            min_bodies = min(min_bodies, ah + aw)
            can_seal_all_wolves |= aw == 0 and finishers == 0

    return {
        "states_per_chapter": chapter_states,
        "vote_windows": vote_windows,
        "solo_wolf_majority_windows": solo_wolf_majority_windows,
        "min_bodies": min_bodies,
        "can_seal_all_wolves_without_finishers": can_seal_all_wolves,
    }


def validate(data: dict) -> tuple[list[dict], list[str]]:
    rules = data["rules"]
    assert data["factionAssignment"] == "uniform-after-profession-selection"
    assert rules["firstChapterPermanentRemoval"] is False
    assert rules["directAlignmentScan"] is False
    assert rules["parityVictory"] is False
    assert rules["immediateAllWolvesSealedVictory"] is False
    assert rules["noImmediateEndOnParity"] is True
    assert rules["vote"] == "strict-majority-of-eligible-voters"
    assert rules["ghostVotesPerGame"] == 1
    assert rules["wolfFinisherTeamCapPerChapter"] == 1
    assert rules["wolfFinisherCost"] > rules["corruptionCost"] > 0
    assert rules["corruptionTeamCapPerChapter"] > 0
    assert rules["corruptionPerAltarCapPerChapter"] == 1
    assert rules["corruptionChannelSeconds"] == 4
    assert rules["corruptionSharedCooldownSeconds"] == 20
    assert rules["extractionHoldSeconds"] == 8
    assert rules["extractionHoldOnlyInFinalWindow"] is True
    assert rules["cleansePerChapterCap"] > 0
    assert rules["overCapContainmentSeconds"] == 20

    available_professions = {profession["id"] for profession in data["professions"]}
    assert len(available_professions) == len(data["professions"])
    forbidden_profession_keys = {"alignment", "faction", "humanOnly", "wolfOnly"}
    for profession in data["professions"]:
        assert not forbidden_profession_keys.intersection(profession)

    assert sorted(config["players"] for config in data["configs"]) == list(range(4, 11))
    reports: list[dict] = []
    warnings: list[str] = []
    for config in sorted(data["configs"], key=lambda item: item["players"]):
        n, humans, wolves = config["players"], config["humans"], config["wolves"]
        assert humans + wolves == n
        assert 1 <= wolves < humans
        assert wolves < n // 2 + 1
        assert len(config["professions"]) == n
        assert set(config["professions"]) <= available_professions

        floor = 3 if n <= 6 else 4
        assert config["permanentRemovalCap"] == n - floor
        assert config["permanentRemovalCap"] >= wolves
        assert config["chapters"] - 1 >= wolves
        assert 2 <= config["beacons"] <= config["mapNodes"] - 2
        assert config["beacons"] <= floor
        assert config["mapNodes"] > n
        assert config["darkAltars"] == (2 if n <= 8 else 3)
        assert rules["corruptionTeamCapPerChapter"] <= config["darkAltars"] * rules["corruptionPerAltarCapPerChapter"]
        assert config["guaranteedSupply"] == 2 * config["beacons"] + 2 + 2 * config["chapters"]
        assert config["moonLimit"] > config["shadowBudget"] > 0
        assert config["shadowBudget"] >= rules["wolfFinisherCost"]
        assert rules["ghostMessagesPerChapter"] >= 1

        if n <= 5:
            assert wolves == 1
            assert config["chapters"] == 3
            assert config["wolfPermanentFinisher"] is False
            assert config["wolfFinisherGameCap"] == 0
            assert "forensic" not in config["professions"]
        else:
            assert config["chapters"] == 4
            assert config["wolfPermanentFinisher"] is True
            assert config["wolfFinisherGameCap"] == config["permanentRemovalCap"] - wolves
            assert config["wolfFinisherGameCap"] <= config["chapters"] - 1

        phase_keys = ("exploreSeconds", "discussionSeconds", "voteSeconds", "draftSeconds")
        assert all(config[key] > 0 for key in (*phase_keys, "prepSeconds", "extractionSeconds"))
        assert rules["extractionHoldSeconds"] < config["extractionSeconds"]
        seconds = config["prepSeconds"] + config["chapters"] * sum(config[key] for key in phase_keys) + config["extractionSeconds"]
        assert 14 * 60 <= seconds <= 26 * 60

        assignment = enumerate_assignment(config["professions"], wolves)
        attrition = enumerate_attrition(config, rules)
        assert attrition["min_bodies"] == floor
        assert attrition["can_seal_all_wolves_without_finishers"]
        assert attrition["solo_wolf_majority_windows"] == 0

        # This is an uncontested capacity bound, not a reachable winning strategy.
        corruption_actions = min(config["shadowBudget"] // rules["corruptionCost"], rules["corruptionTeamCapPerChapter"])
        corruption_per_chapter = corruption_actions * rules["corruptionPerAction"]
        cleanse_per_chapter = rules["cleansePerChapterCap"]
        uncontested_net_moon = config["chapters"] * max(0, corruption_per_chapter - cleanse_per_chapter)
        gross_moon = config["chapters"] * corruption_per_chapter
        minimum_successful_cleanses = max(0, gross_moon - config["moonLimit"] + 1)
        assert minimum_successful_cleanses <= config["chapters"] * cleanse_per_chapter
        if uncontested_net_moon >= config["moonLimit"]:
            warnings.append(f"{n}p: uncontested moon {uncontested_net_moon} >= limit {config['moonLimit']}; actual counterplay and task costs need playtesting")
        elif minimum_successful_cleanses == config["chapters"] * cleanse_per_chapter:
            warnings.append(f"{n}p: maximum corruption requires a successful cleanse in every chapter; interruption/resource margins need playtesting")
        reports.append({
            "players": n,
            "humans": humans,
            "wolves": wolves,
            **assignment,
            "wolf_probability_per_seat": f"{wolves}/{n}",
            "profession_roster_information_bits": 0,
            "nominal_seconds": seconds,
            "nominal_minutes": round(seconds / 60, 2),
            "finisher_game_cap": config["wolfFinisherGameCap"],
            "uncontested_net_moon": uncontested_net_moon,
            "max_corruption_actions_per_chapter": corruption_actions,
            "gross_moon_without_cleanses": gross_moon,
            "minimum_successful_cleanses_under_max_corruption": minimum_successful_cleanses,
            **attrition,
        })
    return reports, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("configs", nargs="?", type=Path, default=ROOT / "design" / "configs.json")
    parser.add_argument("--json", action="store_true", help="Print machine-readable results")
    args = parser.parse_args()
    data = json.loads(args.configs.read_text(encoding="utf-8"))
    try:
        reports, warnings = validate(data)
    except (AssertionError, KeyError, TypeError, ValueError) as error:
        print(f"FAIL: structural validation: {error!r}")
        return 1
    if args.json:
        print(json.dumps({"status": "PASS", "scope": "structural model; not win-rate simulation or runtime security", "reports": reports, "warnings": warnings}, ensure_ascii=False, indent=2))
    else:
        print("PASS: all seven player-count configurations satisfy the structural model")
        print("players  H/W  draws  majority  bodies  kill_cap  duration  vote_windows")
        for report in reports:
            print(f"{report['players']:>7}  {report['humans']}/{report['wolves']}  {report['assignments']:>5}  {report['majority']:>8}  {report['min_bodies']:>6}  {report['finisher_game_cap']:>8}  {report['nominal_minutes']:>6.2f}m  {report['vote_windows']:>12}")
        print(f"Total faction draws enumerated: {sum(report['assignments'] for report in reports)}")
        print(f"Total abstract vote windows enumerated: {sum(report['vote_windows'] for report in reports)}")
        print("Solo-wolf majority windows: 0 (including retained/spent ghost-token combinations)")
        for warning in warnings:
            print(f"REVIEW: {warning}")
        print("These checks do not establish a 50% win rate, task feasibility, combat balance or protocol secrecy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
