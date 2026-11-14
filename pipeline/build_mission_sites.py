"""Horizons and Sun/Earth timelines at CLPS landing sites (data/sites/missions.csv).

For each mission: the terrain horizon at the published landing position (2 m mast),
traced through regional windows (lunazen/windows.py: LOLA 20 m at IM-1 and IM-2, SLDEM2015
at Blue Ghost 1) in front of the standard maps,
and Sun/Earth visibility every 10 minutes from landing to 20 days later, with the first time
after landing that the Sun's disk is completely hidden ("sunset", refined to 10 s).

    uv run python pipeline/build_mission_sites.py
Outputs: data/products/mission_sites.npz, data/products/mission_sites_summary.json
"""

import csv
import json

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import et_to_utc, spice_kernels, utc_to_et
from lunazen.paths import PRODUCTS, ROOT, SITES
from lunazen.terrain import OBSERVER_HEIGHT_M, ground_height_dems, site_dems, trace_horizon_nested
from lunazen.visibility import earth_state, sun_state
from lunazen.windows import mission_windows

MAST_M = OBSERVER_HEIGHT_M
DAYS = 20
OUTPUT = PRODUCTS / "mission_sites.npz"
SUMMARY = PRODUCTS / "mission_sites_summary.json"


def daily_table(ets, sun, earth):
    """Per UTC calendar day (partial days at the ends included)."""
    dates = np.array([et_to_utc(t, 0)[:10] for t in ets])
    rows = []
    for date in dict.fromkeys(dates):
        k = dates == date
        rows.append({"date": date, "samples": int(k.sum()), "sun_up": float(sun["visible"][k].mean()),
                     "earth_up": float(earth["visible"][k].mean()), "sun_max_elevation_deg": float(sun["elevation_deg"][k].max())})
    return rows


def refine_sunset(site, horizon, t_before, t_after, step_s=10.0):
    """First time (ET) in (t_before, t_after] the Sun's disk is completely hidden, to step_s."""
    ets = np.arange(t_before, t_after + step_s, step_s)
    fraction = sun_state(ets, site, horizon)["fraction"]
    return float(ets[np.argmax(fraction <= 0.0)])


def main():
    with open(SITES / "missions.csv", newline="") as f:
        missions = list(csv.DictReader(f))
    horizons, distances, summary, positions = [], [], [], []
    with spice_kernels():
        for m in missions:
            lat, lon = float(m["latitude_deg"]), float(m["longitude_deg"])
            # Finest first: regional windows (20 m polar, SLDEM2015) where downloaded, then the standard maps.
            dems = mission_windows(m["id"]) + site_dems(lat)
            ground = ground_height_dems(lat, lon, dems)
            horizon, distance, source = trace_horizon_nested(lat, lon, ground, dems, 0.25, observer_height_m=MAST_M)
            # The products, the browser and the validation scripts all use horizons stored to 0.01 deg;
            # summarise with the same horizon so every one of them reports the same times.
            horizon = Horizon(horizon.azimuth_deg, np.round(horizon.elevation_deg * 100) / 100)
            site = site_from_latlon(lat, lon, ground + MAST_M)
            et0 = utc_to_et(m["landed_utc"])
            ets = et0 + np.arange(0, DAYS * 86400 + 1, 600.0)
            sun, earth = sun_state(ets, site, horizon), earth_state(ets, site, horizon)
            set_index = np.argmax(sun["fraction"] <= 0.0) if (sun["fraction"] <= 0.0).any() else None
            sunset_et = refine_sunset(site, horizon, ets[set_index - 1], ets[set_index]) if set_index else None
            record = {
                **m, "ground_m": ground, "mast_m": MAST_M,
                "horizon_deg": [float(horizon.elevation_deg.min()), float(horizon.elevation_deg.max())],
                "sun_up_at_landing": bool(sun["visible"][0]),
                "first_sunset_after_landing_utc": et_to_utc(sunset_et, 0) if sunset_et is not None else None,
                "days_of_sunlight_after_landing": float((sunset_et - et0) / 86400) if sunset_et is not None else None,
                "sun_elevation_deg_range": [float(sun["elevation_deg"].min()), float(sun["elevation_deg"].max())],
                "earth_visible_fraction_20d": float(earth["visible"].mean()),
                "earth_elevation_deg_range": [float(earth["elevation_deg"].min()), float(earth["elevation_deg"].max())],
                "daily": daily_table(ets, sun, earth),
            }
            summary.append(record)
            horizons.append(np.round(horizon.elevation_deg * 100).astype(np.int16))
            distances.append(distance.astype(np.float32))
            positions.append((lat, lon, ground))
            print(f"{m['name']:22s} ground {ground:7.0f} m  sun up at landing {record['sun_up_at_landing']}  "
                  f"first sunset {record['first_sunset_after_landing_utc']}  earth visible {record['earth_visible_fraction_20d']:.2f}  "
                  f"earth elev {record['earth_elevation_deg_range'][0]:.1f}..{record['earth_elevation_deg_range'][1]:.1f}")
    SUMMARY.write_text(json.dumps({"mast_m": MAST_M, "days": DAYS, "missions": summary}, indent=1))
    np.savez_compressed(OUTPUT, id=np.array([m["id"] for m in missions]), name=np.array([m["name"] for m in missions]),
                        latitude_deg=np.array([p[0] for p in positions]), longitude_deg=np.array([p[1] for p in positions]),
                        ground_m=np.array([p[2] for p in positions]), mast_m=MAST_M,
                        horizon_cdeg=np.array(horizons), horizon_distance_m=np.array(distances), azimuth_step_deg=0.25)
    print(f"wrote {OUTPUT.relative_to(ROOT)} and {SUMMARY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
