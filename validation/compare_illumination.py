"""Compare simulated 18.6-year average Sun / Earth visibility with the LOLA team's
published maps (Mazarico et al. 2011; AVGVISIB_85S_060M_201608[_EARTH]).

Published definition: fraction of timesteps over a lunar nutation cycle in which
ANY part of the solar (Earth) disc is above the horizon, from the surface of
each 60 m pixel, using a 60 m DEM.

Two model configurations are compared at each point:
  matched     - the published method: 60 m pixel centre, ground level, terrain
                from 60 m range outward (our 20 m / 80 m DEMs, nested tracer)
  production  - our lander configuration: 2 m observer height, terrain from 10 m

    uv run python validation/compare_illumination.py
"""

import json
from pathlib import Path

import numpy as np

from lunazen.geometry import site_from_latlon, south_polar_to_latlon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.paths import ILLUMINATION, ROOT
from lunazen.terrain import ground_height_dems, load_pds_img, polar_dems, trace_horizon_nested
from lunazen.visibility import earth_state, sun_state

ILLUM = ILLUMINATION
OUTPUT = Path(__file__).resolve().parent / "illumination_comparison.json"

START_UTC = "2010-01-01T00:00:00"
YEARS = 18.6
PIXEL_M = 60.0


def published_maps():
    return (load_pds_img(ILLUM / "AVGVISIB_85S_060M_201608.IMG"),
            load_pds_img(ILLUM / "AVGVISIB_85S_060M_201608_EARTH.IMG"))


def sample_points(published, count, seed=0):
    """Random 60 m pixel centres in 85-89.7 deg S, stratified by published illumination."""
    rng = np.random.default_rng(seed)
    rho_max = 2 * 1_737_400.0 * np.tan(np.radians(5.0) / 2)
    rho_min = 2 * 1_737_400.0 * np.tan(np.radians(0.3) / 2)
    points = []
    for lo, hi in zip(np.linspace(0.0, 0.9, count + 1)[:-1], np.linspace(0.0, 0.9, count + 1)[1:]):
        for _ in range(20_000):
            r, t = rng.uniform(rho_min, rho_max), rng.uniform(0, 2 * np.pi)
            x = published.x0_m + (np.floor((r * np.sin(t) - published.x0_m) / PIXEL_M) + 0.5) * PIXEL_M
            y = published.y0_m - (np.floor((published.y0_m - r * np.cos(t)) / PIXEL_M) + 0.5) * PIXEL_M
            if lo <= published.sample(np.array([x]), np.array([y]), "nearest")[0] < hi:
                points.append((f"pt{len(points):02d}", x, y))
                break
    return points


def ground(x, y, dems):
    return dems[0].sample(np.array([x]), np.array([y]))[0]


def slope_deg(x, y, dems, d=20.0):
    gx = (ground(x + d, y, dems) - ground(x - d, y, dems)) / (2 * d)
    gy = (ground(x, y + d, dems) - ground(x, y - d, dems)) / (2 * d)
    return float(np.degrees(np.arctan(np.hypot(gx, gy))))


def simulate(x, y, dems, ets, configuration):
    lat, lon = south_polar_to_latlon(x, y)
    h0 = ground_height_dems(lat, lon, dems)
    if configuration == "matched":  # the published method: ground level, terrain from one 60 m pixel out
        height, min_range, step = 0.0, PIXEL_M, 20.0
    else:  # our lander configuration
        height, min_range, step = 2.0, 10.0, 5.0
    horizon, _, _ = trace_horizon_nested(lat, lon, h0, dems, 0.25, observer_height_m=height,
                                         min_range_m=min_range, step_min_m=step)
    site = site_from_latlon(lat, lon, h0 + height)
    return (float(np.mean(sun_state(ets, site, horizon)["fraction"] > 0.0)),
            float(np.mean(earth_state(ets, site, horizon)["visible"])))


def time_grid(step_s):
    et0 = utc_to_et(START_UTC)
    return np.arange(et0, et0 + YEARS * 365.25 * 86400.0, step_s)


def main():
    sun_map, earth_map = published_maps()
    dems = polar_dems()
    results = []
    with spice_kernels():
        ets = time_grid(3 * 3600.0)
        for name, x, y in sample_points(sun_map, 36):
            row = {"id": name, "x_m": x, "y_m": y, "slope_deg": slope_deg(x, y, dems),
                   "published_sun": float(sun_map.sample(np.array([x]), np.array([y]), "nearest")[0]),
                   "published_earth": float(earth_map.sample(np.array([x]), np.array([y]), "nearest")[0])}
            for configuration in ("matched", "production"):
                row[f"{configuration}_sun"], row[f"{configuration}_earth"] = simulate(x, y, dems, ets, configuration)
            results.append(row)
            print(f"{name} slope {row['slope_deg']:4.1f}  sun pub {row['published_sun']:.3f} matched {row['matched_sun']:.3f} "
                  f"production {row['production_sun']:.3f} | earth pub {row['published_earth']:.3f} matched {row['matched_earth']:.3f} "
                  f"production {row['production_earth']:.3f}")

    summary = {}
    for configuration in ("matched", "production"):
        for body in ("sun", "earth"):
            diff = np.array([r[f"{configuration}_{body}"] - r[f"published_{body}"] for r in results])
            summary[f"{configuration}_{body}"] = {
                "mean": float(diff.mean()), "rms": float(np.sqrt(np.mean(diff**2))),
                "median_abs": float(np.median(np.abs(diff))), "max_abs": float(np.max(np.abs(diff)))}
            s = summary[f"{configuration}_{body}"]
            print(f"{configuration:10s} {body:5s}: mean {s['mean']:+.3f}  RMS {s['rms']:.3f}  "
                  f"median |d| {s['median_abs']:.3f}  max |d| {s['max_abs']:.3f}")
    OUTPUT.write_text(json.dumps({"start_utc": START_UTC, "years": YEARS, "step_s": 3 * 3600.0,
                                  "summary": summary, "points": results}, indent=1))
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
