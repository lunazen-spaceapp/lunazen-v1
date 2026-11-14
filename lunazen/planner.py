"""Landing-date planner (reference for web/engine/planner.js).

For each candidate landing time, a mission of fixed length: its longest dark period and its
DSN-link share. A landing "works" when the mission's longest dark period is within the lander's
darkness tolerance (lunazen/survival.py) and the link share is met.
Inputs are series at the standard time step (lunazen.mission.STEP_S) over the whole search range plus one mission length.
"""

import numpy as np

from lunazen.mission import longest_run_hours


def evaluate_landings(sun_up, link, step_s, mission_s, start_stride, dark=None):
    """List of per-landing results for landing indices 0, stride, 2*stride, ... that fit.

    dark: which samples count as dark for the longest dark period (default: the Sun is not up). Pass
    lunazen.mission.dark_mask(fraction, dark_below) to count the Sun as down when little of it is visible.
    """
    dark = ~np.asarray(sun_up, bool) if dark is None else np.asarray(dark, bool)
    n_mission = int(round(mission_s / step_s))
    results = []
    for start in range(0, len(sun_up) - n_mission + 1, start_stride):
        window = slice(start, start + n_mission)
        results.append({
            "startIndex": start,
            "sunlitFraction": float(np.mean(sun_up[window])),
            "linkFraction": float(np.mean(link[window])),
            "longestDarkHours": longest_run_hours(dark[window], step_s),
            "longestLinkGapHours": longest_run_hours(~np.asarray(link[window], bool), step_s),
        })
    return results


def feasible(result, min_link_fraction, max_dark_hours):
    """Survives the darkness (longest dark period within the tolerance) and meets the link share."""
    return bool(result["longestDarkHours"] <= max_dark_hours) and result["linkFraction"] >= min_link_fraction
