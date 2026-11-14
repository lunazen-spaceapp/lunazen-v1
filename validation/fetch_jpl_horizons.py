"""Fetch JPL Horizons topocentric Sun/Earth azimuth and elevation for lunar sites.

Responses are cached in validation/jpl_horizons/ so the comparison test
(tests/test_external.py) runs offline and is reproducible.

    uv run python validation/fetch_jpl_horizons.py
"""

import subprocess
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent / "jpl_horizons"

# id: (east longitude deg, latitude deg, altitude km above the 1737.4 km sphere)
SITES = {
    "near_pole": (202.982118, -89.341170, 1.24840),  # ~20 km from the south pole
    "malapert": (0.0, -86.0, 5.0),
    "blue_ghost_1": (61.8104, 18.5622, -2.0),
    "farside_equator": (180.0, 0.0, 0.0),
}
TARGETS = {"sun": "10", "earth": "399"}
START, STOP, STEP = "2024-01-01", "2030-12-31", "37d"


def fetch(site, target):
    lon, lat, alt = SITES[site]
    params = {
        "format": "text",
        "COMMAND": f"'{TARGETS[target]}'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{alt}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'",
        "APPARENT": "'AIRLESS'",
        "TIME_DIGITS": "'SECONDS'",
    }
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    # curl uses the system trust store (Python's bundled one may not verify here).
    return subprocess.run(["curl", "-fsS", "-m", "120", url], check=True, capture_output=True, text=True).stdout


def main():
    HERE.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        for target in TARGETS:
            path = HERE / f"{site}_{target}.txt"
            path.write_text(fetch(site, target))
            print(f"wrote {path.name}")


if __name__ == "__main__":
    main()
