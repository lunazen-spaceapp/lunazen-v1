"""Fraction of an apparent disk (Sun or Earth) above the terrain horizon.

The disk is integrated in vertical columns in the local azimuth/elevation
plane. Each column spans elevation E +/- sqrt(r^2 - x^2) at horizontal angular
offset x (azimuth offset x / cos E); the part above the terrain horizon at that
azimuth counts as visible. Valid away from the zenith (cos E not small): exact
for a straight horizon, and the column count sets the resolution along it.
"""

import numpy as np


def disk_fraction(azimuth_deg, elevation_deg, radius_deg, horizon, columns=64):
    """Visible area fraction (0..1) of disks centred at (azimuth, elevation)."""
    az = np.atleast_1d(np.asarray(azimuth_deg, dtype=float))[:, None]
    el = np.atleast_1d(np.asarray(elevation_deg, dtype=float))[:, None]
    r = np.broadcast_to(np.atleast_1d(np.asarray(radius_deg, dtype=float)), az.shape[:1])[:, None]

    # Column centres in units of the radius (midpoint rule on [-1, 1]).
    u = -1.0 + (np.arange(columns) + 0.5) * (2.0 / columns)
    half = r * np.sqrt(1.0 - u**2)[None, :]
    x = r * u[None, :]
    terrain = horizon.at(az + x / np.cos(np.radians(el)))
    top, bottom = el + half, el - half
    visible = np.clip(top - np.maximum(bottom, terrain), 0.0, None)
    return visible.sum(axis=1) / (2.0 * half).sum(axis=1)
