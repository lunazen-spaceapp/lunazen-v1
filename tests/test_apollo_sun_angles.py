"""The Sun's angle during the Apollo moonwalks against the Apollo Lunar Surface Journal (validation/missions/apollo_sun_angles.py)."""

import json
import sys

import pytest

from lunazen.paths import ROOT

sys.path.insert(0, str(ROOT / "validation"))
import thresholds  # noqa: E402

PATH = ROOT / "validation" / "missions" / "apollo_sun_angles.json"
pytestmark = pytest.mark.skipif(not PATH.exists(), reason="run validation/missions/apollo_sun_angles.py")


def test_near_equator_missions_agree_within_the_sources_resolution():
    result = json.loads(PATH.read_text())
    used = [r for r in result["rows"] if r["comparable"]]
    assert {r["mission"] for r in used} == {"Apollo 11", "Apollo 12", "Apollo 14"} and len(used) == result["points"] == 10
    assert all(abs(r["differenceDeg"]) < thresholds.APOLLO_SUN_DEG for r in used)


def test_ground_elapsed_times_match_the_landing_times():
    """Each GET scale (liftoff + hours) must reproduce the published landing time, or the times are mislabelled."""
    result = json.loads(PATH.read_text())
    assert max(result["timeScaleCheckHours"].values()) < 0.2


def test_later_missions_are_marked_not_comparable():
    """Apollo 15 to 17 landed at 9 to 26 degrees from the equator, where the journal's angle is not the local elevation."""
    result = json.loads(PATH.read_text())
    skipped = {r["mission"] for r in result["rows"] if not r["comparable"]}
    assert skipped == {"Apollo 15", "Apollo 16", "Apollo 17"}
