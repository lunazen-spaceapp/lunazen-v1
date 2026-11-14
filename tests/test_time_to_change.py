"""Time until the Sun or Earth next sets or rises, on the 15-minute grid."""
import numpy as np
from conftest import needs_kernels

from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import STEP_S, time_to_change
from lunazen.products import candidate_spots
from lunazen.visibility import sun_state


@needs_kernels
def test_time_to_change_is_the_first_flip_of_the_up_state():
    site, horizon = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        et = utc_to_et("2027-03-01T06:15:00")
        for body in ("SUN", "EARTH"):
            got = time_to_change(site, horizon, et, body)
            assert got["hours"] is None or (got["hours"] > 0 and got["hours"] * 3600 % STEP_S == 0)
        # Sun at that moment is fully up; the answer must agree with stepping forward by hand.
        sun = time_to_change(site, horizon, et, "SUN")
        grid = et + np.arange(int(30 * 86400 / STEP_S) + 1) * STEP_S
        up = sun_state(grid, site, horizon)["fraction"] > 0
        first = int(np.argmax(up != up[0]))
        assert sun["up"] == bool(up[0]) and sun["hours"] == first * STEP_S / 3600


@needs_kernels
def test_no_change_within_the_window_gives_none():
    site, horizon = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        got = time_to_change(site, horizon, utc_to_et("2027-01-01T00:00:00"), "SUN", max_days=0.01)
        assert got["hours"] is None
