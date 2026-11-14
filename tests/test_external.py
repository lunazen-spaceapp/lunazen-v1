"""External validation: Sun and Earth topocentric az/el against JPL Horizons.

Reference data cached by validation/fetch_jpl_horizons.py (DE441, MEAN_ME,
airless apparent az/el, 2024-2030 every 37 days, 4 lunar sites), and the LOLA
team's 18.6-year average visibility maps (validation/compare_illumination.py).
"""

import sys
from pathlib import Path

import numpy as np
import pytest

from lunazen.kernels import spice_kernels, utc_to_et

from conftest import needs_dems, needs_illumination, needs_kernels

HERE = Path(__file__).resolve().parent.parent / "validation"


sys.path.insert(0, str(HERE))
from jpl_comparison import residuals  # noqa: E402
import thresholds  # noqa: E402


@needs_kernels
@pytest.mark.parametrize("target", ["sun", "earth"])
@pytest.mark.parametrize("site_id", ["near_pole", "malapert", "blue_ghost_1", "farside_equator"])
def test_matches_jpl_horizons(site_id, target):
    d_el, sep = residuals(site_id, target)
    # Observed: Sun < 0.01 arcsec, Earth <= 0.1 arcsec.
    assert np.max(np.abs(d_el)) * 3600 < thresholds.JPL_ARCSEC
    assert np.max(sep) * 3600 < thresholds.JPL_ARCSEC


ILLUM_JSON = HERE / "illumination_comparison.json"
@needs_illumination
@needs_dems
def test_average_illumination_matches_lola_maps():
    """Six gentle-slope points: 18.6-year Sun/Earth visibility (published method) vs Mazarico et al. maps."""
    import json
    import sys

    sys.path.insert(0, str(HERE))
    from compare_illumination import simulate, time_grid  # noqa: E402

    from lunazen.terrain import polar_dems

    points = sorted(json.loads(ILLUM_JSON.read_text())["points"], key=lambda r: r["slope_deg"])[:6]
    dems = polar_dems()
    with spice_kernels():
        ets = time_grid(6 * 3600.0)
        for r in points:
            sun, earth = simulate(r["x_m"], r["y_m"], dems, ets, "matched")
            # Tolerances follow the full 26-point comparison (matched method):
            # Sun RMS 0.016 / max 0.046, Earth RMS 0.031 / max 0.134 (steep slopes).
            assert sun == pytest.approx(r["published_sun"], abs=thresholds.ILLUMINATION_SUN_PP / 100), r["id"]
            assert earth == pytest.approx(r["published_earth"], abs=thresholds.ILLUMINATION_EARTH_PP / 100), r["id"]
