"""Our Sun / Earth directions vs the cached JPL Horizons tables (validation/jpl_horizons/).

Used by tests/test_external.py and pipeline/export_evidence.py.
"""

from pathlib import Path

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.visibility import earth_state, sun_state

HERE = Path(__file__).resolve().parent
FLAT = Horizon.flat()


def load_table(site_id, target):
    rows, inside = [], False
    for line in (HERE / "jpl_horizons" / f"{site_id}_{target}.txt").read_text().splitlines():
        if line.startswith("$$SOE"):
            inside = True
        elif line.startswith("$$EOE"):
            break
        elif inside:
            parts = line.split()
            rows.append((f"{parts[0]} {parts[1]}", float(parts[-2]), float(parts[-1])))
    return rows


def unit(az_deg, el_deg):
    az, el = np.radians(az_deg), np.radians(el_deg)
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=-1)


def residuals(site_id, target):
    """(elevation difference, angular separation) in degrees at every cached epoch."""
    from fetch_jpl_horizons import SITES  # validation/ is on sys.path for callers

    lon, lat, alt_km = SITES[site_id]
    site = site_from_latlon(lat, lon, alt_km * 1000.0)
    rows = load_table(site_id, target)
    with spice_kernels():
        ets = np.array([utc_to_et(t) for t, _, _ in rows])
        state = (sun_state if target == "sun" else earth_state)(ets, site, FLAT)
    ref_az = np.array([r[1] for r in rows])
    ref_el = np.array([r[2] for r in rows])
    ours, ref = unit(state["azimuth_deg"], state["elevation_deg"]), unit(ref_az, ref_el)
    sep = np.degrees(np.arctan2(np.linalg.norm(np.cross(ours, ref), axis=-1), np.sum(ours * ref, axis=-1)))
    return state["elevation_deg"] - ref_el, sep
