"""Golden fixtures: the Python reference results the JS engine must reproduce.

    uv run python pipeline/make_fixtures.py   ->  web/engine/test/fixtures.json
"""

import json
from pathlib import Path

import numpy as np

from lunazen import custom
from lunazen.geometry import south_polar_to_latlon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.dsn import moon_elevations
from lunazen.dsn import dsn_in_view, station_in_view
from lunazen.mission import FRAGILITY_ERRORS_DEG, STEP_S, dark_mask, fragility, summarize, time_to_change, windows
from lunazen.rank import order_overall, rank_spots
from lunazen.planner import evaluate_landings, feasible
from lunazen.products import candidate_spots, mission_sites
from lunazen.visibility import earth_state, sun_state

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "web" / "engine" / "test" / "fixtures.json"


def sites():
    """Reference sites: a Connecting-ridge candidate spot and two CLPS landing sites."""
    spot = candidate_spots(2.0)["Site01-1"]
    missions = mission_sites()
    return {"Site01-1": spot, "im1": missions["im1"], "bg1": missions["bg1"]}


# Planner landings are tried every 6 h whatever the sample step.
STRIDE = int(6 * 3600 / STEP_S)


def main():
    rng = np.random.default_rng(7)
    start, end = np.datetime64("2024-03-01T00:00:00"), np.datetime64("2043-06-01T00:00:00")
    span = int((end - start) / np.timedelta64(1, "s"))
    times = sorted(str(start + np.timedelta64(int(s), "s")) for s in rng.integers(0, span, 40))
    fixtures = {"times_utc": times, "sites": {}, "missions": []}
    all_sites = sites()
    with spice_kernels():
        ets = np.array([utc_to_et(t) for t in times])
        fixtures["times_et"] = ets.tolist()
        fixtures["dsn_moon_elevation_deg"] = {name: e.tolist() for name, e in moon_elevations(ets).items()}
        for site_id, (site, horizon) in all_sites.items():
            sun = sun_state(ets, site, horizon)
            earth = earth_state(ets, site, horizon)
            fixtures["sites"][site_id] = {
                "latitudeDeg": site.latitude_deg, "longitudeDeg": site.longitude_deg,
                "heightM": site.height_m,
                "horizonDeg": horizon.elevation_deg.tolist(),
                "sun": {k: sun[k].tolist() for k in ("azimuth_deg", "elevation_deg", "fraction")},
                "earth": {k: earth[k].tolist() for k in ("azimuth_deg", "elevation_deg", "fraction")},
            }
        for site_id, window in (("Site01-1", ("2027-01-01T00:00:00", "2027-03-01T00:00:00")),
                                ("im1", ("2024-02-22T23:00:00", "2024-03-06T00:00:00")),
                                ("Site01-1", ("2027-03-01T00:00:00", "2027-07-01T00:00:00"))):
            site, horizon = all_sites[site_id]
            et0, et1 = utc_to_et(window[0]), utc_to_et(window[1])
            grid = et0 + np.arange(int(np.floor((et1 - et0) / STEP_S)) + 1) * STEP_S
            sun, earth = sun_state(grid, site, horizon), earth_state(grid, site, horizon)
            fixtures["missions"].append({
                "site": site_id, "start_utc": window[0], "end_utc": window[1], "step_s": STEP_S,
                "expected": summarize(site, horizon, et0, et1, STEP_S),
                "expected_windows": {"sun": windows(grid, sun["fraction"] > 0), "earth": windows(grid, earth["fraction"] > 0)},
            })
        # Skyline error: the same windows with the horizon raised by each error (deg).
        fixtures["fragility"] = []
        for site_id, window in (("Site01-1", ("2027-03-01T00:00:00", "2027-07-01T00:00:00")), ("im1", ("2024-02-22T23:00:00", "2024-03-06T00:00:00"))):
            site, horizon = all_sites[site_id]
            fixtures["fragility"].append({"site": site_id, "start_utc": window[0], "end_utc": window[1], "step_s": STEP_S,
                                          "expected": fragility(site, horizon, utc_to_et(window[0]), utc_to_et(window[1]), STEP_S)})
        # Station-level DSN rule (lunazen/dsn.py station_in_view): the point test at the random moments, and whole windows.
        fixtures["dsn_station"] = {
            "in_view": {site_id: station_in_view(ets, site, horizon).tolist() for site_id, (site, horizon) in all_sites.items()},
            "missions": [],
        }
        for site_id, window in (("Site01-1", ("2027-03-01T00:00:00", "2027-07-01T00:00:00")), ("im1", ("2024-02-22T23:00:00", "2024-03-06T00:00:00"))):
            site, horizon = all_sites[site_id]
            fixtures["dsn_station"]["missions"].append({
                "site": site_id, "start_utc": window[0], "end_utc": window[1], "step_s": STEP_S,
                "expected": summarize(site, horizon, utc_to_et(window[0]), utc_to_et(window[1]), STEP_S, dsn_rule="station")})
        # Time to the next Sun or Earth set/rise from the first 12 random moments.
        fixtures["time_to_change"] = [
            {"site": site_id, "body": body, "et": float(t), **time_to_change(all_sites[site_id][0], all_sites[site_id][1], float(t), body)}
            for site_id in ("Site01-1", "im1") for body in ("SUN", "EARTH") for t in ets[:12]]
        # Planner: Site01-1, landings every 6 h over March-May 2027, 14-day missions.
        site, horizon = all_sites["Site01-1"]
        p0, p1 = utc_to_et("2027-03-01T00:00:00"), utc_to_et("2027-06-15T00:00:00")
        grid = p0 + np.arange(int(np.floor((p1 - p0) / STEP_S)) + 1) * STEP_S
        sun, earth = sun_state(grid, site, horizon), earth_state(grid, site, horizon)
        link = (earth["fraction"] > 0) & dsn_in_view(grid)
        expected = evaluate_landings(sun["fraction"] > 0, link, STEP_S, 14 * 86400.0, STRIDE)
        sun_r, earth_r = sun_state(grid, site, horizon.raised(0.25)), earth_state(grid, site, horizon.raised(0.25))
        expected_raised = evaluate_landings(sun_r["fraction"] > 0, (earth_r["fraction"] > 0) & dsn_in_view(grid), STEP_S, 14 * 86400.0, STRIDE)
        fixtures["planner"] = {
            "site": "Site01-1", "start_utc": "2027-03-01T00:00:00", "end_utc": "2027-06-15T00:00:00",
            "step_s": STEP_S, "mission_s": 14 * 86400.0, "stride": STRIDE, "expected": expected,
            # Survival by darkness tolerance (VIPER's 50 h) with a 50 % DSN-link requirement.
            "max_dark_hours": 50.0, "min_link": 0.5,
            "expected_feasible_dark": [feasible(r, 0.5, 50.0) for r in expected],
            # The same landings with the skyline 0.25 degrees higher.
            "expected_feasible_dark_raised": [feasible(r, 0.5, 50.0) for r in expected_raised],
        }
        # Darkness threshold: a sample counts as dark when less than this share of the Sun is visible (0 = no part of it).
        fixtures["dark_below"] = {"missions": [], "planner": {"site": "Site01-1", "start_utc": "2027-03-01T00:00:00", "end_utc": "2027-06-15T00:00:00",
                                                              "mission_s": 14 * 86400.0, "stride": STRIDE, "expected": {}}}
        for site_id, window in (("Site01-1", ("2027-01-01T00:00:00", "2028-01-01T00:00:00")), ("im1", ("2024-02-22T23:00:00", "2024-03-06T00:00:00"))):
            site_w, horizon_w = all_sites[site_id]
            for below in (0.1, 0.5):
                fixtures["dark_below"]["missions"].append({
                    "site": site_id, "start_utc": window[0], "end_utc": window[1], "step_s": STEP_S, "dark_below": below,
                    "longest_dark_hours": summarize(site_w, horizon_w, utc_to_et(window[0]), utc_to_et(window[1]), STEP_S, dark_below=below)["longestDarkHours"]})
        for below in (0.1, 0.5):
            fixtures["dark_below"]["planner"]["expected"][str(below)] = evaluate_landings(sun["fraction"] > 0, link, STEP_S, 14 * 86400.0, STRIDE, dark=dark_mask(sun["fraction"], below))
        # Rank: every candidate spot for one landing, ordered as the Rank page orders them.
        fixtures["rank"] = []
        for start, days, max_dark, within, dark_below in (("2027-03-01T00:00:00", 14, 50.0, 100, 0.0), ("2027-09-10T12:00:00", 30, 5.0, 100, 0.0), ("2027-03-01T00:00:00", 14, 50.0, 50, 0.0), ("2027-03-01T00:00:00", 14, 50.0, 100, 0.5)):
            spots = order_overall(rank_spots(utc_to_et(start), days * 86400.0, 0.5, max_dark, within_m=within, dark_below=dark_below))
            fixtures["rank"].append({
                "start_utc": start, "mission_days": days, "min_link": 0.5, "max_dark_hours": max_dark, "within_m": within, "dark_below": dark_below,
                "order": [x["id"] for x in spots], "works": {x["id"]: x["works"] for x in spots},
                "within": {x["id"]: x["within"] for x in spots},
                "holds_raised": {x["id"]: x["holdsRaised"] for x in spots},
                "longest_dark_hours": {x["id"]: x["metrics"]["longestDarkHours"] for x in spots},
            })
        # Custom points: the browser tracer on the exported crops (lunazen/custom.py) at points inside three site tiles.
        manifest, far, crops = custom.load()
        fixtures["custom"] = []
        for site_id, fx, fy in (("Site01", 0.5, 0.5), ("Haworth", 0.3, 0.6), ("LM7", 0.7, 0.4)):
            i = next(e["interior"] for e in manifest["sites"] if e["id"] == site_id)
            x, y = i["xMinM"] + fx * (i["xMaxM"] - i["xMinM"]), i["yMinM"] + fy * (i["yMaxM"] - i["yMinM"])
            lat, lon = south_polar_to_latlon(x, y)
            horizon, ground = custom.trace(float(lat), float(lon), site_id, far, crops)
            fixtures["custom"].append({"site": site_id, "latitude_deg": float(lat), "longitude_deg": float(lon),
                                       "ground_m": ground, "horizon_deg": [float(v) for v in horizon.elevation_deg]})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixtures))
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1e3:.0f} kB)")
    for m in fixtures["missions"]:
        print(m["site"], m["start_utc"][:10], {k: round(v, 3) for k, v in m["expected"].items()})


if __name__ == "__main__":
    main()
