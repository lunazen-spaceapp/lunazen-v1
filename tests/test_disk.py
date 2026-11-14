"""Disk fractions, run lengths, windows and the landing planner against hand calculations."""

import numpy as np
import pytest

from lunazen.disk import disk_fraction
from lunazen.horizon import Horizon
from lunazen.mission import longest_run_hours, windows


@pytest.mark.parametrize("offset", [-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3])
def test_disk_fraction_equals_circular_segment_area(offset):
    """Flat horizon at 0 deg, disk centre at `offset`: visible fraction = segment area / disk area."""
    r = 0.27
    d = np.clip(-offset / r, -1.0, 1.0)  # horizon height in disk radii
    exact = (np.arccos(d) - d * np.sqrt(1 - d * d)) / np.pi
    assert disk_fraction(180.0, offset, r, Horizon.flat(), columns=256)[0] == pytest.approx(exact, abs=2e-3)


def test_disk_fraction_sees_a_notch_in_the_horizon():
    """A 1 deg-wide gap in a 2 deg wall lets exactly the part of the disk inside the gap through."""
    az = np.arange(36000) / 100.0
    horizon = Horizon(az, np.where(np.abs(az - 180.0) < 0.1, -5.0, 2.0))
    frac = disk_fraction(180.0, 0.0, 0.25, horizon, columns=2000)[0]
    # The interpolated horizon crosses the disk's centre line (0 deg) at the gap's effective edge.
    fine = np.linspace(180.0, 180.2, 200_001)
    half_width = fine[np.argmax(horizon.at(fine) >= 0.0)] - 180.0
    u = half_width / 0.25  # gap half-width in disk radii
    exact = (2 / np.pi) * (u * np.sqrt(1 - u * u) + np.arcsin(u))  # area of the central strip / pi
    assert frac == pytest.approx(exact, abs=0.005)


def test_longest_run():
    assert longest_run_hours(np.array([0, 1, 1, 0, 1, 1, 1, 0], bool), 1800.0) == 1.5
    assert longest_run_hours(np.zeros(4, bool), 3600.0) == 0.0


def test_windows():
    ets = np.arange(8) * 10.0
    assert windows(ets, [0, 1, 1, 0, 1, 1, 1, 0]) == [(10.0, 20.0), (40.0, 60.0)]
    assert windows(ets, [1, 1, 0, 0, 0, 0, 0, 1]) == [(0.0, 10.0), (70.0, 70.0)]
    assert windows(ets, [0] * 8) == []


def test_planner_by_hand():
    """Hourly samples: 10 h of sun then 30 h dark, repeated. A 20 h mission from index 0 sees 10 h of dark, from 10 sees 20 h."""
    from lunazen.planner import evaluate_landings, feasible

    sun_up = np.tile(np.r_[np.ones(10), np.zeros(30)], 3) > 0
    link = np.ones_like(sun_up)
    results = evaluate_landings(sun_up, link, 3600.0, 20 * 3600.0, 10)
    assert [r["startIndex"] for r in results] == [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    first, second = results[0], results[1]
    assert first["sunlitFraction"] == 0.5 and first["longestDarkHours"] == 10.0
    assert second["sunlitFraction"] == 0.0 and second["longestDarkHours"] == 20.0
    # VIPER's 50 h covers both, Blue Ghost's 5 h neither; the link share must be met too.
    assert feasible(second, 0.0, 50.0) and not feasible(first, 0.0, 5.0)
    assert not feasible(first, 1.1, 50.0)
