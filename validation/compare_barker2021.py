"""Compare with Barker et al. (2021), Site 1 (Connecting ridge) regions of interest.

Barker, M. K., et al. (2021), Improved LOLA elevation maps for south pole landing sites:
Error estimates and their impact on illumination conditions, Planet. Space Sci. 203,
105119 (accepted manuscript: https://ntrs.nasa.gov/citations/20205009660).

Their set-up (Section 5): horizons along 720 azimuths from every 5 m pixel, 5 m map within
5 km, 80 m to 100 km, 240 m beyond; hourly from 2024-01-01 to 2026-01-01; Sun as a
limb-darkened disk split horizontally at the horizon height; "average illumination" is the
mean visible fraction of the Sun's disk; each region of interest (RoI: >70 % at 1 m, area >
2500 m^2, the polygons NASA PGDA distributes) is averaged over all its pixels.

Ours: the same regions sampled on a 10 m lattice, the nominal 5 m map, our nested tracer
(5 m tile, LOLA 20 m and 80 m, 0.25 deg azimuth), a uniform (not limb-darkened) disk
integrated in columns, at 1 m and 5 m above the ground.

Published values used (their Fig. 19 and Section 5 text):
  - nominal LDEM, 1 m, read off Fig. 19 (approximate): about 73-78 % across the 7 RoIs;
  - 1st percentile over 100 DEM clones (Table 2, A rows): 67-71 % at 1 m, 83-89 % at 5 m.

    uv run python validation/compare_barker2021.py
"""

import json
import time
from pathlib import Path

import numpy as np
from matplotlib.path import Path as PolygonPath

from lunazen.geometry import site_from_latlon, south_polar_to_latlon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import longest_run_hours
from lunazen.sites import roi_polygons
from lunazen.terrain import polar_dems, trace_horizon_nested
from lunazen.visibility import sun_state

OUTPUT = Path(__file__).resolve().parent / "barker2021_comparison.json"
SPACING_M = 10.0
HEIGHTS_M = (1.0, 5.0)
START, END = "2024-01-01T00:00:00", "2026-01-01T00:00:00"
PUBLISHED = {
    "nominal_1m_fig19_approx": [73.0, 78.0],
    # Fig. 19 nominal-LDEM circles at 1 m, read by eye (about +/-1 pp), RoI 1..7.
    "nominal_1m_fig19_by_roi": [76.0, 76.0, 73.0, 77.5, 75.5, 77.5, 73.5],
    "clone_p1_1m_table2": [67.0, 71.0],
    "clone_p1_5m_table2": [83.0, 89.0],
}


def lattice(ring, spacing):
    """5 m pixel centres (x = -19000 + 5k + 2.5) on a `spacing` grid inside a polygon."""
    (x0, y0), (x1, y1) = ring.min(axis=0), ring.max(axis=0)
    xs = np.arange(np.floor(x0 / spacing) * spacing, x1 + spacing, spacing) + 2.5
    ys = np.arange(np.floor(y0 / spacing) * spacing, y1 + spacing, spacing) + 2.5
    grid = np.array([(x, y) for x in xs for y in ys])
    return grid[PolygonPath(ring).contains_points(grid)]


def summarize(results):
    ours_1m = [r["1m"]["average_illumination_pct"] for r in results]
    ours_5m = [r["5m"]["average_illumination_pct"] for r in results]
    diff = np.array(ours_1m) - np.array(PUBLISHED["nominal_1m_fig19_by_roi"])
    return {"ours_1m_range": [min(ours_1m), max(ours_1m)], "ours_5m_range": [min(ours_5m), max(ours_5m)],
            "ours_minus_fig19_1m_pp": [float(diff.min()), float(diff.max())], **PUBLISHED}


def main():
    dems = polar_dems("Site01")
    tile = dems[0]
    rings = roi_polygons("Site01")
    results = []
    t0 = time.time()
    with spice_kernels():
        ets = np.arange(utc_to_et(START), utc_to_et(END), 3600.0)
        for k, ring in enumerate(rings):
            points = lattice(ring, SPACING_M)
            row = {"roi": k + 1, "centroid_m": [float(v) for v in ring.mean(axis=0)], "points": int(len(points))}
            for height in HEIGHTS_M:
                avg, lcip, lcsp = [], [], []
                for x, y in points:
                    lat, lon = south_polar_to_latlon(x, y)
                    ground = float(tile.sample(np.array([x]), np.array([y]))[0])
                    horizon, _, _ = trace_horizon_nested(lat, lon, ground, dems, 0.25, observer_height_m=height)
                    sun = sun_state(ets, site_from_latlon(lat, lon, ground + height), horizon)
                    lit = sun["fraction"] > 0
                    avg.append(float(sun["fraction"].mean()))
                    lcip.append(longest_run_hours(lit, 3600.0) / 24)
                    lcsp.append(longest_run_hours(~lit, 3600.0) / 24)
                row[f"{height:g}m"] = {"average_illumination_pct": 100 * float(np.mean(avg)),
                                        "lcip_days_mean": float(np.mean(lcip)), "lcsp_days_mean": float(np.mean(lcsp))}
            results.append(row)
            print(f"RoI {k + 1} ({len(points)} pts): 1 m {row['1m']['average_illumination_pct']:.1f}%  "
                  f"5 m {row['5m']['average_illumination_pct']:.1f}%   ({time.time() - t0:.0f} s)")
    summary = summarize(results)
    OUTPUT.write_text(json.dumps({"period": [START, END], "spacing_m": SPACING_M, "summary": summary, "rois": results}, indent=1))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
