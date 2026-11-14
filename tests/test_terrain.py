"""Horizon tracing: exact answers on synthetic terrain, then the real DEMs."""

import numpy as np
import pytest

from lunazen.geometry import MOON_RADIUS_M as R
from lunazen.geometry import south_polar_to_latlon
from lunazen.terrain import DemLayer, PolarDem, trace_horizon

from conftest import needs_dems

SITE_X, SITE_Y = -10_000.0, -10_000.0  # a point ~14 km from the pole
PIXEL = 5.0


def synthetic_dem(height_fn, half=6_000.0):
    """5 m polar grid centred on the test site; height_fn(distance_from_site_m) -> m."""
    n = int(2 * half / PIXEL)
    cols = SITE_X - half + (np.arange(n) + 0.5) * PIXEL
    rows = SITE_Y + half - (np.arange(n) + 0.5) * PIXEL
    xx, yy = np.meshgrid(cols, rows)
    heights = height_fn(np.hypot(xx - SITE_X, yy - SITE_Y))
    return PolarDem(heights, SITE_X - half, SITE_Y + half, PIXEL, "synthetic")


def trace(dem, observer_height, max_range=5_500.0):
    lat, lon = south_polar_to_latlon(SITE_X, SITE_Y)
    layer = DemLayer(dem, max_range, PIXEL, min_range_m=PIXEL, method="nearest")
    horizon, distance, _ = trace_horizon(lat, lon, 0.0, [layer], 5.0, observer_height_m=observer_height)
    return horizon.elevation_deg, distance


def test_smooth_sphere_gives_the_geometric_dip():
    """On a bare sphere the horizon is the tangent ray: dip = -arccos(R / (R + h))."""
    h = 2.0
    elevation, distance = trace(synthetic_dem(lambda d: np.zeros_like(d)), h)
    dip = -np.degrees(np.arccos(R / (R + h)))
    np.testing.assert_allclose(elevation, dip, atol=2e-4)
    # The tangent point is sqrt(2 R h) ~ 2.6 km away.
    np.testing.assert_allclose(distance, np.sqrt(2 * R * h), atol=20.0)


def test_circular_wall_matches_the_curvature_formula():
    """A 100 m wall starting 2 km away: angle = atan2((R+H) cos d - r0, (R+H) sin d) at its near edge."""
    H, d1, d2, h = 100.0, 2_000.0, 2_200.0, 2.0
    elevation, distance = trace(synthetic_dem(lambda d: np.where((d >= d1) & (d < d2), H, 0.0)), h)
    delta = d1 / R
    expected = np.degrees(np.arctan2((R + H) * np.cos(delta) - (R + h), (R + H) * np.sin(delta)))
    np.testing.assert_allclose(elevation, expected, atol=0.01)  # 5 m sampling of the edge ~ 0.007 deg
    np.testing.assert_allclose(distance, d1, atol=2 * PIXEL)


def test_curvature_hides_a_distant_wall_below_a_near_one():
    """Two equal walls: the far one subtends a smaller angle, so the near one sets the horizon."""
    near = (lambda d: np.where((d >= 1_000) & (d < 1_050), 50.0, 0.0))
    both = (lambda d: near(d) + np.where((d >= 5_000) & (d < 5_050), 50.0, 0.0))
    e_near, _ = trace(synthetic_dem(near), 2.0)
    e_both, dist = trace(synthetic_dem(both), 2.0)
    np.testing.assert_allclose(e_both, e_near, atol=1e-12)
    np.testing.assert_allclose(dist, 1_000.0, atol=2 * PIXEL)


@needs_dems
def test_lola_grids_agree_with_the_site01_tile():
    """Independent check of projection, orientation and height datum across three DEMs."""
    from lunazen.terrain import polar_dems

    fine, lola20, lola80 = polar_dems("Site01")
    rng = np.random.default_rng(0)
    x, y = rng.uniform(-18_500, -3_500, 2000), rng.uniform(-19_500, -4_500, 2000)
    reference = fine.sample(x, y)
    for dem in (lola20, lola80):
        diff = dem.sample(x, y) - reference
        assert abs(np.nanmedian(diff)) < 1.0
        assert np.sqrt(np.nanmean((diff - np.nanmedian(diff)) ** 2)) < 3.0
        # A flipped or swapped orientation disagrees by hundreds of metres.
        assert np.nanmedian(np.abs(dem.sample(x, -y) - reference)) > 100.0
