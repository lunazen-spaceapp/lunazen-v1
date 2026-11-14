"""Custom points near the south pole from browser-sized terrain (reference for web/engine/tracer.js).

A browser cannot carry the 5 m tiles or the 20/80 m polar maps, but a point inside one of our site tiles can be
traced from two small grids: the site's own 5 m tile averaged to CROP_FACTOR x 5 m (near field) and LOLA's 80 m polar
map averaged to FAR_FACTOR x 80 m (far field). Against the stored 5 m/20 m/80 m horizons of all spots this reproduces
the longest dark stretch to a median of about 1 h (validation/custom_location_accuracy.json). Heights are stored as
int16: offsetM + value * scaleM per grid (0.1 m for a crop, 0.25 m for the far field); -32768 is no data.

    uv run python pipeline/export_custom_terrain.py     # writes web/data/custom/
"""

import json

import numpy as np

from lunazen.geometry import latlon_to_south_polar, south_polar_to_latlon
from lunazen.paths import LOLA, ROOT
from lunazen.sites import CANDIDATE_SITES, tile_interior, tile_path
from lunazen.terrain import OBSERVER_HEIGHT_M, PolarDem, load_geotiff, load_pds_img, trace_horizon_nested

OUT = ROOT / "web" / "data" / "custom"
CROP_FACTOR = 4  # 5 m tile -> 20 m
FAR_FACTOR = 6  # LOLA 80 m -> 480 m
CROP_SCALE_M = 0.1
FAR_SCALE_M = 0.25
NODATA = -32768
MARGIN_M = 2000.0  # custom points stay this far inside a tile, like the candidate spots
RING_RADII_M = (50.0, 100.0)  # landing-position spread, as pipeline/build_candidate_sites.py
RING_POINTS = 6


def block_mean(heights, factor):
    n_r, n_c = (heights.shape[0] // factor) * factor, (heights.shape[1] // factor) * factor
    blocks = np.asarray(heights[:n_r, :n_c]).reshape(n_r // factor, factor, n_c // factor, factor)
    with np.errstate(all="ignore"):
        return np.nanmean(blocks, axis=(1, 3))


def quantise(heights, scale_m):
    """(int16 values, offset m): height = offset + value * scale."""
    offset = float(np.round((np.nanmin(heights) + np.nanmax(heights)) / 2))
    q = np.round((heights - offset) / scale_m)
    q[~np.isfinite(q)] = NODATA
    if np.abs(q[q != NODATA]).max() >= 32767:
        raise ValueError("heights do not fit int16 at this scale")
    return q.astype("<i2"), offset


def dequantise(q, scale_m, offset_m):
    h = offset_m + q.astype(np.float64) * scale_m
    h[q == NODATA] = np.nan
    return h


def accuracy():
    """The measured accuracy the Map quotes (validation/custom_location_accuracy.py), rounded for display."""
    path = ROOT / "validation" / "custom_location_accuracy.json"
    if not path.exists():
        return None
    r = json.loads(path.read_text())
    return {"spots": r["spots"], "horizonRmsDeg": round(r["horizon_rms_deg"], 2),
            "sunShareMedianPp": round(r["sun_share_pp"]["median"], 1), "sunShareP90Pp": round(r["sun_share_pp"]["p90"], 1),
            "darkMedianH": round(r["longest_dark_h"]["median"], 1), "darkP90H": round(r["longest_dark_h"]["p90"], 1),
            "darkMaxH": round(r["longest_dark_h"]["max"])}


def export():
    """Write the crops, the far field and the manifest."""
    OUT.mkdir(parents=True, exist_ok=True)
    sites = []
    for site in CANDIDATE_SITES:
        tile = load_geotiff(tile_path(site.id, "surf"))
        crop = block_mean(tile.heights_m, CROP_FACTOR)
        q, offset = quantise(crop, CROP_SCALE_M)
        (OUT / f"{site.id}.bin").write_bytes(q.tobytes())
        ring = tile_interior(tile, MARGIN_M)
        (x0, y0), (x1, y1) = ring.min(axis=0), ring.max(axis=0)
        sites.append({"id": site.id, "name": site.name, "file": f"{site.id}.bin", "x0M": tile.x0_m, "y0M": tile.y0_m,
                      "pixelM": tile.pixel_m * CROP_FACTOR, "scaleM": CROP_SCALE_M, "offsetM": offset, "rows": q.shape[0], "cols": q.shape[1],
                      "interior": {"xMinM": float(x0), "xMaxM": float(x1), "yMinM": float(y0), "yMaxM": float(y1)}})
    d80 = load_pds_img(LOLA / "LDEM_80S_80M.IMG")
    far_q, far_offset = quantise(block_mean(d80.heights_m[:, :], FAR_FACTOR), FAR_SCALE_M)
    (OUT / "far.bin").write_bytes(far_q.tobytes())
    manifest = {
        "format": "int16 little-endian, rows x cols, row 0 at the top (largest y); height_m = offsetM + value * scaleM; -32768 = no data",
        "noData": NODATA, "cropFactor": CROP_FACTOR, "farFactor": FAR_FACTOR,
        "far": {"file": "far.bin", "x0M": d80.x0_m, "y0M": d80.y0_m, "pixelM": d80.pixel_m * FAR_FACTOR,
                "scaleM": FAR_SCALE_M, "offsetM": far_offset,
                "rows": far_q.shape[0], "cols": far_q.shape[1]},
        "accuracy": accuracy(),
        "sites": sites,
    }
    (OUT / "custom.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def load(out=OUT):
    """(manifest, far PolarDem, {site id: PolarDem}) from the exported files."""
    manifest = json.loads((out / "custom.json").read_text())
    def grid(entry, name):
        q = np.fromfile(out / entry["file"], dtype="<i2").reshape(entry["rows"], entry["cols"])
        return PolarDem(dequantise(q, entry["scaleM"], entry["offsetM"]), entry["x0M"], entry["y0M"], entry["pixelM"], name)
    far = grid(manifest["far"], "far")
    crops = {s["id"]: grid(s, s["id"]) for s in manifest["sites"]}
    return manifest, far, crops


def locate(manifest, lat_deg, lon_deg):
    """The site whose tile interior contains the point, or None."""
    x, y = latlon_to_south_polar(np.radians(lat_deg), np.radians(lon_deg))
    for s in manifest["sites"]:
        i = s["interior"]
        if i["xMinM"] <= x <= i["xMaxM"] and i["yMinM"] <= y <= i["yMaxM"]:
            return s["id"]
    return None


def trace(lat_deg, lon_deg, site_id, far, crops, mast_m=OBSERVER_HEIGHT_M):
    """(Horizon, ground height m) at a point from the site's crop and the far field."""
    dems = [crops[site_id], far]
    ground = float(crops[site_id].sample_latlon(np.radians([lat_deg]), np.radians([lon_deg]))[0])
    if not np.isfinite(ground):
        ground = float(far.sample_latlon(np.radians([lat_deg]), np.radians([lon_deg]))[0])
    horizon, _, _ = trace_horizon_nested(lat_deg, lon_deg, ground, dems, 0.25, observer_height_m=mast_m)
    return horizon, ground


def ring_points(lat_deg, lon_deg):
    """The 12 points 50 m and 100 m around a point: [(lat, lon, (dx, dy))]."""
    x, y = latlon_to_south_polar(np.radians(lat_deg), np.radians(lon_deg))
    points = []
    for radius in RING_RADII_M:
        for k in range(RING_POINTS):
            a = 2 * np.pi * (k + 0.5 * (radius == RING_RADII_M[1])) / RING_POINTS
            dx, dy = radius * np.sin(a), radius * np.cos(a)
            lat, lon = south_polar_to_latlon(x + dx, y + dy)
            points.append((float(lat), float(lon), (float(dx), float(dy))))
    return points
