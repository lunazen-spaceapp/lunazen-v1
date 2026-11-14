"""The 3D view's terrain patches hold the same terrain as the validated horizons.

From the eye (2 m above each patch origin), march the patch grids along 36 azimuths and
compare the highest elevation angle with trace_horizon_nested over the same range (55 km).
Measured (2026-10-12): median |difference| <= 0.03 deg, 90th percentile <= 0.15 deg, worst
0.37 deg (Site04), from the 10 m / 40 m / 400 m grid spacing.
"""

import csv
import json

import numpy as np
import pytest

from lunazen.paths import ROOT, SITES
from conftest import needs_dems

PATCHES = ROOT / "web" / "data" / "terrain3d"
pytestmark = pytest.mark.skipif(not (PATCHES / "index.json").exists(), reason="run pipeline/export_terrain3d.py")


def load(patch):
    raw = (PATCHES / f"{patch['id']}.bin").read_bytes()
    out = []
    for g in patch["grids"]:
        a = np.frombuffer(raw, "<u2", g["n"] * g["n"], g["byteOffset"]).reshape(g["n"], g["n"]).astype(float)
        out.append((g, g["offsetM"] + a * g["scaleM"]))
    return out


def height(grids, e, n):
    for g, z in grids:  # finest first, as the renderer samples
        col, row = (e + g["halfM"]) / g["spacingM"], (g["halfM"] - n) / g["spacingM"]
        if 0 <= col < g["n"] - 1 and 0 <= row < g["n"] - 1:
            c0, r0 = int(col), int(row)
            fc, fr = col - c0, row - r0
            return (z[r0, c0] * (1 - fr) * (1 - fc) + z[r0, c0 + 1] * (1 - fr) * fc
                    + z[r0 + 1, c0] * fr * (1 - fc) + z[r0 + 1, c0 + 1] * fr * fc)
    return None


def patch_horizon(grids, azimuth_deg, eye_m=2.0, max_m=55_000.0):
    best, d = -90.0, 10.0
    s, c = np.sin(np.radians(azimuth_deg)), np.cos(np.radians(azimuth_deg))
    while d < max_m:
        h = height(grids, d * s, d * c)
        if h is None:
            break
        best = max(best, np.degrees(np.arctan2(h - eye_m, d)))
        d = max(d + 5.0, d * 1.0025)
    return best


def test_patch_headers_are_consistent():
    index = json.loads((PATCHES / "index.json").read_text())["patches"]
    assert len(index) == 13
    for p in index:
        size = (PATCHES / f"{p['id']}.bin").stat().st_size
        assert size == sum(g["n"] ** 2 * 2 for g in p["grids"])
        assert [g["name"] for g in p["grids"]] == ["inner", "near", "context"]


@needs_dems
@pytest.mark.parametrize("pid", ["Site01", "Site04", "bg1"])
def test_patch_horizon_matches_the_traced_horizon(pid):
    from lunazen.terrain import site_dems, trace_horizon_nested
    from lunazen.windows import mission_windows

    patch = next(p for p in json.loads((PATCHES / "index.json").read_text())["patches"] if p["id"] == pid)
    o = patch["origin"]
    with open(SITES / "missions.csv", newline="") as f:
        missions = {m["id"] for m in csv.DictReader(f)}
    dems = mission_windows(pid) + site_dems(o["latitudeDeg"]) if pid in missions else site_dems(o["latitudeDeg"], pid)
    ref, _, _ = trace_horizon_nested(o["latitudeDeg"], o["longitudeDeg"], o["groundM"], dems, 10.0, observer_height_m=2.0, max_range_m=55_000)
    grids = load(patch)
    d = np.abs(np.array([patch_horizon(grids, a) for a in ref.azimuth_deg]) - ref.elevation_deg)
    assert np.median(d) < 0.05 and np.percentile(d, 90) < 0.2 and d.max() < 0.5, (np.median(d), np.percentile(d, 90), d.max())
