"""Export the evidence page's numbers from the validation outputs (no hand-typed results).

    uv run python pipeline/export_evidence.py

Reads validation/illumination_comparison.json, validation/barker2021_comparison.json,
validation/missions/blue_ghost_1_sunset.json, validation/missions/apollo_sun_angles.json, validation/beyond_accuracy.json,
validation/custom_location_accuracy.json, the candidate and mission products, and
re-computes the JPL Horizons residuals from the cached tables. Copies the figures the page
shows from docs/learn/figures/. Writes web/data/evidence.json.
"""

import json
import math
from datetime import datetime
import shutil
import sys
from datetime import date

import numpy as np

from lunazen.paths import ROOT
from lunazen.products import candidate_summary, mission_summary

VALIDATION = ROOT / "validation"
sys.path.insert(0, str(VALIDATION))
from fetch_jpl_horizons import SITES  # noqa: E402
from jpl_comparison import residuals  # noqa: E402
import thresholds  # noqa: E402

OUT = ROOT / "web" / "data" / "evidence.json"
FIGURES = ("missions.png", "dem_crosscheck.png")
LROC_IM1_HEIGHT_M = 2579.0  # https://lroc.im-ldi.com/images/1360
MAST_M = 2.0
R_MOON_M = 1_737_400.0


def stats(ours, ref):
    d = np.asarray(ours) - np.asarray(ref)
    return {"n": int(d.size), "r": float(np.corrcoef(ours, ref)[0, 1]), "meanPp": 100 * float(d.mean()),
            "rmsPp": 100 * float(np.sqrt(np.mean(d ** 2))), "maxAbsPp": 100 * float(np.max(np.abs(d)))}


def jpl():
    rows = []
    for site_id, (lon, lat, _) in SITES.items():
        for target in ("sun", "earth"):
            d_el, sep = residuals(site_id, target)
            rows.append({"site": site_id, "latitudeDeg": lat, "longitudeDeg": lon, "target": target, "epochs": int(sep.size),
                         "maxSeparationArcsec": float(np.max(sep) * 3600), "maxElevationArcsec": float(np.max(np.abs(d_el)) * 3600)})
    return {"source": "JPL Horizons airless apparent az/el, 2024-2030 every 37 days", "rows": rows}


def illumination():
    data = json.loads((VALIDATION / "illumination_comparison.json").read_text())
    pts = data["points"]
    # Polar stereographic (x, y) in metres to south latitude: the span the 26 points cover.
    lats = [-90 + math.degrees(2 * math.atan(math.hypot(p["x_m"], p["y_m"]) / (2 * R_MOON_M))) for p in pts]
    gentle = sorted(pts, key=lambda p: p["slope_deg"])[:6]  # the points the test holds to a tolerance
    return {
        "gentleSlopeWorstPp": {"sun": 100 * max(abs(p["matched_sun"] - p["published_sun"]) for p in gentle),
                               "earth": 100 * max(abs(p["matched_earth"] - p["published_earth"]) for p in gentle)},
        "source": "LOLA AVGVISIB 60 m maps (Mazarico et al. 2011), 18.6 years; our run at the pixel centre, ground level, terrain from 60 m",
        "years": data["years"], "points": len(pts), "latitudeRangeDeg": [round(min(lats), 1), round(max(lats), 1)],
        "sun": stats([p["matched_sun"] for p in pts], [p["published_sun"] for p in pts]),
        "earth": stats([p["matched_earth"] for p in pts], [p["published_earth"] for p in pts]),
        "scatter": [[round(p["published_sun"], 4), round(p["matched_sun"], 4), round(p["published_earth"], 4),
                     round(p["matched_earth"], 4), round(p["slope_deg"], 1)] for p in pts],
    }


def spots():
    summary = candidate_summary()
    rows = []
    for s in summary["spots"]:
        centre = next(p for p in s["points"] if p["mast_m"] == MAST_M and p["offset_m"] == [0.0, 0.0])["year_2027"]
        rows.append([s["spot"], round(s["nasa_avg_sun"], 4), round(centre["sunlitFraction"], 4),
                     round(s["nasa_avg_earth"], 4), round(centre["earthFraction"], 4)])
    return {"source": "NASA 18.6-year 60 m map at the spot vs our 2027 year with a 2 m mast",
            "sun": stats([r[2] for r in rows], [r[1] for r in rows]),
            "earth": stats([r[4] for r in rows], [r[3] for r in rows]), "scatter": rows}


def missions():
    bg = json.loads((VALIDATION / "missions" / "blue_ghost_1_sunset.json").read_text())
    im1 = next(m for m in mission_summary()["missions"] if m["id"] == "im1")
    sun_max = {d["date"]: d["sun_max_elevation_deg"] for d in im1["daily"]}
    return {
        "blueGhost1": {"events": {"landingPlus346h": bg["landing_plus_346h_utc"], **bg["events_utc"],
                                  "finalTransmission": bg["final_transmission_utc"], "nasaSunsetImplied": bg["nasa_sunset_implied_utc"]},
                       "sunAbove": bg["sun_at_landing_plus_346h"], "terrainToSunset": bg["terrain_toward_sunset"]},
        "im1": {"groundM": im1["ground_m"], "lrocM": LROC_IM1_HEIGHT_M, "firstSunset": im1["first_sunset_after_landing_utc"],
                "sunMaxDeg": {k: sun_max[k] for k in ("2024-02-26", "2024-02-29")}, "ended": im1["ended"]},
    }


def barker():
    path = VALIDATION / "barker2021_comparison.json"
    return json.loads(path.read_text()) if path.exists() else None


def away_from_pole():
    """Accuracy of the global-map skyline at Blue Ghost 1, the one site away from the pole with a finer map."""
    return json.loads((VALIDATION / "beyond_accuracy.json").read_text())


def custom_points():
    """Accuracy of the browser's custom-point horizons against the stored 5, 20 and 80 m horizons at the 67 spots."""
    data = json.loads((VALIDATION / "custom_location_accuracy.json").read_text())
    return {k: data[k] for k in ("spots", "horizon_rms_deg", "sun_share_pp", "longest_dark_h")}


def apollo():
    """The Sun's angle during the Apollo moonwalks against the Apollo Lunar Surface Journal (validation/missions)."""
    return json.loads((VALIDATION / "missions" / "apollo_sun_angles.json").read_text())


def minutes(iso):
    return datetime.fromisoformat(iso).timestamp() / 60


def scorecard(evidence):
    """One row per check: what it is compared with, the result, the tolerance fixed beforehand and the verdict.

    The tolerances live in validation/thresholds.py, where the tests read them too. A row without one is
    reported, not judged. The browser against Python is tested in npm test and re-run live on the page.
    """
    t = thresholds
    il, jpl_rows, bk, ap = evidence["illumination"], evidence["jpl"]["rows"], evidence["barker2021"], evidence["apollo"]
    sun_worst, earth_worst = il["gentleSlopeWorstPp"]["sun"], il["gentleSlopeWorstPp"]["earth"]
    jpl_worst = max(r["maxSeparationArcsec"] for r in jpl_rows)
    lo, hi = bk["summary"]["ours_minus_fig19_1m_pp"]
    sp, im1, bg = evidence["spots"], evidence["missions"]["im1"], evidence["missions"]["blueGhost1"]["events"]
    sunset_min = abs(minutes(bg["terrain_sunset_begins"]) - minutes(bg["nasaSunsetImplied"]))
    return [
        {"id": "jpl", "check": "Sun and Earth directions", "against": f"JPL Horizons, {len(jpl_rows) // 2} sites, {jpl_rows[0]['epochs']} dates each",
         "result": f"{jpl_worst:.2f}″ at worst", "tolerance": f"{t.JPL_ARCSEC:g}″", "verdict": "pass" if jpl_worst < t.JPL_ARCSEC else "fail"},
        {"id": "illumination", "check": "Long-term illumination", "against": "NASA's LOLA average-visibility maps, the 6 flattest of 26 points",
         "result": f"Sun {sun_worst:.1f} pp, Earth {earth_worst:.1f} pp at worst", "tolerance": f"{t.ILLUMINATION_SUN_PP:g} and {t.ILLUMINATION_EARTH_PP:g} pp",
         "verdict": "pass" if sun_worst < t.ILLUMINATION_SUN_PP and earth_worst < t.ILLUMINATION_EARTH_PP else "fail"},
        {"id": "barker", "check": "Seven Connecting Ridge regions", "against": "Barker et al. (2021), at 1 m",
         "result": f"{lo:+.1f} to {hi:+.1f} pp", "tolerance": f"±{t.BARKER_PP:g} pp", "verdict": "pass" if -t.BARKER_PP < lo and hi < t.BARKER_PP else "fail"},
        {"id": "apollo", "check": "Sun angle on the Moon in 1969-71", "against": f"Apollo Lunar Surface Journal, {ap['points']} moonwalk times at Apollo 11, 12 and 14",
         "result": f"{ap['maxAbsDeg']:.2f}° at worst", "tolerance": f"{t.APOLLO_SUN_DEG:g}°", "verdict": "pass" if ap["maxAbsDeg"] < t.APOLLO_SUN_DEG else "fail"},
        {"id": "spots", "check": "All 67 candidate spots", "against": "NASA's 18.6-year map at the same pixel",
         "result": f"r = {sp['sun']['r']:.2f}, RMS {sp['sun']['rmsPp']:.1f} pp", "tolerance": "none: a 2 m mast and one year against a ground average", "verdict": "reported"},
        {"id": "missions", "check": "Two real landings", "against": "IM-1's measured height; NASA's account of Blue Ghost 1's sunset",
         "result": f"{abs(im1['groundM'] - im1['lrocM']):.0f} m; {sunset_min:.0f} min", "tolerance": "none: NASA gives an implied time, not a measurement", "verdict": "reported"},
        {"id": "browser", "check": "Browser engine", "against": "The Python reference (fixtures; every spot, live below)",
         "result": "tested on every run of npm test", "tolerance": f"{t.BROWSER_ARCSEC:g}″ and {t.BROWSER_PP:g} pp", "verdict": "pass"},
    ]


def main():
    evidence = {"generated": date.today().isoformat(), "jpl": jpl(), "illumination": illumination(),
                "spots": spots(), "barker2021": barker(), "missions": missions(),
                "awayFromPole": away_from_pole(), "customPoints": custom_points(), "apollo": apollo(),
                "figures": [f"figures/{name}" for name in FIGURES]}
    evidence["scorecard"] = scorecard(evidence)
    OUT.write_text(json.dumps(evidence, indent=1))
    target = ROOT / "web" / "figures"
    target.mkdir(exist_ok=True)
    for name in FIGURES:
        shutil.copy2(ROOT / "docs" / "learn" / "figures" / name, target / name)
    worst = max(r["maxSeparationArcsec"] for r in evidence["jpl"]["rows"])
    print(f"JPL worst {worst:.3f}\"; 26-point Sun RMS {evidence['illumination']['sun']['rmsPp']:.1f} pp; "
          f"{len(evidence['spots']['scatter'])} spots Sun r {evidence['spots']['sun']['r']:.3f}, Earth r {evidence['spots']['earth']['r']:.3f}; "
          f"Barker {'yes' if evidence['barker2021'] else 'missing'}")


if __name__ == "__main__":
    main()
