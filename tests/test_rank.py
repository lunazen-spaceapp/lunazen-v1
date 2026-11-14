"""lunazen.rank: the order of the candidate spots for one landing."""

import pytest

from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.paths import KERNELS
from lunazen.rank import order_overall, rank_spots

needs_kernels = pytest.mark.skipif(not (KERNELS / "de440s.bsp").exists(), reason="run scripts/fetch_data.sh")


def spot(id, works, within, dark, link, sun):
    return {"id": id, "works": works, "within": within,
            "metrics": {"longestDarkHours": dark, "dsnLinkFraction": link, "sunlitFraction": sun}}


def test_failing_spots_rank_below_working_ones_and_ties_keep_order():
    rows = [spot("A", False, 1.0, 10, 0.9, 0.9), spot("B", True, 0.1, 40, 0.5, 0.5), spot("C", True, 0.1, 40, 0.5, 0.5)]
    assert [s["id"] for s in order_overall(rows)] == ["B", "C", "A"]


def test_overall_order_is_nearby_points_then_night_then_contact_then_sunlight():
    rows = [spot("A", True, 0.5, 10, 0.9, 0.9), spot("B", True, 1.0, 40, 0.5, 0.5), spot("C", True, 1.0, 20, 0.5, 0.5),
            spot("D", True, 1.0, 20, 0.6, 0.5), spot("E", True, 1.0, 20, 0.6, 0.7)]
    assert [s["id"] for s in order_overall(rows)] == ["E", "D", "C", "B", "A"]


@needs_kernels
def test_rank_spots_covers_all_67_spots_and_is_consistent():
    with spice_kernels():
        et0 = utc_to_et("2027-03-01T00:00:00")
        spots = rank_spots(et0, 14 * 86400.0)
    assert len(spots) == 67 and all(s["ringTotal"] == 12 for s in spots)
    ordered = order_overall(spots)
    works = [s["works"] for s in ordered]
    assert works == sorted(works, reverse=True)  # every working spot comes before every failing one
    assert all(0.0 <= s["within"] <= 1.0 for s in spots)


@needs_kernels
def test_holding_with_a_higher_skyline_requires_working_without_it():
    with spice_kernels():
        spots = rank_spots(utc_to_et("2027-03-01T00:00:00"), 14 * 86400.0)
    assert all(s["works"] or not s["holdsRaised"] for s in spots)
    assert any(s["works"] and not s["holdsRaised"] for s in spots), "a 0.25 deg higher skyline should change at least one spot"


@needs_kernels
def test_a_smaller_miss_distance_tests_fewer_points_and_never_fewer_working_spots():
    with spice_kernels():
        et0 = utc_to_et("2027-03-01T00:00:00")
        by = {m: {s["id"]: s for s in rank_spots(et0, 14 * 86400.0, within_m=m)} for m in (0, 50, 100)}
    assert all(s["ringTotal"] == 0 and s["within"] in (0.0, 1.0) for s in by[0].values())
    assert all(s["ringTotal"] == 6 for s in by[50].values()) and all(s["ringTotal"] == 12 for s in by[100].values())
    # The ring at 50 m is part of the ring at 100 m, so a spot that works at every point within 100 m works at every point within 50 m.
    full = lambda m: {i for i, s in by[m].items() if s["works"] and s["within"] == 1.0}
    assert full(100) <= full(50) <= full(0)
