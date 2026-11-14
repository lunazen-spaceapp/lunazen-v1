"""Mission report for one site and date window: daily table plus summary.

    uv run python pipeline/site_report.py Site01-1 2027-01-01 2028-01-01
    uv run python pipeline/site_report.py Site01-1 2027-06-01 2027-07-01 --mast 10
    uv run python pipeline/site_report.py im1 2024-02-22 2024-03-04
    uv run python pipeline/site_report.py --lat -85.5 --lon 30 2027-01-01 2027-02-01

Named sites: NASA candidate spots (Site01-1 ... see data/products/candidate_sites_summary.json,
masts 1/2/5/10 m) and CLPS landing sites (im1, im2, bg1). For --lat/--lon the horizon is
traced on the fly from the LOLA maps (2 m mast).
"""

import argparse
import numpy as np

from lunazen.survival import DARKNESS_PRESETS
from lunazen.geometry import site_from_latlon
from lunazen.products import candidate_spots, mission_sites
from lunazen.kernels import et_to_utc, spice_kernels, utc_to_et
from lunazen.mission import STEP_S, summarize
from lunazen.terrain import OBSERVER_HEIGHT_M, ground_height_dems, site_dems, trace_horizon_nested
from lunazen.visibility import earth_state, sun_state

MAST_M = OBSERVER_HEIGHT_M


def resolve_site(args):
    if args.site:
        missions = mission_sites()
        if args.site in missions:
            return missions[args.site]
        spots = candidate_spots(args.mast)
        if args.site not in spots:
            raise SystemExit(f"unknown site {args.site}; try one of {sorted(spots)[:6]}... or {sorted(missions)}")
        return spots[args.site]
    dems = site_dems(args.lat)
    ground = ground_height_dems(args.lat, args.lon, dems)
    horizon, _, _ = trace_horizon_nested(args.lat, args.lon, ground, dems, 0.25, observer_height_m=MAST_M)
    return site_from_latlon(args.lat, args.lon, ground + MAST_M), horizon


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("site", nargs="?", help="named site, e.g. P54")
    parser.add_argument("start", help="UTC date, e.g. 2027-03-01")
    parser.add_argument("end", help="UTC date")
    parser.add_argument("--lat", type=float)
    parser.add_argument("--lon", type=float)
    parser.add_argument("--mast", type=float, default=OBSERVER_HEIGHT_M, help="mast height for candidate spots: 1, 2, 5 or 10 m")
    args = parser.parse_args()
    if not args.site and (args.lat is None or args.lon is None):
        parser.error("give a named site or --lat and --lon")

    site, horizon = resolve_site(args)
    step = STEP_S
    with spice_kernels():
        et0, et1 = utc_to_et(args.start), utc_to_et(args.end)
        ets = et0 + np.arange(int((et1 - et0) // step) + 1) * step
        sun, earth = sun_state(ets, site, horizon), earth_state(ets, site, horizon)
        days = [et_to_utc(t, 0)[:10] for t in ets]
        summary = summarize(site, horizon, et0, et1, step)

    print(f"Site {args.site or ''} lat {site.latitude_deg:.4f}  lon {site.longitude_deg:.4f}  "
          f"eye height {site.height_m:.0f} m above the reference sphere (ground + mast)")
    print(f"Horizon: {horizon.elevation_deg.min():.2f} .. {horizon.elevation_deg.max():.2f} deg")
    print()
    print("date        sun-up  earth-up  sun-elev(max)  earth-elev(max)")
    for day in dict.fromkeys(days):
        k = np.array([d == day for d in days])
        partial = "*" if k.sum() < 86400 / step else " "
        print(f"{day}{partial} {np.mean(sun['fraction'][k] > 0) * 100:5.0f}%  {np.mean(earth['fraction'][k] > 0) * 100:7.0f}%"
              f"  {sun['elevation_deg'][k].max():12.2f}  {earth['elevation_deg'][k].max():14.2f}")
    print("(* partial day: the window starts or ends part-way through it)\n\nSummary")
    for key, value in summary.items():
        print(f"  {key:22s} {value:10.3f}")
    dark = summary["longestDarkHours"]
    survived = [p["name"] for p in DARKNESS_PRESETS if dark <= p["hours"]]
    print(f"\nLongest dark period {dark:.0f} h: survived by {', '.join(survived) or 'none of the reference landers'}"
          f" (lunazen/survival.py)")


if __name__ == "__main__":
    main()
