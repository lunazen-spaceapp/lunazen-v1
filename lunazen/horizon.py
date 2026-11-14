"""Azimuth-dependent terrain horizon H(A)."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Horizon:
    """Terrain horizon elevation (deg) sampled at azimuths (deg, from north, east-positive)."""

    azimuth_deg: np.ndarray
    elevation_deg: np.ndarray

    def __post_init__(self):
        # Closed copies so interpolation wraps 360 -> 0 deg seamlessly.
        object.__setattr__(self, "_az", np.append(self.azimuth_deg, 360.0))
        object.__setattr__(self, "_el", np.append(self.elevation_deg, self.elevation_deg[0]))

    def at(self, azimuth_deg):
        """Horizon elevation (deg) at any azimuth array, wrapping at 0/360."""
        return np.interp(np.mod(azimuth_deg, 360.0), self._az, self._el)

    def raised(self, deg):
        """The same horizon with every elevation raised by `deg`: the terrain skyline if it were that much higher."""
        return Horizon(self.azimuth_deg, self.elevation_deg + deg)

    @classmethod
    def flat(cls, step_deg=1.0):
        azimuths = np.arange(0.0, 360.0, step_deg)
        return cls(azimuths, np.zeros_like(azimuths))
