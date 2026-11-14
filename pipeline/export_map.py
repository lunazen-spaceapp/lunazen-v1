"""Export the south-pole overview map for the web app.

The picture reaches +/-330 km so that sites outside NASA's 85 S illumination data (Nobile rim 2,
IM-1) can be seen: outside the central +/-150 km it is the terrain hillshade alone.

Background layers are NASA's published 18.6-year average visibility maps (LOLA team,
Mazarico et al. 2011; AVGVISIB_85S_060M_201608[_EARTH]) over the central +/-150 km,
reduced from 60 m to 600 m cells by taking the BRIGHTEST 60 m pixel in each cell (the
best-lit patches are only 80-280 m across, so a cell average would hide them; a 600 m mean
peaks at 52 % Sun while the 60 m map reaches ~90 %), coloured and blended over a hillshade
of LOLA's 80 m elevation map.

    uv run python pipeline/export_map.py

Writes:
  web/data/map_sun.webp, web/data/map_earth.webp   coloured layers (1100 x 1100 px, 600 m each)
  web/data/map_values.bin                          uint8 [row][col][sun %, earth %], 255 = no data
  web/data/map.json                                extent, grid, colour legend, site tiles
"""

import json

import numpy as np
from matplotlib import colormaps
from PIL import Image

from lunazen.geometry import south_polar_to_latlon
from lunazen.paths import ILLUMINATION, LOLA, ROOT
from lunazen.sites import CANDIDATE_SITES, tile_path
from lunazen.terrain import load_geotiff, load_pds_img

OUT = ROOT / "web" / "data"
HALF_M = 150_000.0      # NASA illumination data
VIEW_HALF_M = 330_000.0  # the picture (hillshade beyond the data)
BLOCK = 10  # 60 m -> 600 m
CMAP = "viridis"


def block_max(dem, half_m, block):
    """Maximum of block x block pixels over the centred square of half-width half_m."""
    px = dem.pixel_m
    n = int(round(2 * half_m / px))
    c0 = int(round((-half_m - dem.x0_m) / px))
    r0 = int(round((dem.y0_m - half_m) / px))
    raw = np.asarray(dem.heights_m[r0:r0 + n, c0:c0 + n], dtype=float)
    m = n // block
    return raw[: m * block, : m * block].reshape(m, block, m, block).max(axis=(1, 3))


def hillshade(size, half_m):
    dem = load_pds_img(LOLA / "LDEM_80S_80M.IMG")
    step = 2 * half_m / size
    centres = -half_m + (np.arange(size) + 0.5) * step
    xx, yy = np.meshgrid(centres, centres[::-1])
    z = dem.sample(xx, yy)
    gy, gx = np.gradient(z, step)
    azimuth, altitude = np.radians(315), np.radians(35)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect)
    return np.clip(shade, 0, 1)


def layer_image(values, shade):
    """Coloured values over the hillshade in the middle; plain grey hillshade where NASA has no data."""
    shade = np.nan_to_num(shade, nan=0.0)
    full = np.full(shade.shape, np.nan)
    m = values.shape[0]
    o = (shade.shape[0] - m) // 2
    full[o:o + m, o:o + m] = values
    rgba = colormaps[CMAP](np.nan_to_num(full, nan=0.0))
    rgb = rgba[..., :3] * (0.55 + 0.45 * shade[..., None])
    rgb[np.isnan(full)] = 0.5 * shade[np.isnan(full), None] + 0.1
    return Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255))


def main():
    sun = block_max(load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG"), HALF_M, BLOCK)
    earth = block_max(load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608_EARTH.IMG"), HALF_M, BLOCK)
    size = sun.shape[0]
    view_size = int(round(2 * VIEW_HALF_M / (2 * HALF_M / size)))
    shade = hillshade(view_size, VIEW_HALF_M)
    for name, values in (("sun", sun), ("earth", earth)):
        layer_image(values, shade).save(OUT / f"map_{name}.webp", quality=88, method=6)

    packed = np.full((size, size, 2), 255, dtype=np.uint8)
    for k, values in enumerate((sun, earth)):
        ok = np.isfinite(values)
        packed[..., k][ok] = np.round(np.clip(values[ok], 0, 1) * 100).astype(np.uint8)
    (OUT / "map_values.bin").write_bytes(packed.tobytes())

    tiles = []
    for site in CANDIDATE_SITES:
        path = tile_path(site.id)
        if not path.exists():
            continue
        dem = load_geotiff(path)
        rows, cols = dem.heights_m.shape
        tiles.append({"id": site.id, "name": site.name,
                      "x0M": dem.x0_m, "x1M": dem.x0_m + cols * dem.pixel_m,
                      "y0M": dem.y0_m - rows * dem.pixel_m, "y1M": dem.y0_m})

    lat_edge, _ = south_polar_to_latlon(HALF_M, 0.0)
    meta = {
        "extentM": {"x0": -HALF_M, "x1": HALF_M, "y0": -HALF_M, "y1": HALF_M},
        "size": size, "pixelM": 2 * HALF_M / size,
        "layers": {"sun": "map_sun.webp", "earth": "map_earth.webp"},
        "values": {"file": "map_values.bin", "dtype": "uint8", "order": "row (north to south), col (west to east), [sun %, earth %]", "noData": 255,
                   "meaning": "brightest 60 m pixel within each 600 m cell"},
        "image": {"extentM": {"x0": -VIEW_HALF_M, "x1": VIEW_HALF_M, "y0": -VIEW_HALF_M, "y1": VIEW_HALF_M}, "size": view_size,
                  "meaning": "the pictures cover this square; NASA's illumination data only the central extentM"},
        "colormap": CMAP,
        "legend": [[round(v, 2), "#%02x%02x%02x" % tuple(int(c * 255) for c in colormaps[CMAP](v)[:3])] for v in np.linspace(0, 1, 6)],
        "edgeLatitudeDeg": float(lat_edge),
        "tiles": tiles,
        "source": "NASA LOLA average Sun / Earth visibility, 18.6 years, any part of the disk, 60 m (Mazarico et al. 2011), "
                  "each 600 m cell shows its brightest 60 m pixel; hillshade from LOLA LDEM_80S_80M",
    }
    (OUT / "map.json").write_text(json.dumps(meta, indent=1))
    sizes = {p.name: p.stat().st_size for p in OUT.glob("map*")}
    print(f"map {size}x{size} at {meta['pixelM']:.0f} m; files: " + ", ".join(f"{k} {v / 1e3:.0f} kB" for k, v in sorted(sizes.items())))


if __name__ == "__main__":
    main()
