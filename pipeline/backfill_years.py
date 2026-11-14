"""Add the other precomputed years (lunazen.mission.YEARS) to candidate_sites_summary.json from the stored horizons.

No terrain is traced: each point's horizon is read from candidate_sites.npz and summarised for every year.
The 2027 values already in the file are checked against the recomputation and must not change.

    uv run python pipeline/backfill_years.py
"""
import json

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels
from lunazen.mission import YEARS, summarize_years
from lunazen.paths import PRODUCTS

SUMMARY = PRODUCTS / "candidate_sites_summary.json"
KEYS = ("sunlitFraction", "earthFraction", "bothFraction", "energyWhPerW",
        "longestDarkHours", "longestCommsGapHours", "dsnLinkFraction", "longestDsnLinkGapHours")

summary = json.loads(SUMMARY.read_text())
data = np.load(PRODUCTS / "candidate_sites.npz")
step = float(data["azimuth_step_deg"])
row = 0
with spice_kernels():
    for spot in summary["spots"]:
        for p in spot["points"]:
            assert str(data["spot"][row]) == spot["spot"] and abs(float(data["mast_m"][row]) - p["mast_m"]) < 1e-9
            cdeg = data["horizon_cdeg"][row].astype(float) / 100.0
            horizon = Horizon(np.arange(cdeg.size) * step, cdeg)
            s = site_from_latlon(p["latitude_deg"], p["longitude_deg"], p["ground_m"] + p["mast_m"])
            years = summarize_years(s, horizon)
            for k, v in p["year_2027"].items():
                assert abs(years["2027"][k] - v) <= 1e-9 * max(1, abs(v)), (spot["spot"], p["offset_m"], k)
            p["years"] = {y: {k: m[k] for k in KEYS} for y, m in years.items()}
            row += 1
assert row == len(data["spot"])
summary["method"]["years"] = [int(y) for y in YEARS]
SUMMARY.write_text(json.dumps(summary, indent=1))
print("added", ", ".join(map(str, YEARS)), "to", row, "points")
