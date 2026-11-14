"""Coordinate geometry against exact, hand-derivable answers."""

import numpy as np
import pytest

from lunazen.geometry import MOON_RADIUS_M, latlon_to_south_polar, site_from_latlon, south_polar_to_latlon


def test_south_polar_projection_round_trip():
    rng = np.random.default_rng(0)
    lat = np.radians(rng.uniform(-90.0, -60.0, 1000))
    lon = np.radians(rng.uniform(0.0, 360.0, 1000))
    x, y = latlon_to_south_polar(lat, lon)
    lat2, lon2 = south_polar_to_latlon(x, y)
    np.testing.assert_allclose(lat2, np.degrees(lat), atol=1e-10)
    np.testing.assert_allclose((lon2 - np.degrees(lon) + 180) % 360 - 180, 0.0, atol=1e-9)


def test_projection_is_true_scale_at_the_pole():
    # 1 km from the pole along a meridian: rho = 2R tan(d / 2R) ~ d.
    x, y = latlon_to_south_polar(np.radians(-90.0 + np.degrees(1000.0 / MOON_RADIUS_M)), 0.0)
    assert np.hypot(x, y) == pytest.approx(1000.0, rel=1e-6)
    assert y > 0 and abs(x) < 1e-9  # 0 deg longitude points along +y


@pytest.mark.parametrize("lat, lon", [(-89.3, 203.0), (18.56, 61.81), (0.0, 0.0), (45.0, 270.0)])
def test_enu_basis_is_orthonormal_and_right_handed(lat, lon):
    s = site_from_latlon(lat, lon, 1000.0)
    basis = np.stack([s.east, s.north, s.up])
    np.testing.assert_allclose(basis @ basis.T, np.eye(3), atol=1e-14)
    np.testing.assert_allclose(np.cross(s.east, s.north), s.up, atol=1e-14)
    assert np.linalg.norm(s.position_m) == pytest.approx(MOON_RADIUS_M + 1000.0)


def test_azimuth_elevation_of_known_directions():
    s = site_from_latlon(-45.0, 30.0, 0.0)
    cases = {
        "north": (s.north, 0.0, 0.0),
        "east": (s.east, 90.0, 0.0),
        "south": (-s.north, 180.0, 0.0),
        "west": (-s.east, 270.0, 0.0),
        "zenith-ish": (s.up + 1e-9 * s.north, 0.0, 90.0),
        "30 deg up, north-east": (np.cos(np.radians(30)) * (s.north + s.east) / np.sqrt(2) + 0.5 * s.up, 45.0, 30.0),
    }
    for name, (v, az, el) in cases.items():
        got_az, got_el = s.az_el(v[None, :])
        assert got_el[0] == pytest.approx(el, abs=1e-6), name
        if el < 89.0:
            assert got_az[0] == pytest.approx(az, abs=1e-9), name
