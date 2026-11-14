"""Evaluate all 27 NASA PGDA south-pole sites against the site-selection rule -> data/sites/site_selection.csv.

Rule (docs/learn, Section 2): a PGDA 5 m site is used if (A) its tile centre lies in the published data area of a NASA
Artemis candidate region (2022 or 2024 list, data/sites/artemis_regions.json) or (B) NASA's own region-of-interest polygons and the
peer-reviewed error estimates of Barker et al. (2021) exist for it (Sites 1, 4, 7, 11), and (C) NASA's 60 m average-visibility
map (85 S to the pole), which the spots are chosen from, covers part of the tile. Flown CLPS landings are added separately.
The tile is read from the local copy if downloaded, else its georeferencing is read remotely (range requests).

    uv run python pipeline/evaluate_sites.py
"""
import csv

import numpy as np
import rasterio

from lunazen.geometry import south_polar_to_latlon
from lunazen.paths import ILLUMINATION, PGDA, SITES
from lunazen.sites import artemis_regions, artemis_regions_at
from lunazen.terrain import load_pds_img

PGDA_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
# Names from the PGDA product page (https://pgda.gsfc.nasa.gov/products/78); 27 entries.
PGDA_SITES = {
    "Site01": "Connecting ridge", "Site04": "Shackleton rim", "Site06": "Nobile rim 1", "Site07": "Peak near Shackleton",
    "Site11": "de Gerlache rim", "Site20": "Leibnitz beta plateau", "Site20v2": "Leibnitz beta plateau, extended boundaries",
    "Site23": "Malapert massif", "Site42": "de Gerlache-Kocher massif", "Haworth": "Haworth", "Shoemaker": "Shoemaker",
    "DM1": "Amundsen rim", "DM2": "Nobile rim 2", "SL2": "de Gerlache rim", "SL3": "Connecting ridge extension",
    "NPA": "Cabeus exterior wall 1", "NPB": "Amundsen 1", "NPC": "Idel'son L crater 1", "NPD": "Malapert crater 1",
    "LM1": "Shackleton Rim B", "LM2": "Shoemaker Rim A", "LM3": "Shoemaker Rim B", "LM4": "Shoemaker Rim C",
    "LM5": "Shoemaker Rim D", "LM6": "Shoemaker Rim E", "LM7": "Faustini Rim A", "LM8": "Shoemaker Rim F",
}
BARKER_2021 = {"Site01", "Site04", "Site07", "Site11"}  # sites Barker et al. (2021) give error estimates for


def tile_bounds(site):
    name = f"{site}_final_adj_5mpp_surf.tif"
    local = PGDA / site / name
    with rasterio.Env(CPL_VSIL_CURL_USE_HEAD="NO", GDAL_HTTP_USERAGENT="Mozilla/5.0", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        src = rasterio.open(local if local.exists() else f"/vsicurl/{PGDA_URL}/{site}/{name}")
    with src:
        b = src.bounds
        return b.left, b.bottom, b.right, b.top


def map_coverage(sun_map, x0, y0, x1, y1, margin=2000.0):
    """Share of the tile interior (2 km margin) that NASA's 60 m average-visibility map covers."""
    xx, yy = np.meshgrid(np.linspace(x0 + margin, x1 - margin, 40), np.linspace(y0 + margin, y1 - margin, 40))
    return float(np.isfinite(sun_map.sample(xx.ravel(), yy.ravel(), "nearest")).mean())


def main():
    regions = artemis_regions()["regions"]
    sun_map = load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG")
    rows = []
    for site, name in PGDA_SITES.items():
        x0, y0, x1, y1 = tile_bounds(site)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        lat, lon = south_polar_to_latlon(cx, cy)
        hits = artemis_regions_at(cx, cy, regions)
        rows.append({
            "site": site, "name": name, "tile_km": round((x1 - x0) / 1000, 1),
            "centre_lat_deg": round(float(lat), 3), "centre_lon_deg": round(float(lon), 2),
            "artemis_regions": "; ".join(h["name"] + (" (central)" if h["central"] else "") for h in hits),
            "in_artemis_region": bool(hits), "barker2021_error_estimate": site in BARKER_2021,
            "visibility_map_coverage": round(map_coverage(sun_map, x0, y0, x1, y1), 2),
        })
        # Site20v2 is the same place as Site20 with extended boundaries: one of the two is enough.
        rows[-1]["selected"] = ((rows[-1]["in_artemis_region"] or site in BARKER_2021)
                               and rows[-1]["visibility_map_coverage"] > 0 and site != "Site20v2")
    out = SITES / "site_selection.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    for r in rows:
        print(f"{r['site']:10s} {r['tile_km']:5.1f} km  {r['centre_lat_deg']:8.3f} {r['centre_lon_deg']:7.2f}  "
              f"{'USE' if r['selected'] else '-- '} {'A' if r['in_artemis_region'] else ' '}{'B' if r['barker2021_error_estimate'] else ' '} map {r['visibility_map_coverage']:.2f} {r['artemis_regions']}")
    print(f"{sum(r['selected'] for r in rows)} of {len(rows)} sites selected; wrote {out}")


if __name__ == "__main__":
    main()
