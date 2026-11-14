"""What does tracing a mid-latitude site from the global 474 m LOLA map alone cost?

Blue Ghost 1 (Mare Crisium) is the one site away from the pole where a finer map is on disk (SLDEM2015, ~59 m).
Compares its horizon and the first sunset after landing, with and without that window.
Result: validation/beyond_accuracy.json (quoted by the app next to the "beyond the pole" sites).

    uv run python validation/beyond_accuracy.py
"""
import csv
import json

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import et_to_utc, spice_kernels, utc_to_et
from lunazen.paths import ROOT, SITES
from lunazen.terrain import OBSERVER_HEIGHT_M, ground_height_dems, site_dems, trace_horizon_nested
from lunazen.visibility import sun_state
from lunazen.windows import mission_windows

RESULT = ROOT / "validation" / "beyond_accuracy.json"


def first_set(site, horizon, et0, days=20):
    ets = et0 + np.arange(0, days * 86400, 300.0)
    fraction = sun_state(ets, site, horizon)["fraction"]
    return float(ets[np.argmax(fraction <= 0.0)])


def main():
    row = next(r for r in csv.DictReader(open(SITES / "missions.csv", newline="")) if r["id"] == "bg1")
    lat, lon, et0 = float(row["latitude_deg"]), float(row["longitude_deg"]), None
    with spice_kernels():
        et0 = utc_to_et(row["landed_utc"])
        out = {}
        for name, dems in (("global_474m", site_dems(lat)), ("sldem2015_window", mission_windows("bg1") + site_dems(lat))):
            ground = ground_height_dems(lat, lon, dems)
            h, _, _ = trace_horizon_nested(lat, lon, ground, dems, 0.25, observer_height_m=OBSERVER_HEIGHT_M)
            h = Horizon(h.azimuth_deg, np.round(h.elevation_deg * 100) / 100)
            out[name] = (h, first_set(site_from_latlon(lat, lon, ground + OBSERVER_HEIGHT_M), h, et0))
        coarse, fine = out["global_474m"], out["sldem2015_window"]
        e = coarse[0].elevation_deg - fine[0].elevation_deg
        result = {
            "site": "Blue Ghost 1 (Mare Crisium)", "reference": "SLDEM2015 window ahead of the global map",
            "horizon_rms_deg": float(np.sqrt(np.mean(e**2))), "horizon_max_abs_deg": float(np.abs(e).max()),
            "first_sunset_global_utc": et_to_utc(coarse[1], 0), "first_sunset_fine_utc": et_to_utc(fine[1], 0),
            "sunset_error_h": float((coarse[1] - fine[1]) / 3600),
        }
    RESULT.write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
