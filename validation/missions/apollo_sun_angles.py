"""Retrodiction: the Sun's angle above the horizon during the Apollo moonwalks.

The Apollo Lunar Surface Journal lists the Sun's elevation, to 0.1 degree, at the start and end of each moonwalk
(https://apollojournals.org/alsj/alsj-sunangles.html, compiled by Brian W. Lawrence, 2005), with times as ground
elapsed time (GET) to a quarter of an hour. We add each GET to the mission's liftoff and compute the Sun's centre
above the local horizontal at the landing site (Wagner et al. 2017 coordinates, data/sites/beyond_sites.csv).

Only Apollo 11, 12 and 14 are compared. They landed within 4 degrees of the equator, where the Sun's elevation
and the journal's angle coincide. At Apollo 15 (26 N), 16 (9 S) and 17 (20 N) the journal's angle rises at 0.51
degrees per hour, the rate at the equator, whereas the local elevation rises more slowly (0.44 at Apollo 15), so
its definition differs from the local elevation; those rows are kept in the output and marked not comparable.

Liftoff times (UTC, NASA mission reports): Apollo 11 1969-07-16 13:32:00; 12 1969-11-14 16:22:00;
14 1971-01-31 21:03:02; 15 1971-07-26 13:34:00; 16 1972-04-16 17:54:00; 17 1972-12-07 05:33:00. The journal's
Apollo 17 times count from the planned liftoff, 02:53:00, which was 2 h 40 min earlier than the actual one.
Each GET scale is checked against the landing time (NASA mission reports) to 0.2 h.

    uv run python validation/missions/apollo_sun_angles.py
"""

import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.paths import ROOT
from lunazen.visibility import sun_state

OUTPUT = Path(__file__).resolve().parent / "apollo_sun_angles.json"
SOURCE = "https://apollojournals.org/alsj/alsj-sunangles.html"
SITES_CSV = ROOT / "data" / "sites" / "beyond_sites.csv"

# mission: (site id, GET origin UTC, landing UTC, moonwalk rows (event, GET hours, source Sun angle in degrees))
MISSIONS = {
    "Apollo 11": ("a11", "1969-07-16T13:32:00", "1969-07-20T20:17:40", [
        ("EVA-1 start", 109.00, 14.0), ("EVA-1 end", 111.75, 15.4)]),
    "Apollo 12": ("a12", "1969-11-14T16:22:00", "1969-11-19T06:54:35", [
        ("EVA-1 start", 115.25, 7.5), ("EVA-1 end", 119.25, 9.5), ("EVA-2 start", 131.50, 15.8), ("EVA-2 end", 135.50, 17.8)]),
    "Apollo 14": ("a14", "1971-01-31T21:03:02", "1971-02-05T09:18:11", [
        ("EVA-1 start", 113.50, 13.0), ("EVA-1 end", 118.50, 15.5), ("EVA-2 start", 131.25, 22.0), ("EVA-2 end", 135.75, 24.3)]),
    "Apollo 15": ("a15", "1971-07-26T13:34:00", "1971-07-30T22:16:29", [
        ("EVA-1 start", 119.75, 19.6), ("EVA-1 end", 126.25, 22.9), ("EVA-2 start", 142.25, 31.0), ("EVA-2 end", 149.50, 34.7),
        ("EVA-3 start", 163.25, 41.7), ("EVA-3 end", 168.25, 44.3)]),
    "Apollo 16": ("a16", "1972-04-16T17:54:00", "1972-04-21T02:23:35", [
        ("EVA-1 start", 119.00, 22.2), ("EVA-1 end", 126.00, 25.7), ("EVA-2 start", 142.50, 34.1), ("EVA-2 end", 150.00, 37.9),
        ("EVA-3 start", 165.50, 45.8), ("EVA-3 end", 171.25, 48.7)]),
    "Apollo 17": ("a17", "1972-12-07T02:53:00", "1972-12-11T19:54:57", [
        ("EVA-1 start", 117.00, 15.3), ("EVA-1 end", 124.25, 19.0), ("EVA-2 start", 140.50, 27.3), ("EVA-2 end", 148.25, 31.2),
        ("EVA-3 start", 163.50, 39.0), ("EVA-3 end", 170.75, 42.6)]),
}
COMPARABLE = ("Apollo 11", "Apollo 12", "Apollo 14")
LANDING_GET_H = {"Apollo 11": 102.75, "Apollo 12": 110.50, "Apollo 14": 108.25, "Apollo 15": 104.75, "Apollo 16": 104.50, "Apollo 17": 113.00}


def coordinates():
    rows = [line.split(",") for line in SITES_CSV.read_text().splitlines()[1:]]
    return {r[0]: (float(r[3]), float(r[4])) for r in rows}


def main():
    coords = coordinates()
    rows, timing = [], {}
    with spice_kernels():
        for mission, (site_id, origin, landing_utc, events) in MISSIONS.items():
            lat, lon = coords[site_id]
            site = site_from_latlon(lat, lon, 0.0)
            t0 = datetime.fromisoformat(origin)
            implied = t0 + timedelta(hours=LANDING_GET_H[mission])
            timing[mission] = abs((implied - datetime.fromisoformat(landing_utc)).total_seconds()) / 3600.0
            for event, get_h, source_deg in events:
                utc = (t0 + timedelta(hours=get_h)).isoformat()
                ours = float(sun_state(np.array([utc_to_et(utc)]), site, Horizon.flat())["elevation_deg"][0])
                rows.append({"mission": mission, "event": event, "getHours": get_h, "utc": utc, "sourceDeg": source_deg,
                             "oursDeg": round(ours, 3), "differenceDeg": round(ours - source_deg, 3), "comparable": mission in COMPARABLE})
    used = np.array([r["differenceDeg"] for r in rows if r["comparable"]])
    result = {
        "source": SOURCE, "missions": list(COMPARABLE), "points": int(used.size),
        "maxAbsDeg": float(np.abs(used).max()), "rmsDeg": float(np.sqrt(np.mean(used ** 2))), "meanDeg": float(used.mean()),
        "timeScaleCheckHours": {m: round(h, 3) for m, h in timing.items()},
        "rows": rows,
    }
    OUTPUT.write_text(json.dumps(result, indent=1))
    print(f"{used.size} comparable points: max {result['maxAbsDeg']:.2f} deg, rms {result['rmsDeg']:.2f} deg; time scale check {max(timing.values()):.2f} h at worst")


if __name__ == "__main__":
    main()
