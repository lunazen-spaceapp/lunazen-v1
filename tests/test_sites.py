"""Candidate-site machinery: shapefile reading, the nested tracer, slope maps and ROIs."""

import struct

import numpy as np
import pytest

from lunazen.geometry import south_polar_to_latlon
from lunazen.sites import CANDIDATE_SITES, read_shapefile_polygons, roi_polygons, tile_path

from conftest import needs_dems


def make_shapefile(rings):
    """Minimal ESRI polygon shapefile with one record per ring."""
    records = b""
    for n, ring in enumerate(rings, start=1):
        pts = np.asarray(ring, dtype="<f8")
        content = struct.pack("<i4d2i", 5, *pts.min(0), *pts.max(0), 1, len(pts)) + struct.pack("<i", 0) + pts.tobytes()
        records += struct.pack(">ii", n, len(content) // 2) + content
    header = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(records)) // 2) + struct.pack("<2i", 1000, 5) + b"\0" * 64
    return header + records


def test_shapefile_reader_round_trip():
    square = [(0, 0), (0, 100), (100, 100), (100, 0), (0, 0)]
    triangle = [(500, 500), (500, 700), (700, 500), (500, 500)]
    rings = read_shapefile_polygons(make_shapefile([square, triangle]))
    assert len(rings) == 2
    np.testing.assert_array_equal(rings[0], square)
    np.testing.assert_array_equal(rings[1], triangle)


def test_ray_distances_follow_the_step_rule():
    from lunazen.terrain import ray_distances

    d = ray_distances(10.0, 300_000.0, step_min_m=5.0, k=400.0)
    steps = np.diff(d)
    np.testing.assert_allclose(steps, np.maximum(5.0, d[:-1] / 400.0))
    assert d[0] == 10.0 and d[-1] >= 300_000.0
    assert len(d) < 3000  # vs 60 000 at a uniform 5 m


def test_nested_tracer_equals_band_tracer_for_a_single_dem():
    """With one DEM and a uniform step the two tracers are the same computation."""
    from test_terrain import PIXEL, SITE_X, SITE_Y, synthetic_dem

    from lunazen.terrain import DemLayer, trace_horizon, trace_horizon_nested

    dem = synthetic_dem(lambda d: 30.0 * np.sin(d / 400.0) ** 2)
    lat, lon = south_polar_to_latlon(SITE_X, SITE_Y)
    band, _, _ = trace_horizon(lat, lon, 0.0, [DemLayer(dem, 5_000.0, PIXEL, PIXEL)], 5.0, observer_height_m=2.0)
    nested, _, _ = trace_horizon_nested(lat, lon, 0.0, [dem], 5.0, observer_height_m=2.0, min_range_m=PIXEL,
                                        max_range_m=5_000.0, step_min_m=PIXEL, k=1e12)
    np.testing.assert_allclose(nested.elevation_deg, band.elevation_deg, atol=1e-9)


@needs_dems
def test_nested_tracer_step_schedule_is_accurate():
    """Distance-proportional steps (k = 400) vs uniform 5 m steps, real DEMs: < 0.05 deg."""
    from lunazen.terrain import load_geotiff, polar_dems, trace_horizon_nested

    dems = polar_dems("Site01")
    x, y = -11_100.0, -12_100.0
    lat, lon = south_polar_to_latlon(x, y)
    ground = float(dems[0].sample(np.array([x]), np.array([y]))[0])
    fast, _, _ = trace_horizon_nested(lat, lon, ground, dems, 1.0, observer_height_m=2.0)
    fine, _, _ = trace_horizon_nested(lat, lon, ground, dems, 1.0, observer_height_m=2.0, k=1e12)
    assert np.max(np.abs(fast.elevation_deg - fine.elevation_deg)) < 0.05


@needs_dems
def test_site01_slope_map_and_roi():
    from lunazen.terrain import load_geotiff

    slope = load_geotiff(tile_path("Site01", "slp"))
    values = slope.heights_m[::50, ::50]
    assert np.nanmin(values) >= 0.0 and np.nanmax(values) < 90.0
    rings = roi_polygons("Site01")
    assert len(rings) == 7  # NASA's >70 % average-illumination regions on Connecting ridge
    centre = np.vstack(rings).mean(axis=0)
    assert slope.x0_m < centre[0] < slope.x0_m + 16_000 and slope.y0_m - 16_000 < centre[1] < slope.y0_m


def test_site_table():
    ids = [s.id for s in CANDIDATE_SITES]
    assert len(ids) == len(set(ids)) == 13
    assert {s.id for s in CANDIDATE_SITES if s.has_roi} == {"Site01", "Site04", "Site07", "Site11"}


def test_artemis_regions_follow_nasa_lists_and_outlines():
    from lunazen.sites import artemis_regions

    data = artemis_regions()
    regions = {r["name"]: r for r in data["regions"]}
    # NASA, 28 Oct 2024 (and George et al., LPSC 2026): the nine regions.
    assert {n for n, r in regions.items() if "2024" in r["lists"]} == {
        "Peak near Cabeus B", "Haworth", "Malapert Massif", "Mons Mouton Plateau", "Mons Mouton",
        "Nobile Rim 1", "Nobile Rim 2", "de Gerlache Rim 2", "Slater Plain"}
    assert sum("2022" in r["lists"] for r in regions.values()) == 13
    for r in regions.values():
        assert ("2022" in r["lists"]) == (r["outlineXyM"] is not None)  # only the 2022 grids are published
        if r["outlineXyM"] is not None:
            xy = np.array(r["outlineXyM"])
            sides = np.hypot(*(np.roll(xy, -1, axis=0) - xy).T)
            # Data areas 16-30 km (Haworth 29.8 km); NASA: regions "approximately 15 x 15 km".
            assert np.all((15_000 < sides) & (sides < 30_000)), r["name"]
    assert all(url.startswith("https://") for url in data["sources"].values())


def test_web_spots_carry_their_artemis_regions():
    import json

    from lunazen.paths import ROOT
    from lunazen.sites import artemis_regions_at

    catalogue = json.loads((ROOT / "web" / "data" / "sites.json").read_text())
    for s in catalogue["spots"]:
        assert s["artemisRegions"] == artemis_regions_at(s["xM"], s["yM"])


def test_artemis_central_flag_marks_the_inner_15_km():
    from lunazen.sites import artemis_regions_at

    regions = [{"name": "square", "outlineXyM": [[-10_000, -10_000], [10_000, -10_000], [10_000, 10_000], [-10_000, 10_000]]}]
    assert artemis_regions_at(0, 0, regions) == [{"name": "square", "central": True}]
    assert artemis_regions_at(8_000, 0, regions) == [{"name": "square", "central": False}]  # 7.5 km is the edge
    assert artemis_regions_at(11_000, 0, regions) == []
