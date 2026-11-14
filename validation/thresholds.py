"""Tolerances the validation checks are held to, in one place.

The Python tests (tests/test_external.py, tests/test_web_export.py, tests/test_apollo_sun_angles.py) and
pipeline/export_evidence.py, which prints them on the Evidence page, import them from here. The browser's own
tests (web/engine/test/engine.test.js) repeat the browser-versus-Python ones, 0.1 arcsecond and 0.1 percentage points.
"""

JPL_ARCSEC = 1.0              # Sun and Earth directions against JPL Horizons (observed: Sun < 0.01, Earth <= 0.1)
ILLUMINATION_SUN_PP = 3.0     # NASA's LOLA average-visibility maps, gentle slopes (the six flattest of 26 points)
ILLUMINATION_EARTH_PP = 5.0
BARKER_PP = 2.0               # Barker et al. (2021) Fig. 19 is read by eye to about 1 pp; ours minus theirs must stay inside +-2
APOLLO_SUN_DEG = 0.25         # the source's Sun angles are rounded to 0.1 deg and its times to a quarter of an hour (about 0.1 deg together)
BROWSER_ARCSEC = 0.1          # browser engine against Python
BROWSER_PP = 0.1
