"""Statistics across all candidate spots, as quoted in the guides and on the landing page.

Reads the precomputed spot summaries (2 m mast unless stated; the spot's centre point unless stated) and writes
validation/cross_site_statistics.json: how much the 2027, 2028 and 2029 figures differ, what mast height adds, how
far apart the spots within 100 m of a spot are, and the extremes across the spots (the shortest longest night, the
least and most Earth, the DSN link). tests/test_cross_site_statistics.py locks the figures the PDF quotes.

    uv run python validation/cross_site_statistics.py     # seconds; reads data/products/
"""
import json
import statistics

from lunazen.paths import PRODUCTS, ROOT

RESULT = ROOT / "validation" / "cross_site_statistics.json"
DEFAULT_MAST_M = 2.0
SURVIVAL_HOURS = {"Blue Ghost 1": 5.0, "VIPER": 50.0}  # lunazen/survival.py


def _point(spot, mast_m, centre=True):
    return [p for p in spot["points"] if p["mast_m"] == mast_m and (p["offset_m"] == [0.0, 0.0]) == centre]


def _centre(spot, mast_m=DEFAULT_MAST_M):
    (p,) = _point(spot, mast_m)
    return p


def _spread(values):
    return {"median": statistics.median(values), "max": max(values), "min": min(values)}


def _extreme(rows, key, label, hi=True):
    """The spot with the largest (or smallest) value of key."""
    best = (max if hi else min)(rows, key=lambda r: r[key])
    return {"spot": best["spot"], label: best[key]}


def compute(summary):
    spots = summary["spots"]
    years = sorted(spots[0]["points"][0]["years"])
    out = {"spots": len(spots), "years": years, "mast_m": DEFAULT_MAST_M}

    # How much one year differs from another (centre point).
    change = {}
    for key, unit, name in [("sunlitFraction", 100, "sun_points"), ("earthFraction", 100, "earth_points"), ("longestDarkHours", 1, "dark_hours")]:
        rows = []
        for s in spots:
            v = [_centre(s)["years"][y][key] * unit for y in years]
            rows.append({"spot": s["spot"], "change": max(v) - min(v)})
        change[name] = {**{k: v for k, v in _spread([r["change"] for r in rows]).items() if k != "min"},
                        "max_spot": _extreme(rows, "change", "change")["spot"]}
    out["year_to_year_change"] = change

    # What a taller mast adds to the 2027 sunlit share (10 m minus 1 m).
    gain = [(_centre(s, 10.0)["years"]["2027"]["sunlitFraction"] - _centre(s, 1.0)["years"]["2027"]["sunlitFraction"]) * 100 for s in spots]
    out["mast_1_to_10_m_sun_points"] = _spread(gain)

    # Sunlit share over 2027 across the centre and its 12 neighbours within 100 m.
    swing = {}
    for s in spots:
        v = [p["years"]["2027"]["sunlitFraction"] * 100 for p in _point(s, DEFAULT_MAST_M, centre=True) + _point(s, DEFAULT_MAST_M, centre=False)]
        swing[s["spot"]] = {"min": min(v), "max": max(v), "swing": max(v) - min(v), "points": len(v)}
    out["within_100_m_sun_points"] = {**_spread([w["swing"] for w in swing.values()]), "Site01-1": swing["Site01-1"]}

    # Extremes across the spots (2027, centre).
    rows = [{"spot": s["spot"], **_centre(s)["years"]["2027"]} for s in spots]
    out["extremes_2027"] = {
        "sun_share": {"least": _extreme(rows, "sunlitFraction", "value", hi=False), "most": _extreme(rows, "sunlitFraction", "value")},
        "earth_share": {"least": _extreme(rows, "earthFraction", "value", hi=False), "most": _extreme(rows, "earthFraction", "value")},
        "sun_and_earth_up_together": {"most": _extreme(rows, "bothFraction", "value")},
        "dsn_link_share": {"least": _extreme(rows, "dsnLinkFraction", "value", hi=False), "most": _extreme(rows, "dsnLinkFraction", "value")},
        "longest_dsn_gap_hours": {"shortest": _extreme(rows, "longestDsnLinkGapHours", "value", hi=False), "longest": _extreme(rows, "longestDsnLinkGapHours", "value")},
    }

    # The shortest "longest night", and how many spots a lander built for a given darkness could use.
    nights = {}
    for mast in (1.0, 2.0, 5.0, 10.0):
        for y in years:
            rows = [{"spot": s["spot"], "hours": _centre(s, mast)["years"][y]["longestDarkHours"]} for s in spots]
            best = _extreme(rows, "hours", "hours", hi=False)
            nights[f"{mast:g} m, {y}"] = {**best, **{f"spots_within_{name}": sum(r["hours"] <= h for r in rows) for name, h in SURVIVAL_HOURS.items()}}
    out["shortest_longest_night"] = nights
    every = [{"spot": s["spot"], "hours": p["years"][y]["longestDarkHours"]}
             for s in spots for p in s["points"] if p["mast_m"] == DEFAULT_MAST_M for y in years]
    out["shortest_longest_night_any_point_2_m"] = {**_extreme(every, "hours", "hours", hi=False),
                                                   "points": len(every), **{f"points_within_{n}": sum(r["hours"] <= h for r in every) for n, h in SURVIVAL_HOURS.items()}}
    return out


def main():
    result = compute(json.loads((PRODUCTS / "candidate_sites_summary.json").read_text()))
    RESULT.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
