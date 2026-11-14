"""Sun-array energy (lunazen.mission.array_energy_wh_per_w): hand calculations."""

import numpy as np
import pytest

from lunazen.mission import array_energy_wh_per_w


def sun(fraction, elevation_deg):
    return {"fraction": np.asarray(fraction, float), "elevation_deg": np.asarray(elevation_deg, float)}


def test_full_sun_at_the_horizon_gives_one_watt_hour_per_hour():
    # 16 steps of 15 min = 4 h of the whole Sun at elevation 0 on a vertical array facing it: 4 Wh per W.
    assert array_energy_wh_per_w(sun(np.ones(16), np.zeros(16)), 900.0) == pytest.approx(4.0)


def test_incidence_follows_cos_of_elevation():
    assert array_energy_wh_per_w(sun([1.0], [60.0]), 3600.0) == pytest.approx(0.5)


def test_partial_disk_scales_linearly_and_dark_gives_zero():
    assert array_energy_wh_per_w(sun([0.25, 0.0], [0.0, 0.0]), 3600.0) == pytest.approx(0.25)


def test_sun_behind_the_array_collects_nothing():
    # A Sun above 90 degrees cannot occur, but cos clips at zero rather than going negative.
    assert array_energy_wh_per_w(sun([1.0], [100.0]), 3600.0) == 0.0
