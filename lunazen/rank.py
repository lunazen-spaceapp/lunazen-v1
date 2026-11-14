"""Rank the candidate spots for one landing (reference for web/app/rank-rows.js and the "rank" task in web/app/tasks.js).

For a landing time and a mission length, each spot is judged over exactly the mission window (15-minute samples):
it works when its longest dark period is within the darkness tolerance and it has DSN in view often enough
(lunazen.planner.feasible), and the same test is repeated at its nearby points up to the miss distance (12 points by default). Order "overall": works first,
then the share of the spot and its nearby points where it works, then the shorter longest night, then more DSN
contact, then more sunlight; equal rows keep the catalogue order.
"""

import numpy as np

from lunazen.dsn import dsn_in_view
from lunazen.geometry import site_from_latlon
from lunazen.horizon import Horizon
from lunazen.mission import SKYLINE_TEST_DEG, STEP_S, array_energy_wh_per_w, dark_mask, longest_run_hours
from lunazen.paths import PRODUCTS
from lunazen.planner import feasible
from lunazen.visibility import earth_state, sun_state

EPS = 1e-9
# How far the lander may miss -> how many of the 12 nearby points are tested. The ring is stored inner-first: six points
# at 50 m, then six at 100 m (lunazen.custom.RING_RADII_M), so a smaller distance is the first points of the same ring.
RING_POINTS_WITHIN_M = {0: 0, 50: 6, 100: 12}


def window_metrics(site, horizon, et0, mission_s, step_s=STEP_S, dark_below=0.0):
    n = int(round(mission_s / step_s))
    ets = et0 + np.arange(n) * step_s
    sun, earth = sun_state(ets, site, horizon), earth_state(ets, site, horizon)
    sunlit, comms = sun["fraction"] > 0, earth["fraction"] > 0
    link = comms & dsn_in_view(ets)
    return {
        "sunlitFraction": float(sunlit.mean()), "earthFraction": float(comms.mean()),
        "dsnLinkFraction": float(link.mean()), "energyWhPerW": array_energy_wh_per_w(sun, step_s),
        "longestDarkHours": longest_run_hours(dark_mask(sun["fraction"], dark_below), step_s),
    }


def _works(metrics, min_link, max_dark_hours):
    return feasible({"longestDarkHours": metrics["longestDarkHours"], "linkFraction": metrics["dsnLinkFraction"]}, min_link, max_dark_hours)


def rank_spots(et0, mission_s, min_link=0.5, max_dark_hours=50.0, mast_m=2.0, within_m=100, dark_below=0.0):
    """All candidate spots in catalogue order, each with its window metrics, .works and .within (0..1): the share of the spot
    and its nearby points up to `within_m` (0, 50 or 100) that work."""
    near = RING_POINTS_WITHIN_M[within_m]
    data = np.load(PRODUCTS / "candidate_sites.npz")
    spots = []
    for spot in dict.fromkeys(str(s) for s in data["spot"]):
        rows = np.flatnonzero(data["spot"] == spot)

        def point(i):
            h = data["horizon_cdeg"][i].astype(float) / 100.0
            return (site_from_latlon(data["latitude_deg"][i], data["longitude_deg"][i], data["ground_m"][i] + data["mast_m"][i]),
                    Horizon(np.arange(h.size) * float(data["azimuth_step_deg"]), h))

        centre = next(i for i in rows if data["point"][i] == 0 and abs(data["mast_m"][i] - mast_m) < 1e-9)
        ring = [i for i in rows if 0 < data["point"][i] <= near]
        site, horizon = point(centre)
        metrics = window_metrics(site, horizon, et0, mission_s, dark_below=dark_below)
        works = _works(metrics, min_link, max_dark_hours)
        # The same landing with the terrain skyline higher by the test error: does it still work?
        raised = window_metrics(site, horizon.raised(SKYLINE_TEST_DEG), et0, mission_s, dark_below=dark_below)
        holds = bool(works and _works(raised, min_link, max_dark_hours))
        ring_ok = sum(_works(window_metrics(*point(i), et0, mission_s, dark_below=dark_below), min_link, max_dark_hours) for i in ring)
        spots.append({"id": spot, "metrics": metrics, "works": bool(works), "holdsRaised": holds, "ringOk": int(ring_ok), "ringTotal": len(ring),
                      "within": (ring_ok + works) / (len(ring) + 1)})
    return spots


def order_overall(spots):
    """Best first. Differences below EPS are ties; Python's sort is stable, so equal rows keep their input order."""
    import functools

    def by(a, b, sign):
        return 0 if abs(a - b) < EPS else (-1 if sign * (a - b) < 0 else 1)

    def compare(a, b):
        for diff in (int(b["works"]) - int(a["works"]), by(a["within"], b["within"], -1),
                     by(a["metrics"]["longestDarkHours"], b["metrics"]["longestDarkHours"], 1),
                     by(a["metrics"]["dsnLinkFraction"], b["metrics"]["dsnLinkFraction"], -1),
                     by(a["metrics"]["sunlitFraction"], b["metrics"]["sunlitFraction"], -1)):
            if diff:
                return -1 if diff < 0 else 1
        return 0

    return sorted(spots, key=functools.cmp_to_key(compare))
