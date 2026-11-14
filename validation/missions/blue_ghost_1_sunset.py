"""Retrodiction: the end of Blue Ghost Mission 1 (Mare Crisium, 16 March 2025).

Facts used (public sources):
  site 18.562 N, 61.810 E (NSSDCA); landed 2025-03-02 08:34 UTC;
  "346 hours of operations in sunlight" and "just over 5 hours into the lunar night";
  final data ~23:15 UTC on 2025-03-16 (Firefly, SpaceNews);
  "Blue Ghost continued operations for five hours after lunar sunset on March 16" (NASA,
  https://www.nasa.gov/news-release/nasa-firefly-invite-media-to-discuss-end-of-blue-ghost-moon-mission/).

Terrain: the mission product's horizon, traced through the SLDEM2015 window (59 m) in front
of the global LOLA map (lunazen/windows.py, pipeline/build_mission_sites.py).

    uv run python validation/missions/blue_ghost_1_sunset.py
"""

import json
from pathlib import Path

import numpy as np

from lunazen.horizon import Horizon
from lunazen.kernels import et_to_utc, spice_kernels, utc_to_et
from lunazen.terrain import OBSERVER_HEIGHT_M
from lunazen.products import mission_horizon_distance_m, mission_sites
from lunazen.visibility import earth_state, sun_state

OUTPUT = Path(__file__).resolve().parent / "blue_ghost_1_sunset.json"
LANDING_UTC, SUNLIT_HOURS, FINAL_UTC = "2025-03-02T08:34:00", 346.0, "2025-03-16T23:15:00"


def first(ets, mask):
    return float(ets[np.argmax(mask)]) if mask.any() else None


def main():
    # Site and horizon from the mission product (pipeline/build_mission_sites.py): one source of truth.
    site, horizon = mission_sites()["bg1"]
    distance = mission_horizon_distance_m("bg1")
    ground = site.height_m - OBSERVER_HEIGHT_M
    flat = Horizon.flat()

    with spice_kernels():
        ets = np.arange(utc_to_et("2025-03-16T12:00:00"), utc_to_et("2025-03-17T00:00:00"), 10.0)
        sun = sun_state(ets, site, horizon)
        sun_flat = sun_state(ets, site, flat)
        earth = earth_state(ets, site, horizon)
        operational_end = utc_to_et(LANDING_UTC) + SUNLIT_HOURS * 3600.0
        final = utc_to_et(FINAL_UTC)
        k = int(np.argmin(np.abs(ets - operational_end)))
        events = {
            "terrain_sunset_begins": first(ets, sun["fraction"] < 0.999),
            "sun_centre_behind_terrain": first(ets, sun["centre_margin_deg"] < 0.0),
            "terrain_sunset_complete": first(ets, sun["fraction"] <= 0.0),
            "flat_horizon_sunset_complete": first(ets, sun_flat["fraction"] <= 0.0),
        }
        result = {
            "ground_m": ground,
            "events_utc": {name: et_to_utc(t, 0) for name, t in events.items()},
            "landing_plus_346h_utc": et_to_utc(operational_end, 0),
            "final_transmission_utc": FINAL_UTC,
        "nasa_sunset_implied_utc": et_to_utc(final - 5 * 3600.0, 0),
            "hours_from_terrain_sunset_to_final": (final - events["terrain_sunset_complete"]) / 3600.0,
            "sun_at_landing_plus_346h": {
                "elevation_deg": float(sun["elevation_deg"][k]),
                "margin_above_terrain_deg": float(sun["centre_margin_deg"][k]),
            },
            "terrain_toward_sunset": {
                "horizon_deg": float(horizon.at(sun["azimuth_deg"][k])),
                "distance_km": float(distance[int(round(sun["azimuth_deg"][k] / 0.25)) % distance.size] / 1000.0),
            },
            "earth_elevation_deg": [float(earth["elevation_deg"].min()), float(earth["elevation_deg"].max())],
        }
    OUTPUT.write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
