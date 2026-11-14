"""Site position and local East-North-Up basis in MOON_ME; polar stereographic projection.

The reference body is a sphere of radius 1737.4 km, as used by the LOLA products.
"""

from dataclasses import dataclass

import numpy as np

MOON_RADIUS_M = 1_737_400.0


@dataclass(frozen=True)
class Site:
    latitude_deg: float
    longitude_deg: float
    height_m: float  # above the reference sphere (ground + mast)
    position_m: np.ndarray  # MOON_ME
    east: np.ndarray
    north: np.ndarray
    up: np.ndarray

    def to_enu(self, vectors):
        """Project (..., 3) MOON_ME vectors onto (east, north, up)."""
        return vectors @ self.east, vectors @ self.north, vectors @ self.up

    def az_el(self, vectors):
        """Azimuth (deg from north, east-positive) and elevation (deg) of (..., 3) vectors."""
        e, n, u = self.to_enu(vectors)
        elevation = np.degrees(np.arctan2(u, np.hypot(e, n)))
        azimuth = np.degrees(np.arctan2(e, n)) % 360.0
        return azimuth, elevation


def site_from_latlon(latitude_deg, longitude_deg, height_m, radius_m=MOON_RADIUS_M):
    lat, lon = np.radians(latitude_deg), np.radians(longitude_deg)
    r = radius_m + height_m
    position = r * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = position / np.linalg.norm(position)
    return Site(float(latitude_deg), float(longitude_deg) % 360.0, float(height_m), position, east, north, up)


def latlon_to_south_polar(lat_rad, lon_rad, radius_m=MOON_RADIUS_M):
    """South-polar stereographic (true scale at the pole): x = rho sin(lon), y = rho cos(lon)."""
    rho = 2.0 * radius_m * np.tan((np.pi / 2.0 + lat_rad) / 2.0)
    return rho * np.sin(lon_rad), rho * np.cos(lon_rad)


def south_polar_to_latlon(x_m, y_m, radius_m=MOON_RADIUS_M):
    """Inverse of latlon_to_south_polar; returns degrees."""
    rho = np.hypot(x_m, y_m)
    latitude = -np.pi / 2.0 + 2.0 * np.arctan2(rho, 2.0 * radius_m)
    longitude = np.arctan2(x_m, y_m)
    return np.degrees(latitude), np.degrees(longitude) % 360.0
