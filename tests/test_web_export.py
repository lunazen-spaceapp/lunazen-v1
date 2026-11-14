"""web/data/sites.json + horizons.bin must be a faithful copy of the site products."""

import json
import sys

import numpy as np
import pytest

from lunazen.paths import PRODUCTS, ROOT

WEB = ROOT / "web" / "data"
sys.path.insert(0, str(ROOT / "validation"))
import thresholds  # noqa: E402
pytestmark = pytest.mark.skipif(not (WEB / "sites.json").exists(), reason="run pipeline/export_web.py")


@pytest.fixture(scope="module")
def export():
    catalogue = json.loads((WEB / "sites.json").read_text())
    rows = np.frombuffer((WEB / "horizons.bin").read_bytes(), dtype="<i2").reshape(-1, catalogue["format"]["azimuths"])
    return catalogue, rows


def test_shapes_and_row_references(export):
    catalogue, rows = export
    assert rows.shape == (catalogue["format"]["rows"], 1440)
    referenced = [r for s in catalogue["spots"] for r in s["horizonRows"].values()]
    referenced += [p["horizonRow"] for s in catalogue["spots"] for p in s["ring"]]
    referenced += [m["horizonRow"] for m in catalogue["missions"]]
    referenced += [b["horizonRow"] for b in catalogue["beyond"]["sites"]]
    assert sorted(referenced) == list(range(len(rows)))  # every row used exactly once
    assert {s for site in catalogue["sites"] for s in site["spots"]} == {s["id"] for s in catalogue["spots"]}


def test_horizons_match_products_exactly(export):
    catalogue, rows = export
    npz = np.load(PRODUCTS / "candidate_sites.npz")
    for spot in catalogue["spots"]:
        for mast, row in spot["horizonRows"].items():
            i = np.flatnonzero((npz["spot"] == spot["id"]) & (npz["point"] == 0) & np.isclose(npz["mast_m"], float(mast)))
            assert len(i) == 1
            np.testing.assert_array_equal(rows[row], npz["horizon_cdeg"][i[0]])
        for k, p in enumerate(spot["ring"], start=1):
            i = np.flatnonzero((npz["spot"] == spot["id"]) & (npz["point"] == k))
            np.testing.assert_array_equal(rows[p["horizonRow"]], npz["horizon_cdeg"][i[0]])
    missions = np.load(PRODUCTS / "mission_sites.npz")
    for m in catalogue["missions"]:
        i = list(missions["id"]).index(m["id"])
        np.testing.assert_array_equal(rows[m["horizonRow"]], missions["horizon_cdeg"][i])
        assert m["source"].startswith("https://")
    beyond = np.load(PRODUCTS / "beyond_sites.npz")
    for b in catalogue["beyond"]["sites"]:
        np.testing.assert_array_equal(rows[b["horizonRow"]], beyond["horizon_cdeg"][list(beyond["id"]).index(b["id"])])
        assert b["source"].startswith("https://")  # every coordinate cites its source


def test_map_cells_are_the_brightest_nasa_pixel_in_each_block():
    """web/data/map_values.bin: each 600 m cell = max of the 10 x 10 block of NASA's 60 m map (in %)."""
    from lunazen.paths import ILLUMINATION
    from lunazen.terrain import load_pds_img

    path = ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG"
    if not path.exists():
        pytest.skip("run scripts/fetch_data.sh")
    meta = json.loads((WEB / "map.json").read_text())
    values = np.frombuffer((WEB / meta["values"]["file"]).read_bytes(), dtype=np.uint8).reshape(meta["size"], meta["size"], 2)
    nasa = load_pds_img(path)
    rng = np.random.default_rng(1)
    for row, col in rng.integers(0, meta["size"], size=(40, 2)):
        x = meta["extentM"]["x0"] + col * meta["pixelM"]
        y = meta["extentM"]["y1"] - row * meta["pixelM"]
        c0 = int(round((x - nasa.x0_m) / nasa.pixel_m))
        r0 = int(round((nasa.y0_m - y) / nasa.pixel_m))
        block = np.asarray(nasa.heights_m[r0:r0 + 10, c0:c0 + 10])
        assert values[row, col, 0] == round(float(np.nanmax(block)) * 100), (row, col)


def assert_same(actual, expected, path="evidence"):
    """Equal structure; floats within rel 1e-9 (libm differs in the last digit between platforms), everything else exact."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), path
        for key in expected:
            assert_same(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, (list, tuple)):
        assert isinstance(actual, (list, tuple)) and len(actual) == len(expected), path
        for i, (a, e) in enumerate(zip(actual, expected)):
            assert_same(a, e, f"{path}[{i}]")
    elif isinstance(expected, float) or (isinstance(actual, float) and isinstance(expected, int) and not isinstance(expected, bool)):
        assert actual == pytest.approx(expected, rel=1e-9), path
    else:
        assert actual == expected, path


def test_evidence_matches_validation_outputs():
    """web/data/evidence.json is regenerated, not edited: it must equal what the validation outputs say now."""
    import sys

    sys.path.insert(0, str(ROOT / "pipeline"))
    import export_evidence

    evidence = json.loads((WEB / "evidence.json").read_text())
    assert_same(evidence["illumination"], export_evidence.illumination(), "illumination")
    assert_same(evidence["spots"], export_evidence.spots(), "spots")
    assert_same(evidence["missions"], export_evidence.missions(), "missions")
    assert_same(evidence["barker2021"], export_evidence.barker(), "barker2021")
    assert_same(evidence["awayFromPole"], export_evidence.away_from_pole(), "awayFromPole")
    assert_same(evidence["customPoints"], export_evidence.custom_points(), "customPoints")
    assert_same(evidence["apollo"], export_evidence.apollo(), "apollo")
    assert_same(evidence["scorecard"], export_evidence.scorecard(evidence), "scorecard")
    for name in export_evidence.FIGURES:
        assert (ROOT / "web" / "figures" / name).read_bytes() == (ROOT / "docs" / "learn" / "figures" / name).read_bytes()


def test_barker2021_regions_agree_with_published_values():
    """Connecting-ridge RoIs at 1 m vs Barker et al. (2021) Fig. 19 (read by eye, ~1 pp): measured +0.3 to +1.4 pp."""
    path = ROOT / "validation" / "barker2021_comparison.json"
    if not path.exists():
        pytest.skip("run validation/compare_barker2021.py")
    summary = json.loads(path.read_text())["summary"]
    lo, hi = summary["ours_minus_fig19_1m_pp"]
    assert -thresholds.BARKER_PP < lo and hi < thresholds.BARKER_PP


def test_the_resources_page_counts_match_the_site_table_and_the_guide_thumbnail():
    """Resources says 'all 27' sites and shows page 1 of the guide: both must be what the repository holds."""
    import csv

    html = (ROOT / "web" / "resources.html").read_text()
    with (ROOT / "data" / "sites" / "site_selection.csv").open() as f:
        n = sum(1 for _ in csv.DictReader(f))
    assert f"View all {n} evaluated sites" in html
    assert (ROOT / "web" / "figures" / "guide_page1.png").read_bytes() == (ROOT / "docs" / "learn" / "guide_page1.png").read_bytes()
