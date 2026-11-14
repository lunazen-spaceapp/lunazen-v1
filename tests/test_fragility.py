"""A higher skyline can only shorten the Sun's time: the skyline-error measure behaves, on synthetic and real terrain."""

import numpy as np
import pytest

from lunazen.horizon import Horizon
from lunazen.kernels import utc_to_et
from lunazen.mission import STEP_S, fragility, summarize

from conftest import needs_kernels


def test_raised_horizon_adds_the_same_angle_everywhere():
    h = Horizon(np.arange(0.0, 360.0, 90.0), np.array([0.0, 1.0, -2.0, 0.5]))
    r = h.raised(0.25)
    assert r.elevation_deg.tolist() == [0.25, 1.25, -1.75, 0.75]
    assert h.elevation_deg.tolist() == [0.0, 1.0, -2.0, 0.5]  # the original is not changed
    assert r.at(45.0) == pytest.approx(h.at(45.0) + 0.25)


@needs_kernels
def test_higher_skyline_never_adds_sunlight(spice_loaded):
    from lunazen.products import candidate_spots

    site, horizon = candidate_spots(2.0)["Site01-1"]
    et0, et1 = utc_to_et("2027-03-01T00:00:00"), utc_to_et("2027-05-01T00:00:00")
    base = summarize(site, horizon, et0, et1, STEP_S)
    got = fragility(site, horizon, et0, et1, STEP_S)
    assert list(got) == ["0.1", "0.25"]
    assert got["0.1"]["sunlitFraction"] <= base["sunlitFraction"] + 1e-12
    assert got["0.25"]["sunlitFraction"] <= got["0.1"]["sunlitFraction"] + 1e-12
    assert got["0.25"]["longestDarkHours"] >= got["0.1"]["longestDarkHours"] >= base["longestDarkHours"]
