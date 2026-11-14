"""Apparent Sun and Earth above the terrain horizon, from SPICE.

Both bodies are extended disks. A body is "up" when any part of its disk is
above the terrain horizon (visible fraction > 0, lunazen/disk.py). The same rule is used by the LOLA team's Earth
visibility maps and by the browser engine (web/engine/physics.js).
"""

import numpy as np
import spiceypy as spice

from lunazen.disk import disk_fraction

SPICE_FRAME = "MOON_ME"
SPICE_CORRECTION = "LT+S"  # light time + stellar aberration
SPICE_OBSERVER = "MOON"
BODY_RADIUS_KM = {"SUN": 695_700.0, "EARTH": 6378.137}  # IAU nominal solar radius; WGS84 equatorial


def body_vectors_m(body, ets, site):
    """Site-to-body vectors (N, 3) in metres, MOON_ME (light-time corrected at the Moon's centre)."""
    positions_km, _ = spice.spkpos(body, np.atleast_1d(ets), SPICE_FRAME, SPICE_CORRECTION, SPICE_OBSERVER)
    return np.asarray(positions_km).reshape(-1, 3) * 1000.0 - site.position_m


def body_state(body, ets, site, horizon):
    vectors = body_vectors_m(body, ets, site)
    distance_km = np.linalg.norm(vectors, axis=-1) / 1000.0
    azimuth, elevation = site.az_el(vectors)
    terrain = horizon.at(azimuth)
    radius = np.degrees(np.arcsin(BODY_RADIUS_KM[body] / distance_km))
    fraction = disk_fraction(azimuth, elevation, radius, horizon)
    return {
        "azimuth_deg": azimuth,
        "elevation_deg": elevation,
        "terrain_deg": terrain,
        "centre_margin_deg": elevation - terrain,
        "distance_km": distance_km,
        "angular_radius_deg": radius,
        "fraction": fraction,
        "visible": fraction > 0.0,
    }


def sun_state(ets, site, horizon):
    return body_state("SUN", ets, site, horizon)


def earth_state(ets, site, horizon):
    return body_state("EARTH", ets, site, horizon)
