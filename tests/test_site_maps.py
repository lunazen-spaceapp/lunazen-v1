"""The Map's site close-ups (pipeline/export_site_maps.py) are NASA's native 60 m values over a 20 m hillshade."""

import json

import numpy as np
import pytest
from PIL import Image

from lunazen.paths import ILLUMINATION, ROOT
from lunazen.terrain import load_pds_img

WEB = ROOT / "web" / "data"
SITEMAP = WEB / "sitemap"
pytestmark = pytest.mark.skipif(not (SITEMAP / "site_map.json").exists(), reason="run pipeline/export_site_maps.py")


@pytest.fixture(scope="module")
def catalogue():
    return json.loads((SITEMAP / "site_map.json").read_text())


def test_every_custom_site_has_a_close_up(catalogue):
    custom = json.loads((WEB / "custom" / "custom.json").read_text())
    assert [s["id"] for s in catalogue["sites"]] == [s["id"] for s in custom["sites"]]
    assert len(catalogue["viridis"]) == 256


def test_files_have_the_declared_sizes(catalogue):
    for s in catalogue["sites"]:
        v = s["values"]
        assert (SITEMAP / v["file"]).stat().st_size == v["rows"] * v["cols"] * 2
        with Image.open(SITEMAP / s["shade"]["file"]) as img:
            assert img.size == (s["shade"]["cols"], s["shade"]["rows"])
        box = s["box"]
        assert box["x1M"] - box["x0M"] == pytest.approx(s["shade"]["cols"] * s["shade"]["pixelM"])
        # the 60 m grid covers the box and starts less than one pixel outside it
        assert v["x0M"] <= box["x0M"] < v["x0M"] + v["pixelM"]
        assert v["y1M"] >= box["y1M"] > v["y1M"] - v["pixelM"]


@pytest.mark.skipif(not (ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG").exists(), reason="run scripts/fetch_data.sh")
def test_values_are_nasas_native_60m_pixels(catalogue):
    dems = [load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG"), load_pds_img(ILLUMINATION / "AVGVISIB_85S_060M_201608_EARTH.IMG")]
    rng = np.random.default_rng(3)
    for s in catalogue["sites"][:3]:
        v = s["values"]
        grid = np.frombuffer((SITEMAP / v["file"]).read_bytes(), dtype=np.uint8).reshape(v["rows"], v["cols"], 2)
        for _ in range(20):
            r, c = int(rng.integers(0, v["rows"])), int(rng.integers(0, v["cols"]))
            x, y = v["x0M"] + (c + 0.5) * v["pixelM"], v["y1M"] - (r + 0.5) * v["pixelM"]
            for k, dem in enumerate(dems):
                col, row = int((x - dem.x0_m) // dem.pixel_m), int((dem.y0_m - y) // dem.pixel_m)
                if 0 <= row < dem.heights_m.shape[0] and 0 <= col < dem.heights_m.shape[1]:
                    want = int(round(min(max(float(np.asarray(dem.heights_m[row:row + 1, col:col + 1])[0, 0]), 0), 1) * 100))
                    assert grid[r, c, k] == want
                else:
                    assert grid[r, c, k] == catalogue["values"]["noData"]
