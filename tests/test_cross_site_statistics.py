"""The statistics across all spots that the guides quote must match the precomputed products."""

import importlib.util
import json

import pytest

from lunazen.paths import PRODUCTS, ROOT

SUMMARY = PRODUCTS / "candidate_sites_summary.json"
RESULT = ROOT / "validation" / "cross_site_statistics.json"


def _module():
    spec = importlib.util.spec_from_file_location("cross_site_statistics", ROOT / "validation" / "cross_site_statistics.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def stats():
    if not SUMMARY.exists():
        pytest.skip("run pipeline/build_candidate_sites.py")
    return _module().compute(json.loads(SUMMARY.read_text()))


def test_pdf_year_to_year_change(stats):
    """Choice of year (Section 4): medians 0.8 and 5.7 points, at most 2.9 and 14.6; the longest night 1.0 h, up to 144 h at Site20-1."""
    change = stats["year_to_year_change"]
    assert stats["spots"] == 67
    assert [round(change["sun_points"][k], 1) for k in ("median", "max")] == [0.8, 2.9]
    assert [round(change["earth_points"][k], 1) for k in ("median", "max")] == [5.7, 14.6]
    assert change["dark_hours"]["median"] == 1.0
    assert round(change["dark_hours"]["max"]) == 144 and change["dark_hours"]["max_spot"] == "Site20-1"


def test_pdf_mast_and_landing_spread(stats):
    """Dominant inputs (Step 6): 1 m to 10 m adds 0.3 to 25 points; within 100 m the median swing is 36 points, 33% to 91% at Site01-1."""
    gain = stats["mast_1_to_10_m_sun_points"]
    assert (round(gain["min"], 1), round(gain["max"])) == (0.3, 25)
    swing = stats["within_100_m_sun_points"]
    assert round(swing["median"]) == 36
    site01 = swing["Site01-1"]
    assert (round(site01["min"]), round(site01["max"]), site01["points"]) == (33, 91, 13)


def test_no_point_survives_a_short_night(stats):
    """No spot, mast height, year or neighbouring point has a longest night within 50 h; the best is about 62 h."""
    nights = stats["shortest_longest_night"]
    assert all(v["spots_within_Blue Ghost 1"] == 0 and v["spots_within_VIPER"] == 0 for v in nights.values())
    assert min(v["hours"] for v in nights.values()) == 62.5
    every = stats["shortest_longest_night_any_point_2_m"]
    assert every["points"] == 67 * 13 * 3 and every["points_within_VIPER"] == 0 and every["hours"] == 64.75


def test_result_file_is_current(stats):
    """validation/cross_site_statistics.json is what the script prints now."""
    assert json.loads(RESULT.read_text()) == json.loads(json.dumps(stats))
