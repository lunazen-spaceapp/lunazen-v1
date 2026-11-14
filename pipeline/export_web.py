"""Export the site products in a browser-friendly form for the web app.

    uv run python pipeline/export_web.py

Writes:
  web/data/sites.json   catalogue: NASA candidate sites and spots, CLPS mission sites,
                        positions, slopes, NASA map values, sources, 2027 metrics, and
                        the row of each horizon in horizons.bin
  web/data/horizons.bin all horizons, little-endian int16 centidegrees, AZIMUTHS per row
                        (azimuth k * 0.25 deg, k = 0..1439)

Inputs are the committed products (data/products/), so this runs without the
downloaded DEMs. Load it in the browser with web/engine/sites.js.
"""

import csv
import json

import numpy as np

from lunazen.paths import PRODUCTS, ROOT, SITES
from lunazen.geometry import latlon_to_south_polar
from lunazen.sites import CANDIDATE_SITES, artemis_regions, artemis_regions_at
from lunazen.survival import DARKNESS_PRESETS
from lunazen.terrain import OBSERVER_HEIGHT_M

OUT = ROOT / "web" / "data"


def main():
    candidates = np.load(PRODUCTS / "candidate_sites.npz")
    summary = json.loads((PRODUCTS / "candidate_sites_summary.json").read_text())
    missions_npz = np.load(PRODUCTS / "mission_sites.npz")
    with open(SITES / "missions.csv", newline="") as f:
        mission_rows = {row["id"]: row for row in csv.DictReader(f)}
    artemis = artemis_regions()
    step = float(candidates["azimuth_step_deg"])
    assert np.isclose(step, float(missions_npz["azimuth_step_deg"]))

    rows = []  # int16 horizon rows, in file order

    def add_row(horizon_cdeg):
        rows.append(np.asarray(horizon_cdeg, dtype="<i2"))
        return len(rows) - 1

    # Candidate spots: centre horizons per mast, plus the ring of nearby points (default mast).
    index = {(str(s), int(p), float(m)): i for i, (s, p, m) in
             enumerate(zip(candidates["spot"], candidates["point"], candidates["mast_m"]))}
    spots = []
    for spot in summary["spots"]:
        centre = [p for p in spot["points"] if p["offset_m"] == [0.0, 0.0]]
        ring = [p for p in spot["points"] if p["offset_m"] != [0.0, 0.0]]
        default = next(p for p in centre if p["mast_m"] == OBSERVER_HEIGHT_M)
        spots.append({
            "id": spot["spot"], "site": spot["site"], "siteName": spot["site_name"], "kind": spot["kind"],
            "latitudeDeg": default["latitude_deg"], "longitudeDeg": default["longitude_deg"], "groundM": default["ground_m"],
            "xM": spot["x_m"], "yM": spot["y_m"], "slopeDeg": spot["slope_deg"],
            "nasaAvgSun": spot["nasa_avg_sun"], "nasaAvgEarth": spot["nasa_avg_earth"], "inNasaRoi": spot["in_nasa_roi"],
            "artemisRegions": artemis_regions_at(spot["x_m"], spot["y_m"], artemis["regions"]),
            "horizonRows": {f"{p['mast_m']:g}": add_row(candidates["horizon_cdeg"][index[(spot["spot"], 0, p["mast_m"])]])
                            for p in centre},
            "ring": [{"offsetM": p["offset_m"], "latitudeDeg": p["latitude_deg"], "longitudeDeg": p["longitude_deg"],
                      "groundM": p["ground_m"], "mastM": p["mast_m"],
                      "horizonRow": add_row(candidates["horizon_cdeg"][index[(spot["spot"], k + 1, p["mast_m"])]]),
                      "year2027": p["year_2027"], "years": p["years"]} for k, p in enumerate(ring)],
            "year2027": {f"{p['mast_m']:g}": p["year_2027"] for p in centre},
            "years": {y: {f"{p['mast_m']:g}": p["years"][y] for p in centre} for y in default["years"]},
            "months2027": default["months_2027"],
        })

    missions = []
    for i, mission_id in enumerate(missions_npz["id"]):
        row = mission_rows[str(mission_id)]
        mx, my = latlon_to_south_polar(np.radians(missions_npz["latitude_deg"][i]), np.radians(missions_npz["longitude_deg"][i]))
        missions.append({
            "id": str(mission_id), "name": row["name"], "operator": row["operator"],
            "latitudeDeg": float(missions_npz["latitude_deg"][i]), "longitudeDeg": float(missions_npz["longitude_deg"][i]),
            "groundM": float(missions_npz["ground_m"][i]), "mastM": float(missions_npz["mast_m"]),
            "landedUtc": row["landed_utc"], "ended": row["ended"], "source": row["coordinates_source"], "notes": row["notes"],
            "horizonRow": add_row(missions_npz["horizon_cdeg"][i]),
            "artemisRegions": artemis_regions_at(float(mx), float(my), artemis["regions"]),
        })

    # Sites away from the pole: global-map terrain, same record shape as a custom point on the page.
    beyond_npz = np.load(PRODUCTS / "beyond_sites.npz")
    beyond_rows = {s["id"]: s for s in json.loads((PRODUCTS / "beyond_sites_summary.json").read_text())["sites"]}
    accuracy = json.loads((ROOT / "validation" / "beyond_accuracy.json").read_text())
    beyond = []
    for i, site_id in enumerate(beyond_npz["id"]):
        row = beyond_rows[str(site_id)]
        beyond.append({
            "id": str(site_id), "name": row["name"], "operator": row["operator"],
            "latitudeDeg": float(beyond_npz["latitude_deg"][i]), "longitudeDeg": float(beyond_npz["longitude_deg"][i]),
            "groundM": float(beyond_npz["ground_m"][i]), "mastM": float(beyond_npz["mast_m"]),
            "landedDate": row["landed_date"], "source": row["coordinates_source"], "notes": row["notes"],
            "horizonRow": add_row(beyond_npz["horizon_cdeg"][i]), "years": row["years"],
        })

    catalogue = {
        "format": {"horizons": "horizons.bin", "dtype": "int16 little-endian", "units": "centidegrees",
                   "azimuthStepDeg": step, "azimuths": int(round(360 / step)), "rows": len(rows)},
        "defaultMastM": OBSERVER_HEIGHT_M,
        "years": [str(y) for y in summary["method"]["years"]],
        "defaultYear": "2027",
        "mastsM": summary["method"]["mast_heights_m"],
        "selection": summary["method"],
        "sites": [{"id": s.id, "name": s.name, "hasNasaRoi": s.has_roi,
                   "spots": [p["id"] for p in spots if p["site"] == s.id]} for s in CANDIDATE_SITES],
        "spots": spots,
        "missions": missions,
        "beyond": {"sites": beyond, "terrain": "global LOLA map, 474 m",
                   "accuracy": {"site": accuracy["site"], "horizonRmsDeg": round(accuracy["horizon_rms_deg"], 1),
                                "horizonMaxDeg": round(accuracy["horizon_max_abs_deg"], 1),
                                "sunsetErrorH": round(accuracy["sunset_error_h"], 1)}},
        "darknessPresets": list(DARKNESS_PRESETS),
        "artemisRegions": {"description": artemis["description"], "sources": artemis["sources"],
                           "regions": artemis["regions"]},
        "sources": {
            "terrain": "NASA PGDA 5 m site maps (Barker et al. 2021); LRO LOLA 20 m, 80 m and 64 px/deg maps",
            "illumination": "LOLA average Sun / Earth visibility maps (Mazarico et al. 2011)",
            "ephemeris": "NASA/JPL NAIF SPICE, DE440, MOON_ME",
        },
    }
    table = np.vstack(rows)
    assert table.shape[1] == catalogue["format"]["azimuths"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "horizons.bin").write_bytes(table.astype("<i2").tobytes())
    (OUT / "sites.json").write_text(json.dumps(catalogue, separators=(",", ":")))
    print(f"wrote web/data/sites.json ({(OUT / 'sites.json').stat().st_size / 1e3:.0f} kB): "
          f"{len(spots)} spots at {len(CANDIDATE_SITES)} sites, {len(missions)} missions")
    print(f"wrote web/data/horizons.bin ({table.nbytes / 1e6:.2f} MB): {len(rows)} horizons x {table.shape[1]} azimuths")


if __name__ == "__main__":
    main()
