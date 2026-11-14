"""Deep Space Network (DSN) visibility of the Moon.

A direct-to-Earth link needs two things: Earth above the lander's terrain horizon,
and at least one DSN complex seeing the Moon above its antenna elevation mask.
Station positions are the Earth-fixed coordinates of the 70 m antennas in DSN
810-005 Module 301 (Coverage and Geometry). Earth orientation is SPICE's IAU_EARTH
model from pck00011 (no nutation; it runs on TDB rather than UT1, so a station can be
off by ~0.3 deg in rotation, which moves link edges by about a minute at a 10 deg mask).
"""

import numpy as np
import spiceypy as spice

# Earth-fixed Cartesian coordinates (m), DSN 810-005 Module 301.
DSN_COMPLEXES = {
    "Goldstone": np.array([-2353621.420, -4641341.472, 3677052.318]),  # DSS-14
    "Canberra": np.array([-4460894.917, 2682361.507, -3674748.152]),  # DSS-43
    "Madrid": np.array([4849092.518, -360180.348, 4115109.251]),  # DSS-63
}
ELEVATION_MASK_DEG = 10.0  # ~ the DSN general uplink limit; receive works down to ~6 deg (810-005 Module 301)

WGS84_A = 6378137.0
WGS84_F = 1.0 / 298.257223563


def geodetic_up(xyz):
    """Unit normal to the WGS84 ellipsoid at an Earth-fixed position (iterative geodetic latitude)."""
    x, y, z = xyz
    e2 = WGS84_F * (2 - WGS84_F)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1 - e2))
    for _ in range(5):
        n = WGS84_A / np.sqrt(1 - e2 * np.sin(lat) ** 2)
        h = p / np.cos(lat) - n
        lat = np.arctan2(z, p * (1 - e2 * n / (n + h)))
    lon = np.arctan2(y, x)
    return np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


STATION_UP = {name: geodetic_up(xyz) for name, xyz in DSN_COMPLEXES.items()}


def moon_elevations(ets):
    """{complex: elevation of the Moon's centre (deg)} at each ET, from Earth-fixed geometry."""
    moon_km, _ = spice.spkpos("MOON", np.atleast_1d(ets), "IAU_EARTH", "LT+S", "EARTH")
    moon = np.asarray(moon_km).reshape(-1, 3) * 1000.0
    out = {}
    for name, station in DSN_COMPLEXES.items():
        v = moon - station
        out[name] = np.degrees(np.arcsin((v @ STATION_UP[name]) / np.linalg.norm(v, axis=1)))
    return out


def dsn_in_view(ets, mask_deg=ELEVATION_MASK_DEG):
    """True where at least one DSN complex sees the Moon above the mask."""
    elevations = moon_elevations(ets)
    return np.any([e > mask_deg for e in elevations.values()], axis=0)


def station_vectors_m(ets, site):
    """{complex: site-to-station vectors (N, 3) in metres, MOON_ME} (Earth's centre with LT+S plus the rotated station offset).

    A station is at most 6378 km from Earth's centre, about 0.95 deg of Earth's disk as seen from the Moon, so it is
    a point on that disk. The offset is rotated with SPICE's IAU_EARTH model at the same ET (the 1.3 s light time
    moves it by under 1e-4 deg).
    """
    ets = np.atleast_1d(ets)
    earth_km, _ = spice.spkpos("EARTH", ets, "MOON_ME", "LT+S", "MOON")
    centre = np.asarray(earth_km).reshape(-1, 3) * 1000.0 - site.position_m
    rotation = np.array([spice.pxform("IAU_EARTH", "MOON_ME", float(t)) for t in ets])
    return {name: centre + rotation @ xyz for name, xyz in DSN_COMPLEXES.items()}


def station_in_view(ets, site, horizon, mask_deg=ELEVATION_MASK_DEG):
    """True where at least one DSN complex sees the Moon above the mask and the lander sees that complex above its skyline.

    The stricter rule: the station's own direction from the lander (a point, not Earth's whole disk) must clear the
    terrain horizon at its azimuth, so a partly hidden Earth counts only if the station in use is the visible part.
    """
    elevations = moon_elevations(ets)
    vectors = station_vectors_m(ets, site)
    seen = []
    for name, v in vectors.items():
        azimuth, elevation = site.az_el(v)
        seen.append((elevations[name] > mask_deg) & (elevation > horizon.at(azimuth)))
    return np.any(seen, axis=0)
