"""Terrain patches for the Explorer's 3D view.

    uv run python pipeline/export_terrain3d.py

One patch per NASA candidate site (origin: its best-lit spot) and per CLPS landing site.
Each patch is two square height grids in the local east-north-up frame of its origin:
an inner grid (4 km at 10 m) and a near grid (16 km at 40 m) from the finest maps, and a
context grid (120 km at 400 m).
Every grid node (e, n) on the origin's tangent plane is projected to the sphere and given
the terrain height there, so the stored "up" value includes the lunar curvature drop:
z = (R + h) cos(c) - (R + h0), with c the node's central angle from the origin. One frame
per patch keeps the Sun a single direction vector everywhere in it.

Heights come from the same nested map lists as the horizons (5 m tile, LOLA 20 m and 80 m,
global; mission windows at CLPS sites), finest first. Stored as uint16 with an offset and a
scale per grid (quantisation < 0.2 m).

Writes web/data/terrain3d/<id>.bin and web/data/terrain3d/index.json.
"""

import csv
import json

import numpy as np

from lunazen.geometry import MOON_RADIUS_M, site_from_latlon
from lunazen.paths import ROOT, SITES
from lunazen.products import candidate_summary
from lunazen.sites import CANDIDATE_SITES
from lunazen.terrain import ground_height_dems, sample_heights_nested, site_dems
from lunazen.windows import mission_windows

OUT = ROOT / "web" / "data" / "terrain3d"
GRIDS = (("inner", 2_000.0, 10.0), ("near", 8_000.0, 40.0), ("context", 60_000.0, 400.0))  # name, half-width, spacing; finest first


def grid_heights(origin, dems, half_m, spacing_m):
    """Up-coordinates (m) of the terrain under a regular (east, north) grid on the origin's tangent plane."""
    n = int(round(2 * half_m / spacing_m)) + 1
    axis = -half_m + np.arange(n) * spacing_m
    east, north = np.meshgrid(axis, axis[::-1])  # row 0 is the northern edge
    r0 = np.linalg.norm(origin.position_m)
    p = origin.position_m + east[..., None] * origin.east + north[..., None] * origin.north
    d = p / np.linalg.norm(p, axis=-1, keepdims=True)
    lat, lon = np.arcsin(d[..., 2]), np.arctan2(d[..., 1], d[..., 0])
    h = sample_heights_nested(dems, lat, lon)
    cos_c = d @ origin.up
    z = (MOON_RADIUS_M + h) * cos_c - r0
    return z, n


def patch(pid, name, lat, lon, dems, spots):
    ground = ground_height_dems(lat, lon, dems)
    origin = site_from_latlon(lat, lon, ground)
    header = {"id": pid, "name": name, "origin": {"latitudeDeg": lat, "longitudeDeg": lon, "groundM": ground}, "grids": [], "spots": []}
    blobs = []
    offset = 0
    for gname, half, spacing in GRIDS:
        z, n = grid_heights(origin, dems, half, spacing)
        if np.isnan(z).any():
            raise ValueError(f"{pid} {gname}: {np.isnan(z).sum()} nodes outside every map")
        lo, hi = float(z.min()), float(z.max())
        scale = max(hi - lo, 1.0) / 65535.0
        q = np.round((z - lo) / scale).astype("<u2")
        header["grids"].append({"name": gname, "n": n, "halfM": half, "spacingM": spacing, "offsetM": lo, "scaleM": scale, "byteOffset": offset})
        blobs.append(q.tobytes())
        offset += q.nbytes
    for sid, slat, slon in spots:
        p = site_from_latlon(slat, slon, ground_height_dems(slat, slon, dems)).position_m - origin.position_m
        e, nn, u = origin.to_enu(p)
        header["spots"].append({"id": sid, "eM": float(e), "nM": float(nn), "zM": float(u)})
    (OUT / f"{pid}.bin").write_bytes(b"".join(blobs))
    return header


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    summary = candidate_summary()["spots"]
    index = []
    for site in CANDIDATE_SITES:
        spots = [s for s in summary if s["site"] == site.id]
        if not spots:
            continue
        centre = lambda s: next(q for q in s["points"] if q["offset_m"] == [0.0, 0.0])
        pts = [(s["spot"], centre(s)["latitude_deg"], centre(s)["longitude_deg"]) for s in spots]
        best = pts[0]
        dems = site_dems(best[1], site.id)
        index.append(patch(site.id, site.name, best[1], best[2], dems, pts))
        print(f"{site.id:10s} origin {best[0]}  {(OUT / f'{site.id}.bin').stat().st_size / 1e3:.0f} kB")
    with open(SITES / "missions.csv", newline="") as f:
        for m in csv.DictReader(f):
            lat, lon = float(m["latitude_deg"]), float(m["longitude_deg"])
            dems = mission_windows(m["id"]) + site_dems(lat)
            index.append(patch(m["id"], m["name"], lat, lon, dems, [(m["id"], lat, lon)]))
            print(f"{m['id']:10s} {(OUT / f'{m['id']}.bin').stat().st_size / 1e3:.0f} kB")
    (OUT / "index.json").write_text(json.dumps({"description": __doc__.strip().splitlines()[0], "patches": index}, separators=(",", ":")))


if __name__ == "__main__":
    main()
