"""Outline NASA's Artemis candidate landing regions in south-polar coordinates.

    uv run python pipeline/build_artemis_regions.py

Outlines: NASA's App Development Challenge 2023 handbook publishes, for each of the 13
regions NASA announced in August 2022, a 4000 x 4000 (or 5000) grid of latitudes and
longitudes. A region's outline is the edge of its grid. The grids are streamed and only
their edges kept (cached under data/external/artemis_regions/, ~3 GB of downloads).

Lists: the August 2022 announcement (13 regions) and the October 2024 update (9 regions,
announced for Artemis III; NASA redesignated Artemis III in 2026 as a low-Earth-orbit
demonstration, with Artemis IV as the first crewed landing). Four of the 2024 regions
are new and NASA has published no outline for them, so they carry a name only.

Writes data/sites/artemis_regions.json (committed).
"""

import json
import subprocess

import numpy as np

from lunazen.geometry import latlon_to_south_polar
from lunazen.paths import EXTERNAL, SITES

HANDBOOK = "https://www.nasa.gov/learning-resources/app-development-challenge/2023-handbook-and-coding-components"
BOX = "https://nasagov.app.box.com/index.php?rm=box_download_shared_file&shared_name=vkab7wf9sqyylzw1lwtd76g3bxquraui&file_id=f_"
SOURCES = {
    "2022": "https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/",
    "2024": "https://www.prnewswire.com/news-releases/nasa-provides-update-on-artemis-iii-moon-landing-regions-302288659.html",
    "2024_abstract": "https://www.hou.usra.edu/meetings/lpsc2026/pdf/1901.pdf",
    "outlines": HANDBOOK,
    "artemis_iii_redesignated": "https://www.nasa.gov/mission/artemis-iii/",
}
CACHE = EXTERNAL / "artemis_regions"
OUT = SITES / "artemis_regions.json"

# name, Box file ids of the latitude and longitude grids (ADC 2023 handbook)
REGIONS_2022 = (
    ("Amundsen Rim", "1200098001991", "1200097632358"),
    ("Connecting Ridge", "1200199927696", "1200211619193"),
    ("Connecting Ridge Extension", "1200210314706", "1200213989296"),
    ("de Gerlache Rim 1", "1200210221160", "1200214335589"),
    ("de Gerlache Rim 2", "1200216907696", "1200207969907"),
    ("de Gerlache-Kocher Massif", "1200258922045", "1200262455396"),
    ("Faustini Rim A", "1200261136900", "1200262994592"),
    ("Haworth", "1200265070424", "1200269604406"),
    ("Leibnitz Beta Plateau", "1200264192496", "1200269144326"),
    ("Malapert Massif", "1200270916868", "1200272604225"),
    ("Nobile Rim 1", "1200272254098", "1200271124362"),
    ("Nobile Rim 2", "1200270658787", "1200271414371"),
    ("Peak Near Shackleton", "1200273279538", "1200276014472"),
)
REGIONS_2024 = ("Peak near Cabeus B", "Haworth", "Malapert Massif", "Mons Mouton Plateau", "Mons Mouton",
                "Nobile Rim 1", "Nobile Rim 2", "de Gerlache Rim 2", "Slater Plain")

EDGES_PY = """
import json, sys
first = last = None
left, right = [], []
for line in sys.stdin:
    v = line.rstrip().split(",")
    if first is None:
        first = [float(x) for x in v]
    left.append(float(v[0])); right.append(float(v[-1]))
    last = v
json.dump({"top": first, "bottom": [float(x) for x in last], "left": left, "right": right}, sys.stdout)
"""


def grid_edges(name, kind, file_id):
    """Edges of one published grid (top, right, bottom, left), streamed and cached."""
    path = CACHE / f"{name.replace(' ', '_')}_{kind}.json"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        subprocess.run(f'curl -sfL --retry 5 --retry-all-errors "{BOX}{file_id}" | funzip | python3 -c \'{EDGES_PY}\' > "{tmp}"',
                       shell=True, check=True)
        tmp.rename(path)
        print(f"  {name} {kind}")
    return json.loads(path.read_text())


def outline(name, lat_id, lon_id):
    """The grid's four corners. Its edges are straight lines in our projection (checked to < 0.01 m)."""
    lat, lon = grid_edges(name, "lat", lat_id), grid_edges(name, "lon", lon_id)
    xy = []
    for e in (lat, lon):
        xy.append(np.array([e["top"][0], e["top"][-1], e["bottom"][-1], e["bottom"][0]]))
    x, y = latlon_to_south_polar(np.radians(xy[0]), np.radians(xy[1]))
    for side in ("top", "bottom", "left", "right"):
        ex, ey = latlon_to_south_polar(np.radians(lat[side]), np.radians(lon[side]))
        d = np.array([ex[-1] - ex[0], ey[-1] - ey[0]])
        off = np.abs((ex - ex[0]) * d[1] - (ey - ey[0]) * d[0]) / np.hypot(*d)
        assert off.max() < 0.01, f"{name} {side} edge is not straight ({off.max():.3f} m)"
    return np.column_stack([x, y])


def main():
    regions = []
    names_2022 = {name for name, _, _ in REGIONS_2022}
    for name, lat_id, lon_id in REGIONS_2022:
        xy = outline(name, lat_id, lon_id)
        regions.append({"name": name, "lists": ["2022"] + (["2024"] if name in REGIONS_2024 else []),
                        "outlineXyM": [[round(float(x), 1), round(float(y), 1)] for x, y in xy]})
    for name in REGIONS_2024:
        if name not in names_2022:
            regions.append({"name": name, "lists": ["2024"], "outlineXyM": None})
    data = {
        "description": "NASA Artemis candidate landing regions (about 15 km across). Outlines from the published 2022 region grids; "
                       "the October 2024 list was made for Artemis III, which NASA redesignated in 2026 as a low-Earth-orbit "
                       "demonstration (Artemis IV is now the first crewed landing). New 2024 regions have no published outline.",
        "projection": "south polar stereographic, R = 1737.4 km, metres",
        "sources": SOURCES,
        "regions": regions,
    }
    OUT.write_text(json.dumps(data, indent=1))
    for r in regions:
        span = "" if r["outlineXyM"] is None else "%.1f km" % (np.ptp(np.array(r["outlineXyM"])[:, 0]) / 1e3)
        print(f"{r['name']:28s} {'+'.join(r['lists']):10s} {span}")


if __name__ == "__main__":
    main()
