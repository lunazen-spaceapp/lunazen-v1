"""The yearly summaries cover every precomputed year at every point, and 2027 is unchanged."""
import json

from lunazen.mission import YEARS
from lunazen.paths import PRODUCTS


def test_every_point_has_every_year():
    summary = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())
    assert summary["method"]["years"] == list(YEARS)
    for spot in summary["spots"]:
        for p in spot["points"]:
            assert set(p["years"]) == {str(y) for y in YEARS}
            assert p["years"]["2027"]["sunlitFraction"] == p["year_2027"]["sunlitFraction"]


def test_site01_1_values_by_year():
    summary = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())
    spot = next(s for s in summary["spots"] if s["spot"] == "Site01-1")
    p = next(p for p in spot["points"] if p["offset_m"] == [0.0, 0.0] and p["mast_m"] == 2.0)
    assert [round(p["years"][str(y)]["sunlitFraction"], 3) for y in YEARS] == [0.897, 0.899, 0.897]
    assert [round(p["years"][str(y)]["longestDarkHours"]) for y in YEARS] == [138, 139, 137]
