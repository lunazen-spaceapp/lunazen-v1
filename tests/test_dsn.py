"""DSN station geometry against the DSN handbook (810-005 Module 301) and physical sense."""

import numpy as np
import pytest

from lunazen.dsn import STATION_UP, dsn_in_view, moon_elevations
from lunazen.kernels import utc_to_et
from lunazen.mission import longest_run_hours

from conftest import needs_kernels


def dms(d, m, s):
    return np.sign(d) * (abs(d) + m / 60 + s / 3600)


@pytest.mark.parametrize("name, lat, lon", [
    ("Goldstone", dms(35, 25, 33.24312), dms(243, 6, 37.66244)),  # DSS-14 geodetic, Module 301
    ("Canberra", dms(-35, 24, 8.72724), dms(148, 58, 52.56231)),  # DSS-43 geodetic, Module 301
])
def test_geodetic_up_matches_published_station_coordinates(name, lat, lon):
    up = STATION_UP[name]
    assert np.degrees(np.arcsin(up[2])) == pytest.approx(lat, abs=1e-5)
    assert np.degrees(np.arctan2(up[1], up[0])) % 360 == pytest.approx(lon, abs=1e-5)


@needs_kernels
def test_three_complexes_cover_the_moon_almost_continuously(spice_loaded):
    ets = np.arange(utc_to_et("2027-01-01T00:00:00"), utc_to_et("2027-03-01T00:00:00"), 600.0)
    elevations = moon_elevations(ets)
    for e in elevations.values():
        assert 0.3 < np.mean(e > 10.0) < 0.55  # each complex sees the Moon ~40% of the time
        assert e.max() < 90.0 and e.min() > -90.0
    covered = dsn_in_view(ets)
    assert covered.mean() > 0.95
    assert longest_run_hours(~covered, 600.0) < 3.0  # gaps between complexes last at most a few hours


@needs_kernels
def test_year_2027_figures_quoted_in_the_overview(spice_loaded):
    """The PDF's DSN paragraph: a complex sees the Moon 98.0% of 2027, with gaps of at most 1.5 h (15-minute grid)."""
    ets = np.arange(utc_to_et("2027-01-01T00:00:00"), utc_to_et("2028-01-01T00:00:00"), 900.0)
    covered = dsn_in_view(ets)
    assert round(100 * covered.mean(), 1) == 98.0
    assert longest_run_hours(~covered, 900.0) == 1.5
