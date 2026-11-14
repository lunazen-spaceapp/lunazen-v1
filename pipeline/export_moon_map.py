"""Export the whole-Moon picture for the web app's Moon page.

A simple-cylindrical (equirectangular) map, -180 to 180 deg E across and 90 N to 90 S down, so the near side is in the
middle. LOLA's global 64 pixel/degree elevation (LDEM_64, about 474 m at the equator) is averaged 10 x 10 into 2304 x 1152
cells, tinted by height (dark low, light high) and shaded from the north-west with the height exaggerated three times, so that the maria and
the big basins read at a glance.

    uv run python pipeline/export_moon_map.py

Writes:
  web/data/moon_map.webp   the picture
  web/data/moon_map.json   its extent, size, height range and source
"""

import json

import numpy as np
from matplotlib import colormaps
from PIL import Image

from lunazen.paths import LOLA, ROOT
from lunazen.terrain import load_pds_cylindrical

OUT = ROOT / "web" / "data"
BLOCK = 10  # 64 px/deg -> 6.4 px/deg (4.7 km at the equator)
EXAGGERATION = 3.0
CMAP = "gray"  # neutral, so the app's colours (amber Sun, blue Earth) are the only colours on the page
R_M = 1_737_400.0


def reduced_heights():
    """Block means of the global map, shifted so that column 0 is at -180 deg E."""
    dem = load_pds_cylindrical(LOLA / "LDEM_64.IMG")
    rows, cols = dem.heights_m.shape
    out = np.empty((rows // BLOCK, cols // BLOCK))
    for k in range(out.shape[0]):
        strip = np.asarray(dem.heights_m[k * BLOCK:(k + 1) * BLOCK, :], dtype=float)
        out[k] = np.nanmean(strip.reshape(BLOCK, -1, BLOCK), axis=(0, 2))
    return np.roll(out, out.shape[1] // 2, axis=1), dem.pixels_per_degree / BLOCK


def render(z, ppd):
    rows, cols = z.shape
    lat = np.radians(90.0 - (np.arange(rows) + 0.5) / ppd)
    dy = np.radians(1.0 / ppd) * R_M
    dx = dy * np.maximum(np.cos(lat), 0.05)[:, None]
    gy, gx = np.gradient(EXAGGERATION * z)[0] / dy, np.gradient(EXAGGERATION * z, axis=1) / dx
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azimuth, altitude = np.radians(315), np.radians(40)
    shade = np.clip(np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect), 0, 1)
    lo, hi = np.percentile(z, [1, 99])
    tint = colormaps[CMAP]((z - lo) / (hi - lo))[..., :3]
    rgb = tint * (0.35 + 0.65 * shade[..., None])
    return Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255)), float(lo), float(hi)


def main():
    z, ppd = reduced_heights()
    image, lo, hi = render(z, ppd)
    image.save(OUT / "moon_map.webp", quality=86, method=6)
    meta = {
        "width": z.shape[1], "height": z.shape[0],
        "lonMinDeg": -180.0, "lonMaxDeg": 180.0, "latMaxDeg": 90.0, "latMinDeg": -90.0,
        "heightRangeM": [round(lo), round(hi)], "colormap": CMAP,
        "source": "NASA LRO LOLA global elevation LDEM_64 (about 474 m), averaged 10 x 10, shaded from the north-west with the heights exaggerated 3 times",
    }
    (OUT / "moon_map.json").write_text(json.dumps(meta, indent=1))
    print(f"moon map {z.shape[1]}x{z.shape[0]}, {(OUT / 'moon_map.webp').stat().st_size / 1e3:.0f} kB, heights {lo:.0f} to {hi:.0f} m")


if __name__ == "__main__":
    main()
