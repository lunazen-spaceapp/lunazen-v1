"""Horizons and yearly summaries for landing sites away from the pole (data/sites/beyond_sites.csv).

Terrain is the global LOLA map only (LDEM_64, ~474 m): good for sunrise and sunset to about an hour or two away from
the pole (validation/beyond_accuracy.py), not for fine skyline detail. Same 2 m mast, 0.25 deg azimuth step and
0.01 deg storage as the other products.

    uv run python pipeline/build_beyond_sites.py
Outputs: data/products/beyond_sites.npz, data/products/beyond_sites_summary.json
"""

import csv
import json

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels
from lunazen.mission import summarize_years
from lunazen.paths import PRODUCTS, ROOT, SITES
from lunazen.terrain import OBSERVER_HEIGHT_M, ground_height_dems, site_dems, trace_horizon_nested

OUTPUT = PRODUCTS / "beyond_sites.npz"
SUMMARY = PRODUCTS / "beyond_sites_summary.json"


def main():
    with open(SITES / "beyond_sites.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    ids, horizons, positions, summary = [], [], [], []
    with spice_kernels():
        for row in rows:
            lat, lon = float(row["latitude_deg"]), float(row["longitude_deg"])
            dems = site_dems(lat)
            ground = ground_height_dems(lat, lon, dems)
            horizon, _, _ = trace_horizon_nested(lat, lon, ground, dems, 0.25, observer_height_m=OBSERVER_HEIGHT_M)
            horizon = Horizon(horizon.azimuth_deg, np.round(horizon.elevation_deg * 100) / 100)
            years = summarize_years(site_from_latlon(lat, lon, ground + OBSERVER_HEIGHT_M), horizon)
            ids.append(row["id"])
            horizons.append(np.round(horizon.elevation_deg * 100).astype(np.int16))
            positions.append((lat, lon, ground))
            summary.append({**row, "ground_m": ground, "years": years})
            y = years["2027"]
            print(f"{row['name']:30s} ground {ground:7.0f} m  Sun {y['sunlitFraction']:.2f}  Earth {y['earthFraction']:.2f}  "
                  f"longest night {y['longestDarkHours']:.0f} h  horizon max {horizon.elevation_deg.max():.2f} deg")
    SUMMARY.write_text(json.dumps({"mast_m": OBSERVER_HEIGHT_M, "terrain": "global LOLA LDEM_64 (474 m)", "sites": summary}, indent=1))
    np.savez_compressed(OUTPUT, id=np.array(ids), latitude_deg=np.array([p[0] for p in positions]),
                        longitude_deg=np.array([p[1] for p in positions]), ground_m=np.array([p[2] for p in positions]),
                        mast_m=OBSERVER_HEIGHT_M, horizon_cdeg=np.array(horizons), azimuth_step_deg=0.25)
    print(f"wrote {OUTPUT.relative_to(ROOT)} and {SUMMARY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
