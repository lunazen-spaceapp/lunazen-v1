"""How well do the browser's custom points match the stored horizons?

Traces every candidate spot (2 m mast) from the exported browser grids (lunazen/custom.py: the site's 20 m crop plus the
480 m far field) and compares it with the stored 5 m/20 m/80 m horizons: horizon elevation error, sunlit-share error
and longest-dark error for 2027. Also records the earlier result of tracing from one coarse polar map alone, which
is why the browser carries per-site crops. Result: validation/custom_location_accuracy.json; the Map shows these numbers.

    uv run python pipeline/export_custom_terrain.py
    uv run python validation/custom_location_accuracy.py     # about 5 minutes
    uv run python pipeline/export_custom_terrain.py          # again, to copy the numbers into web/data/custom/custom.json
"""
import json

import numpy as np

from lunazen import custom
from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels
from lunazen.mission import summarize_years
from lunazen.paths import PRODUCTS, ROOT

RESULT = ROOT / "validation" / "custom_location_accuracy.json"


def main():
    manifest, far, crops = custom.load()
    summary = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())
    data = np.load(PRODUCTS / "candidate_sites.npz")
    index = {(str(s), float(m), int(p)): i for i, (s, m, p) in enumerate(zip(data["spot"], data["mast_m"], data["point"]))}
    errs, dsun, ddark, skipped = [], [], [], []
    with spice_kernels():
        for s in summary["spots"]:
            p0 = next(p for p in s["points"] if p["offset_m"] == [0.0, 0.0] and p["mast_m"] == 2.0)
            lat, lon = p0["latitude_deg"], p0["longitude_deg"]
            site_id = custom.locate(manifest, lat, lon)
            if site_id is None:
                skipped.append(s["spot"])
                continue
            horizon, ground = custom.trace(lat, lon, site_id, far, crops)
            e = horizon.elevation_deg - data["horizon_cdeg"][index[(s["spot"], 2.0, 0)]].astype(float) / 100.0
            errs.append(e[np.isfinite(e)])
            y = summarize_years(site_from_latlon(lat, lon, ground + 2.0),
                                Horizon(horizon.azimuth_deg, np.round(horizon.elevation_deg * 100) / 100), years=(2027,))["2027"]
            dsun.append(abs(y["sunlitFraction"] - p0["year_2027"]["sunlitFraction"]) * 100)
            ddark.append(abs(y["longestDarkHours"] - p0["year_2027"]["longestDarkHours"]))
    e = np.concatenate(errs)
    previous = json.loads(RESULT.read_text())
    result = {
        "source": "browser grids (20 m site crop + 480 m far field) vs stored horizons, spots inside a tile interior, 2 m mast, 2027",
        "spots": len(dsun), "skipped_outside_interior": skipped,
        "horizon_rms_deg": float(np.sqrt(np.mean(e**2))), "horizon_p95_abs_deg": float(np.percentile(np.abs(e), 95)),
        "sun_share_pp": {"median": float(np.median(dsun)), "p90": float(np.percentile(dsun, 90)), "max": float(max(dsun))},
        "longest_dark_h": {"median": float(np.median(ddark)), "p90": float(np.percentile(ddark, 90)), "max": float(max(ddark))},
        "single_coarse_map": previous.get("single_coarse_map", previous.get("by_factor")),
    }
    RESULT.write_text(json.dumps(result, indent=1))
    print(json.dumps({k: v for k, v in result.items() if k != "single_coarse_map"}, indent=1))


if __name__ == "__main__":
    main()
