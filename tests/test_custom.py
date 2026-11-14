"""Custom south-pole points: the exported browser grids reproduce the stored horizons and the Map's quoted accuracy."""
import json

import numpy as np
import pytest

from lunazen import custom
from lunazen.paths import PRODUCTS


@pytest.fixture(scope="module")
def grids():
    return custom.load()


def test_quantisation_round_trips_within_a_step():
    h = np.array([[-1500.07, 1500.0], [np.nan, 2210.33]])
    q, offset = custom.quantise(h, custom.CROP_SCALE_M)
    back = custom.dequantise(q, custom.CROP_SCALE_M, offset)
    assert np.isnan(back[1, 0])
    assert np.nanmax(np.abs(back - h)) <= custom.CROP_SCALE_M / 2 + 1e-9


def test_locate_finds_the_tile_a_spot_lies_in(grids):
    manifest, _, _ = grids
    spot = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())["spots"][0]
    p0 = next(p for p in spot["points"] if p["offset_m"] == [0.0, 0.0])
    assert custom.locate(manifest, p0["latitude_deg"], p0["longitude_deg"]) == spot["site"]
    assert custom.locate(manifest, -80.0, 0.0) is None


def test_trace_matches_the_stored_horizon(grids):
    manifest, far, crops = grids
    spot = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())["spots"][0]
    data = np.load(PRODUCTS / "candidate_sites.npz")
    p0 = next(p for p in spot["points"] if p["offset_m"] == [0.0, 0.0] and p["mast_m"] == 2.0)
    i = next(k for k, (s, m, p) in enumerate(zip(data["spot"], data["mast_m"], data["point"])) if (str(s), float(m), int(p)) == (spot["spot"], 2.0, 0))
    horizon, _ = custom.trace(p0["latitude_deg"], p0["longitude_deg"], spot["site"], far, crops)
    error = horizon.elevation_deg - data["horizon_cdeg"][i] / 100.0
    assert np.sqrt(np.mean(error**2)) < 0.3


def test_ring_has_twelve_points_at_50_and_100_m(grids):
    points = custom.ring_points(-89.5, 20.0)
    assert len(points) == 12
    assert sorted({round(np.hypot(*p[2])) for p in points}) == [50, 100]


def test_accuracy_in_the_manifest_comes_from_the_validation_file(grids):
    manifest, _, _ = grids
    result = json.loads((custom.ROOT / "validation" / "custom_location_accuracy.json").read_text())
    assert manifest["accuracy"] == custom.accuracy()
    assert manifest["accuracy"]["spots"] == result["spots"]
