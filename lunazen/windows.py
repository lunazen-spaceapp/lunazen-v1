"""Regional terrain windows around CLPS landing sites, cut from large NASA maps.

The global LOLA map (LDEM_64, ~474 m) and the polar 80 m map are too coarse for the
skyline a few kilometres from a lander. These windows add finer data where it exists:

  - LOLA LDEM_80S_20M (20 m, polar stereographic) around IM-1 and IM-2, which lie outside
    the 85 deg S 20 m map the candidate spots use;
  - SLDEM2015 (512 px/deg, ~59 m; LOLA + SELENE Terrain Camera, Barker et al. 2016)
    around Blue Ghost 1 in Mare Crisium.

Only the rows that cover a window are downloaded (HTTP range requests) and only its columns
kept, so a 1.4-1.8 GB product costs ~240 MB of transfer and ~30 MB on disk.
`scripts/fetch_data.sh` runs `python -m lunazen.windows`.
"""

import csv
import json
import re
import subprocess
from dataclasses import dataclass

import numpy as np

from lunazen.geometry import MOON_RADIUS_M, latlon_to_south_polar
from lunazen.paths import EXTERNAL, SITES
from lunazen.terrain import PolarDem

WINDOWS_DIR = EXTERNAL / "windows"
LOLA_POLAR = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_20M"
SLDEM_TILE = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/"
              "float_img/sldem2015_512_00n_30n_045_090_float")


@dataclass(frozen=True)
class WindowSpec:
    name: str
    mission: str  # id in data/sites/missions.csv; the window is centred on its coordinates
    product: str  # URL without extension; .lbl/.LBL and .img/.IMG beside it
    kind: str  # "polar" or "cylindrical"
    half_width_m: float


WINDOWS = (
    WindowSpec("im1_ldem_80s_20m", "im1", LOLA_POLAR, "polar", 40_000.0),
    WindowSpec("im2_ldem_80s_20m", "im2", LOLA_POLAR, "polar", 40_000.0),
    WindowSpec("bg1_sldem2015", "bg1", SLDEM_TILE, "cylindrical", 75_000.0),
)


@dataclass
class CylindricalWindow:
    """A simple-cylindrical height window; NaN outside it, so it nests in front of coarser maps."""

    heights_m: np.ndarray
    pixels_per_degree: float
    lat_top_deg: float  # northern edge of row 0
    lon_left_deg: float  # western edge of column 0
    name: str = ""

    @property
    def pixel_m(self):
        return np.radians(1.0 / self.pixels_per_degree) * MOON_RADIUS_M

    def sample_latlon(self, lat_rad, lon_rad, method="bilinear"):
        row = (self.lat_top_deg - np.degrees(lat_rad)) * self.pixels_per_degree - 0.5
        col = (np.mod(np.degrees(lon_rad) - self.lon_left_deg, 360.0)) * self.pixels_per_degree - 0.5
        rows, cols = self.heights_m.shape
        r0, c0 = np.floor(row).astype(np.int64), np.floor(col).astype(np.int64)
        fr, fc = row - r0, col - c0
        ok = (r0 >= 0) & (r0 < rows - 1) & (c0 >= 0) & (c0 < cols - 1)
        out = np.full(np.shape(row), np.nan)
        r, c, a, b = r0[ok], c0[ok], fr[ok], fc[ok]
        h = self.heights_m
        out[ok] = h[r, c] * (1 - a) * (1 - b) + h[r, c + 1] * (1 - a) * b + h[r + 1, c] * a * (1 - b) + h[r + 1, c + 1] * a * b
        return out


def _mission_latlon(mission_id):
    with open(SITES / "missions.csv", newline="") as f:
        row = next(r for r in csv.DictReader(f) if r["id"] == mission_id)
    return float(row["latitude_deg"]), float(row["longitude_deg"])


def _curl(url, *args):
    return subprocess.run(["curl", "-fsSL", "--retry", "5", "--retry-all-errors", *args, url], check=True, capture_output=True).stdout


def _label(spec):
    path = WINDOWS_DIR / f"{spec.product.rsplit('/', 1)[1]}.lbl"
    if not path.exists():
        for ext in (".lbl", ".LBL"):
            try:
                path.write_bytes(_curl(spec.product + ext))
                break
            except subprocess.CalledProcessError:
                continue
    text = path.read_text(errors="replace")

    def number(key):
        return float(re.search(rf"^\s*{key}\s*=\s*([-\d.]+)", text, re.MULTILINE).group(1))

    return text, number


def fetch(spec):
    """Download one window (rows by HTTP range, columns cropped) unless it is already on disk."""
    out = WINDOWS_DIR / f"{spec.name}.npy"
    if out.exists():
        return out
    WINDOWS_DIR.mkdir(parents=True, exist_ok=True)
    text, number = _label(spec)
    lines, samples, record = int(number("LINES")), int(number("LINE_SAMPLES")), int(number("RECORD_BYTES"))
    bits, scale = int(number("SAMPLE_BITS")), number("SCALING_FACTOR")
    unit = re.search(r'^\s*UNIT\s*=\s*"?(\w+)', text, re.MULTILINE)
    unit_m = 1000.0 if unit and unit.group(1).upper().startswith("KILO") else 1.0
    dtype = np.dtype("<f4") if bits == 32 else np.dtype("<i2")
    lat, lon = _mission_latlon(spec.mission)
    if spec.kind == "polar":
        pixel_m = number("MAP_SCALE")
        line_off, sample_off = number("LINE_PROJECTION_OFFSET"), number("SAMPLE_PROJECTION_OFFSET")
        x, y = latlon_to_south_polar(np.radians(lat), np.radians(lon))
        half = int(np.ceil(spec.half_width_m / pixel_m))
        r_c, c_c = int(round(line_off - y / pixel_m)), int(round(x / pixel_m + sample_off))
        r0, r1, c0, c1 = r_c - half, r_c + half, c_c - half, c_c + half
        geometry = lambda r0, c0: {"kind": "polar", "pixel_m": pixel_m,
                                   "x0_m": (c0 - sample_off - 0.5) * pixel_m, "y0_m": (line_off - r0 + 0.5) * pixel_m}
    else:
        ppd = number("MAP_RESOLUTION")
        lat_max, lon_west = number("MAXIMUM_LATITUDE"), number("WESTERNMOST_LONGITUDE")
        half_lat = np.degrees(spec.half_width_m / MOON_RADIUS_M)
        half_lon = half_lat / np.cos(np.radians(lat))
        r0, r1 = int((lat_max - lat - half_lat) * ppd), int(np.ceil((lat_max - lat + half_lat) * ppd))
        c0, c1 = int((lon - lon_west - half_lon) * ppd), int(np.ceil((lon - lon_west + half_lon) * ppd))
        geometry = lambda r0, c0: {"kind": "cylindrical", "pixels_per_degree": ppd,
                                   "lat_top_deg": lat_max - r0 / ppd, "lon_left_deg": lon_west + c0 / ppd}
    r0, r1, c0, c1 = max(r0, 0), min(r1, lines), max(c0, 0), min(c1, samples)  # a window may run off the product
    meta = geometry(r0, c0)
    print(f"  {spec.name}: rows {r0}-{r1}, {(r1 - r0) * record / 1e6:.0f} MB from {spec.product.rsplit('/', 1)[1]}")
    raw = _curl(spec.product + (".img" if spec.kind == "cylindrical" else ".IMG"), "-r", f"{r0 * record}-{r1 * record - 1}")
    grid = np.frombuffer(raw, dtype=dtype).reshape(r1 - r0, record // dtype.itemsize)[:, c0:c1]
    heights = grid.astype(np.float32) * np.float32(scale * unit_m)
    if dtype.kind == "i":
        heights[grid == -32768] = np.nan
    np.save(out, heights)
    (WINDOWS_DIR / f"{spec.name}.json").write_text(json.dumps({**meta, "source": spec.product, "mission": spec.mission}, indent=1))
    return out


def load(name):
    meta = json.loads((WINDOWS_DIR / f"{name}.json").read_text())
    heights = np.load(WINDOWS_DIR / f"{name}.npy").astype(np.float64)
    if meta["kind"] == "polar":
        return PolarDem(heights, meta["x0_m"], meta["y0_m"], meta["pixel_m"], name)
    return CylindricalWindow(heights, meta["pixels_per_degree"], meta["lat_top_deg"], meta["lon_left_deg"], name)


def mission_windows(mission_id):
    """Downloaded windows for a mission, finest first."""
    dems = [load(s.name) for s in WINDOWS if s.mission == mission_id and (WINDOWS_DIR / f"{s.name}.npy").exists()]
    return sorted(dems, key=lambda d: d.pixel_m)


if __name__ == "__main__":
    for spec in WINDOWS:
        fetch(spec)
