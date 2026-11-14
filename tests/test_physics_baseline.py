"""Locked results at real sites: NASA candidate spots and CLPS landing sites.

If any of these change, explain the physical cause in the commit message.
"""

import pytest

from lunazen.kernels import et_to_utc, utc_to_et
from lunazen.mission import summarize
from lunazen.paths import PRODUCTS
from lunazen.visibility import sun_state

from conftest import needs_kernels

pytestmark = needs_kernels
needs_missions = pytest.mark.skipif(not (PRODUCTS / "mission_sites.npz").exists(), reason="run pipeline/build_mission_sites.py")


@needs_missions
def test_im1_ground_height_matches_lroc():
    """LROC measured 2579 m at Odysseus' resting place; our LOLA-map height is independent of that."""
    from lunazen.products import mission_sites

    site, _ = mission_sites()["im1"]
    assert site.height_m - 2.0 == pytest.approx(2579.0, abs=30.0)


@needs_missions
def test_im1_geometric_sunset_after_the_mission_ended(spice_loaded):
    """Odysseus went silent on 2024-02-29 with the Sun low; the terrain hides the Sun only on 2024-03-02."""
    import numpy as np

    from lunazen.products import mission_sites

    site, horizon = mission_sites()["im1"]
    ets = np.arange(utc_to_et("2024-02-29T00:00:00"), utc_to_et("2024-03-04T00:00:00"), 600.0)
    sun = sun_state(ets, site, horizon)
    sunset = et_to_utc(ets[np.argmax(sun["fraction"] <= 0.0)], 0)
    assert sunset.startswith("2024-03-02")
    assert sun["elevation_deg"][:144].max() < 7.0  # 29 Feb: the Sun never climbs above 7 deg


@needs_missions
def test_blue_ghost_terrain_sunset(spice_loaded):
    """SLDEM2015 (59 m) shows a 0.6 deg ridge 0.8 km west of the lander, which the global
    474 m map smoothed away (it gave full sunset at 20:22). The Sun starts to set behind it
    at 18:21 UTC; NASA's "five hours after lunar sunset" with the last data at 23:15 puts
    the reported sunset near 18:15."""
    import numpy as np

    from lunazen.products import mission_sites

    site, horizon = mission_sites()["bg1"]
    ets = np.arange(utc_to_et("2025-03-16T17:00:00"), utc_to_et("2025-03-16T22:00:00"), 60.0)
    fraction = sun_state(ets, site, horizon)["fraction"]
    begins, complete = ets[np.argmax(fraction < 0.999)], ets[np.argmax(fraction <= 0.0)]
    assert abs(begins - utc_to_et("2025-03-16T18:21:00")) < 300.0
    assert abs(complete - utc_to_et("2025-03-16T19:28:00")) < 300.0
    assert abs(begins - utc_to_et("2025-03-16T18:15:00")) < 1800.0  # NASA-implied sunset, within 30 min
