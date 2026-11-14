"""Mission-level metrics for a site and window (reference for web/engine/mission.js)."""

import numpy as np

from lunazen.dsn import dsn_in_view, station_in_view
from lunazen.visibility import earth_state, sun_state


# The time step of every series the app and the pipeline sample: 15 minutes resolves the short
# Sun gaps behind ridges and the hand-offs between DSN complexes that hourly samples smooth away.
STEP_S = 900.0
# Calendar years with precomputed summaries; the engine itself accepts any date.
YEARS = (2027, 2028, 2029)


def longest_run_hours(mask, step_s):
    best = run = 0
    for value in mask:
        run = run + 1 if value else 0
        best = max(best, run)
    return best * step_s / 3600.0


def windows(ets, mask):
    """Maximal runs of consecutive samples where mask is true, as [(start_et, end_et), ...].

    Times are sample times, so a window's edges are known to within one step;
    a window still open at either end of the series is clipped there.
    """
    ets, mask = np.asarray(ets), np.asarray(mask, dtype=bool)
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return [(float(ets[a]), float(ets[b - 1])) for a, b in zip(edges[::2], edges[1::2])]


def array_energy_wh_per_w(sun, step_s):
    """Energy (Wh) a 1 W vertical array that turns to face the Sun collects: sum of f x max(0, cos E) x step.

    f is the visible fraction of the Sun's disk and E its elevation (the array's normal is horizontal, so the
    incidence angle is E). Ignores temperature, dust, limb darkening and the 1/r^2 change in flux (about +/-3.4 %).
    It is a measure of light, not of any lander's power: survival is judged by darkness tolerance only.
    """
    cosine = np.clip(np.cos(np.radians(sun["elevation_deg"])), 0.0, None)
    return float((sun["fraction"] * cosine).sum() * step_s / 3600.0)


def dark_mask(fraction, dark_below=0.0):
    """Samples that count as dark: no part of the Sun above the skyline (default), or less than `dark_below` of its disk."""
    return fraction < dark_below if dark_below > 0 else fraction <= 0


def summarize(site, horizon, et_start, et_end, step_s, dsn_rule="disk", dark_below=0.0):
    """Window metrics. dsn_rule: "disk" (default: any part of Earth's disk above the skyline and a complex sees the
    Moon above 10 deg) or "station" (a complex sees the Moon above 10 deg and the lander sees that complex itself
    above the skyline; lunazen/dsn.py station_in_view). dark_below: 0 counts a sample as dark when no part of the Sun is
    up (default); 0.1 or 0.5 count it as dark when less than that share of the Sun's disk is visible (longestDarkHours only)."""
    n = int(np.floor((et_end - et_start) / step_s)) + 1
    ets = et_start + np.arange(n) * step_s
    sun = sun_state(ets, site, horizon)
    earth = earth_state(ets, site, horizon)
    sunlit, comms = sun["fraction"] > 0, earth["fraction"] > 0
    link = comms & (station_in_view(ets, site, horizon) if dsn_rule == "station" else dsn_in_view(ets))
    return {
        "sunlitFraction": float(sunlit.mean()),
        "earthFraction": float(comms.mean()),
        "bothFraction": float((sunlit & comms).mean()),
        "energyWhPerW": array_energy_wh_per_w(sun, step_s),
        "longestDarkHours": longest_run_hours(dark_mask(sun["fraction"], dark_below), step_s),
        "longestCommsGapHours": longest_run_hours(~comms, step_s),
        "dsnLinkFraction": float(link.mean()),
        "longestDsnLinkGapHours": longest_run_hours(~link, step_s),
    }


# Skyline errors to test a result against (deg): the custom-point horizon RMS error is 0.12 deg, and a
# 0.25 deg error is the size of the Sun's apparent radius.
FRAGILITY_ERRORS_DEG = (0.1, 0.25)
SKYLINE_TEST_DEG = 0.25  # the error Rank, Compare and the Planner test a landing against


def fragility(site, horizon, et_start, et_end, step_s, errors_deg=FRAGILITY_ERRORS_DEG, dsn_rule="disk", dark_below=0.0):
    """How the window's result changes if the terrain skyline were higher by each error (deg), keyed by the error as text.

    Near the pole the Sun's margin above the terrain changes by hundredths of a degree per hour, so a small
    skyline error can move a sunset by hours. A result that barely changes is robust to the map's error.
    """
    out = {}
    for error in errors_deg:
        s = summarize(site, horizon.raised(error), et_start, et_end, step_s, dsn_rule, dark_below)
        out[str(error)] = {k: s[k] for k in ("sunlitFraction", "longestDarkHours", "dsnLinkFraction")}
    return out


def time_to_change(site, horizon, et, body, max_days=30, step_s=STEP_S):
    """Hours until the Sun or Earth (body "SUN" or "EARTH") next changes between up and hidden, on the series grid.

    `up` is the state at `et` (any part of the disk above the terrain). `hours` is the time to the first grid
    sample whose state differs (a set if up, a rise if hidden), or None if no change within `max_days`.
    """
    n = int(max_days * 86400 / step_s)
    ets = et + np.arange(n + 1) * step_s
    state = (sun_state if body == "SUN" else earth_state)(ets, site, horizon)
    up = state["fraction"] > 0
    flips = np.nonzero(up != up[0])[0]
    return {"up": bool(up[0]), "hours": float(flips[0] * step_s / 3600) if flips.size else None}


def summarize_years(site, horizon, years=YEARS, step_s=STEP_S):
    """summarize() for each calendar year (1 January to 1 January), keyed by the year as text."""
    from lunazen.kernels import utc_to_et
    return {str(y): summarize(site, horizon, utc_to_et(f"{y}-01-01T00:00:00"), utc_to_et(f"{y + 1}-01-01T00:00:00"), step_s)
            for y in years}
