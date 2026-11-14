"""Export the site close-ups for the Map: NASA's native 60 m Sun/Earth visibility over a 20 m hillshade.

The overview picture (pipeline/export_map.py) reduces NASA's 60 m maps to 600 m cells, which is right for the whole pole
but blocky inside a site. Each NASA site box (16 km, 30 km for Haworth) gets its own pair of files, loaded by the Map
only when the site is opened or zoomed to:

    uv run python pipeline/export_site_maps.py

Needs web/data/custom/ (pipeline/export_custom_terrain.py) and the NASA illumination maps (scripts/fetch_data.sh).
Writes web/data/sitemap/:
  <site>_shade.webp    20 m hillshade of the site box (same sun azimuth and height as the overview), 8-bit grey
  <site>_values.bin    uint8 [row north to south][col][sun %, earth %] at NASA's 60 m, 255 = no data
  site_map.json        per site: the box, the shade grid, the values grid (origin, pixel, rows, cols), the viridis table
"""

import json

import numpy as np
from matplotlib import colormaps
from PIL import Image

from lunazen.paths import ILLUMINATION, ROOT
from lunazen.terrain import load_pds_img

WEB = ROOT / "web" / "data"
OUT = WEB / "sitemap"
AZIMUTH_DEG, ALTITUDE_DEG = 315.0, 35.0  # as pipeline/export_map.py
NO_DATA = 255


def shade_of(elevation_m, pixel_m):
    """Hillshade in 0..1 of a grid with NaN where there is no terrain (filled with the mean for the slope)."""
    z = np.where(np.isnan(elevation_m), np.nanmean(elevation_m), elevation_m)
    gy, gx = np.gradient(z, pixel_m)
    azimuth, altitude = np.radians(AZIMUTH_DEG), np.radians(ALTITUDE_DEG)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect)
    return np.clip(shade, 0, 1)


def values_crop(dem, x0, x1, y0, y1):
    """The 60 m pixels covering the box x0..x1, y0..y1 (m), padded with no data outside NASA's grid.
    Returns (array [rows][cols] of fractions or NaN, origin x of the left edge, origin y of the top edge)."""
    px = dem.pixel_m
    c0, c1 = int(np.floor((x0 - dem.x0_m) / px)), int(np.ceil((x1 - dem.x0_m) / px))
    r0, r1 = int(np.floor((dem.y0_m - y1) / px)), int(np.ceil((dem.y0_m - y0) / px))
    rows, cols = dem.heights_m.shape
    out = np.full((r1 - r0, c1 - c0), np.nan)
    a0, a1, b0, b1 = max(c0, 0), min(c1, cols), max(r0, 0), min(r1, rows)
    if a1 > a0 and b1 > b0:
        out[b0 - r0:b1 - r0, a0 - c0:a1 - c0] = np.asarray(dem.heights_m[b0:b1, a0:a1], dtype=float)
    return out, dem.x0_m + c0 * px, dem.y0_m - r0 * px


def main():
    custom = json.loads((WEB / "custom" / "custom.json").read_text())
    sun = load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG")
    earth = load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608_EARTH.IMG")
    OUT.mkdir(exist_ok=True)
    sites = []
    total = 0
    for s in custom["sites"]:
        raw = np.fromfile(WEB / "custom" / s["file"], dtype="<i2").reshape(s["rows"], s["cols"])
        elevation = np.where(raw == custom["noData"], np.nan, raw * s["scaleM"] + s["offsetM"])
        shade = shade_of(elevation, s["pixelM"])
        Image.fromarray(np.uint8(np.round(shade * 255))).save(OUT / f"{s['id']}_shade.webp", quality=80, method=6)

        x0, y1 = s["x0M"], s["y0M"]  # left and top edges of the shade grid
        x1, y0 = x0 + s["cols"] * s["pixelM"], y1 - s["rows"] * s["pixelM"]
        packed = None
        for k, dem in enumerate((sun, earth)):
            values, vx0, vy1 = values_crop(dem, x0, x1, y0, y1)
            if packed is None:
                packed = np.full(values.shape + (2,), NO_DATA, dtype=np.uint8)
            ok = np.isfinite(values)
            packed[..., k][ok] = np.round(np.clip(values[ok], 0, 1) * 100).astype(np.uint8)
        (OUT / f"{s['id']}_values.bin").write_bytes(packed.tobytes())
        total += packed.nbytes
        sites.append({
            "id": s["id"], "name": s["name"],
            "box": {"x0M": x0, "x1M": x1, "y0M": y0, "y1M": y1},
            "shade": {"file": f"{s['id']}_shade.webp", "pixelM": s["pixelM"], "rows": s["rows"], "cols": s["cols"]},
            "values": {"file": f"{s['id']}_values.bin", "x0M": vx0, "y1M": vy1, "pixelM": sun.pixel_m, "rows": packed.shape[0], "cols": packed.shape[1]},
        })

    lut = ["#%02x%02x%02x" % tuple(int(c * 255) for c in colormaps["viridis"](v / 255)[:3]) for v in range(256)]
    (OUT / "site_map.json").write_text(json.dumps({
        "values": {"dtype": "uint8", "order": "row (north to south), col (west to east), [sun %, earth %]", "noData": NO_DATA,
                   "meaning": "NASA's 18.6-year average visibility at its native 60 m, not reduced"},
        "shade": {"azimuthDeg": AZIMUTH_DEG, "altitudeDeg": ALTITUDE_DEG, "source": "the 20 m copy of NASA's 5 m terrain (web/data/custom)"},
        "viridis": lut, "sites": sites,
    }, indent=1))
    webp = sum(p.stat().st_size for p in OUT.glob("*.webp"))
    print(f"{len(sites)} sites; shade {webp / 1e3:.0f} kB webp, values {total / 1e3:.0f} kB raw")


if __name__ == "__main__":
    main()
