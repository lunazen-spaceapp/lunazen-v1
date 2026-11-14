"""Load the precomputed site products (pipeline/build_candidate_sites.py, build_mission_sites.py).

Horizons are stored as int16 centidegrees on a uniform azimuth grid starting at 0 deg.
"""

import json

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.paths import PRODUCTS


def _horizon(cdeg, step_deg):
    elevation = np.asarray(cdeg, dtype=float) / 100.0
    return Horizon(np.arange(elevation.size) * float(step_deg), elevation)


def candidate_spots(mast_m=2.0):
    """{spot id: (Site, Horizon)} at the spot centres for one of the precomputed mast heights."""
    data = np.load(PRODUCTS / "candidate_sites.npz")
    keep = (data["point"] == 0) & np.isclose(data["mast_m"], mast_m)
    if not keep.any():
        raise ValueError(f"no horizons for a {mast_m} m mast; available: {sorted(set(data['mast_m']))}")
    return {
        str(data["spot"][i]): (site_from_latlon(data["latitude_deg"][i], data["longitude_deg"][i], data["ground_m"][i] + mast_m),
                               _horizon(data["horizon_cdeg"][i], data["azimuth_step_deg"]))
        for i in np.flatnonzero(keep)
    }


def candidate_summary():
    return json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())


def mission_sites():
    """{mission id: (Site, Horizon)} at the published landing positions."""
    data = np.load(PRODUCTS / "mission_sites.npz")
    mast = float(data["mast_m"])
    return {
        str(data["id"][i]): (site_from_latlon(data["latitude_deg"][i], data["longitude_deg"][i], data["ground_m"][i] + mast),
                             _horizon(data["horizon_cdeg"][i], data["azimuth_step_deg"]))
        for i in range(len(data["id"]))
    }


def mission_horizon_distance_m(mission_id):
    """Distance (m) of the terrain that sets the horizon at each azimuth, for one mission site."""
    data = np.load(PRODUCTS / "mission_sites.npz")
    return data["horizon_distance_m"][list(data["id"]).index(mission_id)]


def mission_summary():
    return json.loads((PRODUCTS / "mission_sites_summary.json").read_text())
