"""The Moon page's picture and its description agree (pipeline/export_moon_map.py)."""

import json

from PIL import Image

from lunazen.paths import ROOT

WEB_DATA = ROOT / "web" / "data"


def test_moon_map_matches_its_description():
    meta = json.loads((WEB_DATA / "moon_map.json").read_text())
    with Image.open(WEB_DATA / "moon_map.webp") as image:
        assert image.size == (meta["width"], meta["height"])
    # Simple cylindrical, whole Moon, near side in the middle: the page places sites by these four numbers.
    assert (meta["lonMinDeg"], meta["lonMaxDeg"], meta["latMaxDeg"], meta["latMinDeg"]) == (-180.0, 180.0, 90.0, -90.0)
    assert meta["width"] == 2 * meta["height"]
