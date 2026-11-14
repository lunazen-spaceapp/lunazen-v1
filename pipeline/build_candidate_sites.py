"""Candidate landing spots at NASA's south-pole sites, with horizons and yearly metrics (2027-2029).

For each PGDA site (lunazen/sites.py):
  1. Spots: the brightest 60 m pixels of NASA's published average-illumination map
     (Mazarico et al. 2011) inside the 5 m tile (2 km margin), whose 5 m slope is
     <= MAX_SLOPE_DEG, at least MIN_SEPARATION_M apart (up to SPOTS_PER_SITE), plus
     the best spot by min(Sun, Earth) visibility if not already chosen.
  2. Each spot: horizons at several mast heights at the centre, and at the default
     mast (OBSERVER_HEIGHT_M) on a
     ring of points 50 m and 100 m away (landing-position spread).
  3. Metrics for each year in lunazen.mission.YEARS (2027-2029), plus monthly for 2027, at every horizon.

Outputs:
  data/products/candidate_sites.npz           horizons (int16, centidegrees) + spot table
  data/products/candidate_sites_summary.json  readable metrics, used by the tests and the guides

    uv run python pipeline/build_candidate_sites.py            # all sites, writes products
    uv run python pipeline/build_candidate_sites.py Site01     # one site, prints only
"""

import json
import sys
import time

import numpy as np

from lunazen.geometry import site_from_latlon, south_polar_to_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import STEP_S, YEARS, summarize, summarize_years
from lunazen.paths import ILLUMINATION, PRODUCTS, ROOT
from lunazen.sites import CANDIDATE_SITES, SITES_BY_ID, roi_polygons, tile_interior, tile_path
from lunazen.terrain import OBSERVER_HEIGHT_M, load_geotiff, load_pds_img, polar_dems, trace_horizon_nested
from matplotlib.path import Path as PolygonPath

MAX_SLOPE_DEG = 10.0
MIN_SEPARATION_M = 300.0
SPOTS_PER_SITE = 5
MAST_HEIGHTS_M = (1.0, 2.0, 5.0, 10.0)
RING_RADII_M = (50.0, 100.0)
RING_POINTS = 6
AZIMUTH_STEP_DEG = 0.25
YEAR = ("2027-01-01T00:00:00", "2028-01-01T00:00:00")
OUTPUT = PRODUCTS / "candidate_sites.npz"
SUMMARY = PRODUCTS / "candidate_sites_summary.json"


def candidate_spots(site, surf, slope, sun_map, earth_map):
    """Choose spots from NASA's average-illumination map, filtered by 5 m slope."""
    ring = tile_interior(surf)
    (x0, y0), (x1, y1) = ring.min(axis=0), ring.max(axis=0)
    px = sun_map.pixel_m
    cols = np.arange(np.ceil((x0 - sun_map.x0_m) / px - 0.5), np.floor((x1 - sun_map.x0_m) / px - 0.5) + 1)
    rows = np.arange(np.ceil((sun_map.y0_m - y1) / px - 0.5), np.floor((sun_map.y0_m - y0) / px - 0.5) + 1)
    xs = sun_map.x0_m + (cols + 0.5) * px
    ys = sun_map.y0_m - (rows + 0.5) * px
    xx, yy = np.meshgrid(xs, ys)
    xx, yy = xx.ravel(), yy.ravel()
    sun = sun_map.sample(xx, yy, "nearest")
    earth = earth_map.sample(xx, yy, "nearest")
    slopes = slope.sample(xx, yy)
    ok = np.isfinite(sun) & np.isfinite(slopes) & (slopes <= MAX_SLOPE_DEG)
    xx, yy, sun, earth, slopes = xx[ok], yy[ok], sun[ok], earth[ok], slopes[ok]

    chosen = []

    def far_enough(i):
        return all(np.hypot(xx[i] - xx[j], yy[i] - yy[j]) >= MIN_SEPARATION_M for j, _ in chosen)

    for i in np.argsort(-sun):
        if len(chosen) == SPOTS_PER_SITE:
            break
        if far_enough(i):
            chosen.append((i, "brightest"))
    best_both = int(np.argmax(np.minimum(sun, earth)))
    if all(best_both != j for j, _ in chosen) and far_enough(best_both):
        chosen.append((best_both, "best Sun+Earth"))

    rings = roi_polygons(site.id)

    def in_roi(x, y):
        """Inside a NASA ROI, or within half a 60 m pixel of its boundary."""
        return any(PolygonPath(r).contains_point((x, y)) or np.min(np.hypot(r[:, 0] - x, r[:, 1] - y)) <= 30.0 for r in rings)

    spots = []
    for rank, (i, kind) in enumerate(chosen):
        spots.append({
            "site": site.id, "site_name": site.name, "spot": f"{site.id}-{rank + 1}", "kind": kind,
            "x_m": float(xx[i]), "y_m": float(yy[i]), "slope_deg": float(slopes[i]),
            "nasa_avg_sun": float(sun[i]), "nasa_avg_earth": float(earth[i]),
            "in_nasa_roi": bool(in_roi(xx[i], yy[i])) if rings else None,
        })
    return spots


def ring_offsets():
    offsets = [(0.0, 0.0)]
    for radius in RING_RADII_M:
        for k in range(RING_POINTS):
            a = 2 * np.pi * (k + 0.5 * (radius == RING_RADII_M[1])) / RING_POINTS
            offsets.append((radius * np.sin(a), radius * np.cos(a)))
    return offsets


def available(site_id):
    """A site is usable once both its tiles are fully downloaded (fetch_data.sh validates them)."""
    try:
        for kind in ("surf", "slp"):
            load_geotiff(tile_path(site_id, kind))
        return True
    except Exception:
        return False


def main(site_ids):
    missing = [s for s in site_ids if not available(s)]
    if missing:
        print(f"skipping sites whose tiles are not (fully) downloaded: {missing}")
    site_ids = [s for s in site_ids if s not in missing]
    sun_map = load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG")
    earth_map = load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608_EARTH.IMG")
    rows, horizons, summary = [], [], []
    with spice_kernels():
        et0, et1 = utc_to_et(YEAR[0]), utc_to_et(YEAR[1])
        month_starts = [utc_to_et(f"2027-{m:02d}-01T00:00:00") for m in range(1, 13)] + [et1]
        for site_id in site_ids:
            site = SITES_BY_ID[site_id]
            t = time.time()
            surf = load_geotiff(tile_path(site_id, "surf"))
            slope = load_geotiff(tile_path(site_id, "slp"))
            dems = [surf] + polar_dems()
            for spot in candidate_spots(site, surf, slope, sun_map, earth_map):
                record = dict(spot, points=[])
                for k, (dx, dy) in enumerate(ring_offsets()):
                    x, y = spot["x_m"] + dx, spot["y_m"] + dy
                    lat, lon = south_polar_to_latlon(x, y)
                    ground = float(surf.sample(np.array([x]), np.array([y]))[0])
                    for height in (MAST_HEIGHTS_M if k == 0 else (OBSERVER_HEIGHT_M,)):
                        horizon, _, _ = trace_horizon_nested(lat, lon, ground, dems, AZIMUTH_STEP_DEG, observer_height_m=height)
                        # Summarise with the horizon as stored (0.01 deg), the one the browser reads, so both report the same times.
                        horizon = Horizon(horizon.azimuth_deg, np.round(horizon.elevation_deg * 100) / 100)
                        s = site_from_latlon(lat, lon, ground + height)
                        year = summarize(s, horizon, et0, et1, STEP_S)
                        years = summarize_years(s, horizon)
                        point = {"offset_m": [round(dx, 1), round(dy, 1)], "mast_m": height, "latitude_deg": float(lat),
                                 "longitude_deg": float(lon), "ground_m": ground, "year_2027": year, "years": years}
                        if k == 0 and height == OBSERVER_HEIGHT_M:
                            point["months_2027"] = [summarize(s, horizon, a, b, STEP_S)
                                                    for a, b in zip(month_starts[:-1], month_starts[1:])]
                        record["points"].append(point)
                        rows.append((spot["spot"], k, height, x, y, lat, lon, ground))
                        horizons.append(np.round(horizon.elevation_deg * 100).astype(np.int16))
                summary.append(record)
                c = next(p for p in record["points"] if p["offset_m"] == [0.0, 0.0] and p["mast_m"] == OBSERVER_HEIGHT_M)
                print(f"  {spot['spot']:12s} {spot['kind']:15s} slope {spot['slope_deg']:4.1f}  NASA avg sun {spot['nasa_avg_sun']:.2f} "
                      f"earth {spot['nasa_avg_earth']:.2f} | 2027 sun {c['year_2027']['sunlitFraction']:.2f} earth {c['year_2027']['earthFraction']:.2f} "
                      f"longest dark {c['year_2027']['longestDarkHours']:.0f} h  ROI {spot['in_nasa_roi']}")
            print(f"{site_id} {site.name}: {time.time() - t:.0f} s")

    if len(sys.argv) > 1:
        print("(subset run: nothing written; run without arguments to build the products)")
        return
    SUMMARY.write_text(json.dumps({
        "method": {"max_slope_deg": MAX_SLOPE_DEG, "min_separation_m": MIN_SEPARATION_M, "spots_per_site": SPOTS_PER_SITE,
                   "mast_heights_m": MAST_HEIGHTS_M, "ring_radii_m": RING_RADII_M, "ring_points": RING_POINTS,
                   "year": YEAR, "years": list(YEARS)},
        "sites_missing": missing, "spots": summary}, indent=1))
    names = ("spot", "point", "mast_m", "x_m", "y_m", "latitude_deg", "longitude_deg", "ground_m")
    np.savez_compressed(OUTPUT, horizon_cdeg=np.array(horizons), azimuth_step_deg=AZIMUTH_STEP_DEG,
                        **{n: np.array([r[i] for r in rows]) for i, n in enumerate(names)})
    print(f"wrote {OUTPUT.relative_to(ROOT)} and {SUMMARY.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:] or [s.id for s in CANDIDATE_SITES])
