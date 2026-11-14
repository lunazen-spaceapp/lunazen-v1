"""Polar-stereographic DEMs and multi-scale terrain-horizon ray tracing.

Heights are metres above the 1737.4 km reference sphere. Rays follow great
circles from the observer; the elevation angle of a terrain point at central
angle d and radius r1, seen from radius r0, is atan2(r1 cos d - r0, r1 sin d),
which includes lunar curvature exactly for a spherical reference.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from lunazen.geometry import MOON_RADIUS_M, latlon_to_south_polar
from lunazen.horizon import Horizon
from lunazen.paths import LOLA, PGDA

OBSERVER_HEIGHT_M = 2.0  # default eye height: lander solar arrays / antenna above the ground
MIN_RANGE_M = 10.0  # ignore the lander's own footprint and sub-pixel DEM noise


@dataclass
class PolarDem:
    """South-polar stereographic height grid (true scale at the pole)."""

    heights_m: np.ndarray  # (rows, cols); row 0 is the top (largest y)
    x0_m: float  # x of the left edge of column 0
    y0_m: float  # y of the top edge of row 0
    pixel_m: float
    name: str = ""

    def sample_latlon(self, lat_rad, lon_rad, method="bilinear"):
        x, y = latlon_to_south_polar(lat_rad, lon_rad)
        return self.sample(x, y, method)

    def sample(self, x_m, y_m, method="bilinear"):
        """Heights at polar-stereographic coordinates; NaN outside the grid or on no-data."""
        col = (np.asarray(x_m) - self.x0_m) / self.pixel_m
        row = (self.y0_m - np.asarray(y_m)) / self.pixel_m
        rows, cols = self.heights_m.shape
        if method == "nearest":
            r, c = np.floor(row).astype(np.int64), np.floor(col).astype(np.int64)
            ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
            out = np.full(np.shape(row), np.nan)
            out[ok] = self.heights_m[r[ok], c[ok]]
            return out
        # Bilinear on pixel centres.
        row, col = row - 0.5, col - 0.5
        r0, c0 = np.floor(row).astype(np.int64), np.floor(col).astype(np.int64)
        fr, fc = row - r0, col - c0
        ok = (r0 >= 0) & (r0 < rows - 1) & (c0 >= 0) & (c0 < cols - 1)
        out = np.full(np.shape(row), np.nan)
        r, c, a, b = r0[ok], c0[ok], fr[ok], fc[ok]
        h = self.heights_m
        out[ok] = (
            h[r, c] * (1 - a) * (1 - b)
            + h[r, c + 1] * (1 - a) * b
            + h[r + 1, c] * a * (1 - b)
            + h[r + 1, c + 1] * a * b
        )
        return out


def load_geotiff(path, nodata_below=-1e30):
    import rasterio

    with rasterio.open(path) as src:
        heights = src.read(1).astype(np.float64)
        if src.nodata is not None:
            heights[heights == src.nodata] = np.nan
        heights[heights < nodata_below] = np.nan
        t = src.transform
        assert abs(t.a + t.e) < 1e-9 and t.b == 0 and t.d == 0, "expects north-up square pixels"
        return PolarDem(heights, t.c, t.f, t.a, Path(path).name)


def _pds_label(path):
    text = Path(path).read_text(errors="replace")
    values = {}
    for key in ("LINES", "LINE_SAMPLES", "MAP_SCALE", "LINE_PROJECTION_OFFSET",
                "SAMPLE_PROJECTION_OFFSET", "SCALING_FACTOR", "SAMPLE_TYPE",
                "SAMPLE_BITS", "UNIT"):
        match = re.search(rf"^\s*{key}\s*=\s*([^\s]+)\s*(<[^>]*>)?", text, re.MULTILINE)
        if match:
            values[key] = (match.group(1).strip('"'), (match.group(2) or "").strip("<>").lower())
    return values


def _read_pds_raster(img_path):
    """Memory-mapped heights (m) and parsed label for a LOLA LDEM .IMG/.LBL pair.

    HEIGHT = DN * SCALING_FACTOR in the label's UNIT, relative to the 1737.4 km
    reference sphere (the label's OFFSET is that sphere's radius and is not
    added to heights). Handles 16-bit integer and 32-bit float products.
    """
    img_path = Path(img_path)
    label = _pds_label(img_path.with_suffix(".LBL"))
    rows, cols = int(label["LINES"][0]), int(label["LINE_SAMPLES"][0])
    sample_type = label["SAMPLE_TYPE"][0]
    bits = int(label.get("SAMPLE_BITS", ("32", ""))[0])
    endian = "<" if sample_type.startswith(("PC", "LSB")) else ">"
    kind = "f" if "REAL" in sample_type else "i"
    raw = np.memmap(img_path, dtype=f"{endian}{kind}{bits // 8}", mode="r", shape=(rows, cols))
    unit_m = 1000.0 if label.get("UNIT", ("METER", ""))[0].upper().startswith("KILO") else 1.0
    nodata = -32768 if kind == "i" else None
    return label, _ScaledMemmap(raw, float(label["SCALING_FACTOR"][0]) * unit_m, nodata)


def load_pds_img(img_path):
    """LOLA polar-stereographic LDEM product (south pole), memory-mapped."""
    label, heights_m = _read_pds_raster(img_path)
    scale, scale_unit = label["MAP_SCALE"]
    scale_m = float(scale) * (1000.0 if scale_unit.startswith("km") else 1.0)
    # 0-based pixel (row, col) centre: x = (col - SAMPLE_OFFSET) * scale,
    # y = (LINE_OFFSET - row) * scale.
    line_off = float(label["LINE_PROJECTION_OFFSET"][0])
    sample_off = float(label["SAMPLE_PROJECTION_OFFSET"][0])
    x0 = -(sample_off + 0.5) * scale_m
    y0 = (line_off + 0.5) * scale_m
    return PolarDem(heights_m, x0, y0, scale_m, Path(img_path).name)


@dataclass
class CylindricalDem:
    """Global simple-cylindrical height grid: row 0 at 90 deg N, column 0 at 0 deg E."""

    heights_m: np.ndarray
    pixels_per_degree: float
    name: str = ""

    def sample_latlon(self, lat_rad, lon_rad, method="bilinear"):
        rows, cols = self.heights_m.shape
        row = (90.0 - np.degrees(lat_rad)) * self.pixels_per_degree - 0.5
        col = np.mod(np.degrees(lon_rad), 360.0) * self.pixels_per_degree - 0.5
        if method == "nearest":
            r = np.clip(np.round(row).astype(np.int64), 0, rows - 1)
            c = np.mod(np.round(col).astype(np.int64), cols)
            return self.heights_m[r, c]
        r0 = np.clip(np.floor(row).astype(np.int64), 0, rows - 2)
        c0 = np.floor(col).astype(np.int64)
        fr, fc = np.clip(row - r0, 0.0, 1.0), col - c0
        c0, c1 = np.mod(c0, cols), np.mod(c0 + 1, cols)
        h = self.heights_m
        return (h[r0, c0] * (1 - fr) * (1 - fc) + h[r0, c1] * (1 - fr) * fc
                + h[r0 + 1, c0] * fr * (1 - fc) + h[r0 + 1, c1] * fr * fc)


def load_pds_cylindrical(img_path):
    """LOLA global LDEM_<n> simple-cylindrical product, memory-mapped."""
    label, heights_m = _read_pds_raster(img_path)
    text = Path(img_path).with_suffix(".LBL").read_text(errors="replace")
    ppd = float(re.search(r"MAP_RESOLUTION\s*=\s*([\d.]+)", text).group(1))
    assert heights_m.shape == (int(round(180 * ppd)), int(round(360 * ppd))), "expects a full global grid"
    assert re.search(r"CENTER_LONGITUDE\s*=\s*180", text), "expects columns starting at 0 deg E"
    return CylindricalDem(heights_m, ppd, Path(img_path).name)


class _ScaledMemmap:
    """Lazy scale/offset view so large DEMs stay memory-mapped."""

    def __init__(self, raw, factor, nodata=None):
        self.raw, self.factor, self.nodata = raw, factor, nodata
        self.shape = raw.shape

    def __getitem__(self, index):
        dn = np.asarray(self.raw[index])
        values = dn.astype(np.float64) * self.factor
        if self.nodata is not None:
            values[dn == self.nodata] = np.nan
        return np.where(np.abs(values) > 1e6, np.nan, values)


# ---------------------------------------------------------------------------
# Horizon ray tracing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DemLayer:
    """A DEM used for ray distances in [min_range_m, max_range_m] at step_m."""

    dem: PolarDem
    max_range_m: float
    step_m: float
    min_range_m: float = 0.0
    method: str = "bilinear"


def destination(lat_rad, lon_rad, azimuth_rad, central_angle):
    """Great-circle destination; azimuth arrays broadcast against central angles."""
    sin_lat2 = np.sin(lat_rad) * np.cos(central_angle) + np.cos(lat_rad) * np.sin(central_angle) * np.cos(azimuth_rad)
    lat2 = np.arcsin(np.clip(sin_lat2, -1.0, 1.0))
    lon2 = lon_rad + np.arctan2(
        np.sin(azimuth_rad) * np.sin(central_angle) * np.cos(lat_rad),
        np.cos(central_angle) - np.sin(lat_rad) * sin_lat2,
    )
    return lat2, lon2


def trace_horizon(latitude_deg, longitude_deg, ground_elevation_m, layers, azimuth_step_deg=0.25,
                  observer_height_m=0.0, radius_m=MOON_RADIUS_M, chunk=64):
    """Band tracer: each DemLayer is sampled at a fixed step over its own distance band,
    and the horizon is the maximum over all layers.

    Used for synthetic-terrain tests and to reproduce the project's original Stage 3
    settings (one 5 m tile, 5 m steps to 2 km). Production uses trace_horizon_nested:
    overlapping bands let a coarse map's near-field noise raise the horizon.

    Returns (Horizon, distance_m, source_layer_index) where distance and source
    identify the terrain point that sets the horizon at each azimuth.
    """
    azimuths = np.arange(0.0, 360.0, azimuth_step_deg)
    lat, lon = np.radians(latitude_deg), np.radians(longitude_deg)
    r0 = radius_m + ground_elevation_m + observer_height_m

    best = np.full(azimuths.size, -np.inf)
    best_distance = np.full(azimuths.size, np.nan)
    best_layer = np.full(azimuths.size, -1)

    for layer_index, layer in enumerate(layers):
        distances = np.arange(max(layer.min_range_m, layer.step_m), layer.max_range_m + 0.5 * layer.step_m, layer.step_m)
        delta = distances / radius_m
        for start in range(0, azimuths.size, chunk):
            az = np.radians(azimuths[start:start + chunk])[:, None]
            lat2, lon2 = destination(lat, lon, az, delta[None, :])
            h = layer.dem.sample_latlon(lat2, lon2, layer.method)
            r1 = radius_m + h
            angle = np.degrees(np.arctan2(r1 * np.cos(delta) - r0, r1 * np.sin(delta)))
            angle = np.where(np.isfinite(angle), angle, -np.inf)
            idx = np.argmax(angle, axis=1)
            peak = angle[np.arange(angle.shape[0]), idx]
            better = peak > best[start:start + chunk]
            sl = np.arange(start, start + az.shape[0])[better]
            best[sl] = peak[better]
            best_distance[sl] = distances[idx[better]]
            best_layer[sl] = layer_index

    return Horizon(azimuths, best), best_distance, best_layer


def ray_distances(min_range_m, max_range_m, step_min_m=5.0, k=400.0):
    """Sample distances along a ray: step = max(step_min, d / k).

    Near the site the step equals the finest DEM resolution; far away it grows in
    proportion to distance, so the angular sampling stays roughly constant.
    """
    distances = [max(min_range_m, step_min_m)]
    while distances[-1] < max_range_m:
        distances.append(distances[-1] + max(step_min_m, distances[-1] / k))
    return np.array(distances)


def trace_horizon_nested(latitude_deg, longitude_deg, ground_elevation_m, dems, azimuth_step_deg=0.25,
                         observer_height_m=OBSERVER_HEIGHT_M, min_range_m=MIN_RANGE_M, max_range_m=300_000.0,
                         step_min_m=5.0, k=400.0, radius_m=MOON_RADIUS_M, chunk=64):
    """Production horizon tracer: one ray per azimuth through a priority list of DEMs.

    At each sample the height comes from the first (finest) DEM in `dems` that covers
    it, so a ray moves seamlessly from a 5 m tile to 20 m and 80 m maps wherever each
    one ends. Returns (Horizon, distance_m, source_dem_index).
    """
    azimuths = np.arange(0.0, 360.0, azimuth_step_deg)
    lat, lon = np.radians(latitude_deg), np.radians(longitude_deg)
    r0 = radius_m + ground_elevation_m + observer_height_m
    distances = ray_distances(min_range_m, max_range_m, step_min_m, k)
    delta = distances / radius_m

    best = np.full(azimuths.size, -np.inf)
    best_distance = np.full(azimuths.size, np.nan)
    best_source = np.full(azimuths.size, -1)
    for start in range(0, azimuths.size, chunk):
        az = np.radians(azimuths[start:start + chunk])[:, None]
        lat2, lon2 = destination(lat, lon, az, delta[None, :])
        h = np.full(lat2.shape, np.nan)
        source = np.full(lat2.shape, -1)
        for index, dem in enumerate(dems):
            missing = np.isnan(h)
            if not missing.any():
                break
            h[missing] = dem.sample_latlon(lat2[missing], lon2[missing])
            source[missing & ~np.isnan(h)] = index
        r1 = radius_m + h
        angle = np.degrees(np.arctan2(r1 * np.cos(delta) - r0, r1 * np.sin(delta)))
        angle = np.where(np.isfinite(angle), angle, -np.inf)
        idx = np.argmax(angle, axis=1)
        rows = np.arange(angle.shape[0])
        best[start:start + chunk] = angle[rows, idx]
        best_distance[start:start + chunk] = distances[idx]
        best_source[start:start + chunk] = source[rows, idx]
    return Horizon(azimuths, best), best_distance, best_source


# ---------------------------------------------------------------------------
# Production DEM lists
# ---------------------------------------------------------------------------


def pgda_tile_path(site):
    return PGDA / site / f"{site}_final_adj_5mpp_surf.tif"


def polar_dems(site_tile=None):
    """Priority list for trace_horizon_nested: optional 5 m PGDA tile, LOLA 20 m, LOLA 80 m."""
    dems = [load_geotiff(pgda_tile_path(site_tile))] if site_tile else []
    return dems + [load_pds_img(LOLA / "LDEM_85S_20M.IMG"), load_pds_img(LOLA / "LDEM_80S_80M.IMG")]


def sample_heights_nested(dems, lat_rad, lon_rad):
    """Heights at many points from the first (finest) DEM in a priority list that covers each."""
    lat_rad, lon_rad = np.asarray(lat_rad, float), np.asarray(lon_rad, float)
    h = np.full(lat_rad.shape, np.nan)
    for dem in dems:
        missing = np.isnan(h)
        if not missing.any():
            break
        h[missing] = dem.sample_latlon(lat_rad[missing], lon_rad[missing])
    return h


def ground_height_dems(latitude_deg, longitude_deg, dems):
    """Terrain height at a site from the first DEM in a priority list that covers it."""
    lat, lon = np.radians([latitude_deg]), np.radians([longitude_deg])
    for dem in dems:
        h = dem.sample_latlon(lat, lon)[0]
        if np.isfinite(h):
            return float(h)
    raise ValueError("site is outside every DEM")


def site_dems(latitude_deg, site_tile=None):
    """Priority DEM list for any site: polar maps (plus an optional 5 m tile) near the
    south pole, always backed by the global map so rays never run off the edge."""
    global_dem = load_pds_cylindrical(LOLA / "LDEM_64.IMG")
    return (polar_dems(site_tile) + [global_dem]) if latitude_deg < -79.0 else [global_dem]
