"""NASA candidate landing sites: PGDA 5 m tiles, slope maps and regions of interest.

Sites and their 5 m DEMs come from NASA PGDA ("High-Resolution LOLA Topography for
Lunar South Pole Sites"; the method is Barker et al. 2021, which covers Sites 1, 4, 7 and 11;
site numbering from Mazarico et al. 2011). We use 13 of the 27 PGDA entries (Site20v2 is Site20 with extended boundaries), chosen by a stated rule
(pipeline/evaluate_sites.py, data/sites/site_selection.csv): the tile lies in a NASA Artemis candidate region, or NASA
published regions of interest and Barker et al. 2021 give error estimates for it (Sites 1, 4, 7, 11; this adds Site04,
Shackleton rim), and NASA's 60 m average-visibility map, which the spots are chosen from, covers part of the tile.
That map stops at 85 S, so DM1 (Amundsen rim, in an Artemis region) is left out, and DM2 (Nobile rim 2) is covered
only in a corner (17 % of its tile). Barker et al. 2021 give error estimates for four of ours (Sites 1, 4, 7, 11); no published error analysis
was found for the other ten.
NASA provides region-of-interest polygons for four sites. They outline areas whose
average illumination exceeds 70 % (file name "..._regionProps_avgillGT070"). For the
other sites the analysis area is the tile interior.
"""

import json
import struct
import tarfile
from dataclasses import dataclass

import numpy as np

from lunazen.paths import PGDA, SITES


@dataclass(frozen=True)
class CandidateSite:
    id: str  # PGDA directory name
    name: str
    has_roi: bool


CANDIDATE_SITES = (
    CandidateSite("Site01", "Connecting ridge", True),
    CandidateSite("Site04", "Shackleton rim", True),
    CandidateSite("Site06", "Nobile rim 1", False),
    CandidateSite("Site07", "Peak near Shackleton", True),
    CandidateSite("Site11", "de Gerlache rim", True),
    CandidateSite("Site20", "Leibnitz beta plateau", False),
    CandidateSite("Site23", "Malapert massif", False),
    CandidateSite("Site42", "de Gerlache-Kocher massif", False),
    CandidateSite("Haworth", "Haworth", False),
    CandidateSite("DM2", "Nobile rim 2", False),
    CandidateSite("SL2", "de Gerlache rim 2", False),
    CandidateSite("SL3", "Connecting ridge extension", False),
    CandidateSite("LM7", "Faustini rim A", False),
)
SITES_BY_ID = {site.id: site for site in CANDIDATE_SITES}


def tile_path(site_id, kind="surf"):
    return PGDA / site_id / f"{site_id}_final_adj_5mpp_{kind}.tif"


def read_shapefile_polygons(shp_bytes):
    """Polygons (list of (N, 2) arrays, one per ring) from an ESRI .shp (shape type 5)."""
    rings = []
    offset = 100  # file header
    while offset < len(shp_bytes):
        _, content_words = struct.unpack(">ii", shp_bytes[offset:offset + 8])
        record = shp_bytes[offset + 8:offset + 8 + 2 * content_words]
        offset += 8 + 2 * content_words
        shape_type = struct.unpack("<i", record[:4])[0]
        if shape_type != 5:
            continue
        num_parts, num_points = struct.unpack("<ii", record[36:44])
        parts = list(struct.unpack(f"<{num_parts}i", record[44:44 + 4 * num_parts])) + [num_points]
        start = 44 + 4 * num_parts
        points = np.frombuffer(record[start:start + 16 * num_points], dtype="<f8").reshape(-1, 2)
        rings += [points[a:b].copy() for a, b in zip(parts[:-1], parts[1:])]
    return rings


def roi_polygons(site_id):
    """NASA ROI polygons for a site, in south-polar stereographic metres (empty if none)."""
    archive = PGDA / site_id / f"{site_id}_ROIs.tgz"
    if not archive.exists():
        return []
    with tarfile.open(archive) as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith(".shp"))
        return read_shapefile_polygons(tar.extractfile(member).read())


def artemis_regions():
    """NASA Artemis candidate landing regions (data/sites/artemis_regions.json, pipeline/build_artemis_regions.py)."""
    return json.loads((SITES / "artemis_regions.json").read_text())


def artemis_regions_at(x_m, y_m, regions=None, region_m=15_000.0):
    """Artemis regions whose published data area (a 16-30 km square) contains a south-polar point.

    NASA describes each region as about 15 km across, smaller than its data area, so each match
    also says whether the point lies in the concentric 15 km square ("central"). Regions may overlap.
    """
    from matplotlib.path import Path as PolygonPath

    regions = artemis_regions()["regions"] if regions is None else regions
    found = []
    for r in regions:
        if r["outlineXyM"] is None:
            continue
        xy = np.array(r["outlineXyM"])
        if PolygonPath(xy).contains_point((x_m, y_m)):
            centre = xy.mean(axis=0)
            core = centre + (xy - centre) * region_m / np.hypot(*(xy[1] - xy[0]))
            found.append({"name": r["name"], "central": bool(PolygonPath(core).contains_point((x_m, y_m)))})
    return found


def tile_interior(dem, margin_m=2_000.0):
    """Rectangle (as a ring) covering a PolarDem tile minus a margin on each side."""
    rows, cols = dem.heights_m.shape
    x0, x1 = dem.x0_m + margin_m, dem.x0_m + cols * dem.pixel_m - margin_m
    y1, y0 = dem.y0_m - margin_m, dem.y0_m - rows * dem.pixel_m + margin_m
    return np.array([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
