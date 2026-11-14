"""Export the Moon's orientation for the browser's station-level DSN test.

Writes web/data/ephemeris_rotation.bin (little-endian float32, [epoch][9], the row-major matrix that turns a
J2000 vector into MOON_ME) and web/data/ephemeris_rotation.json (header). The browser rotates a DSN station's
position (known analytically in J2000 from the Earth-fixed coordinates) into MOON_ME with it, so the station's own
direction from the lander can be tested against the skyline (lunazen/dsn.py station_in_view). The Moon turns about
13 deg a day, so a table every 12 h with 4-point Lagrange interpolation is enough: the station offset is at most
6378 km, and the check below is in metres at that distance (100 m is 0.00002 deg at the Moon, the same order as the
0.05 arcsec of the Sun and Earth tables). Loaded only by the engine option dsnRule "station".

    uv run python pipeline/export_ephemeris_rotation.py
"""

import json
from pathlib import Path

import numpy as np
import spiceypy as spice

from lunazen.kernels import KERNELS, spice_kernels, utc_to_et

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
START_UTC, END_UTC, STEP_S = "2024-01-01T00:00:00", "2044-01-01T00:00:00", 12 * 3600.0
STATION_RADIUS_M = 6378137.0


def lagrange4(values, ets, et0, step):
    u = (ets - et0) / step
    i = np.clip(np.floor(u).astype(int) - 1, 0, len(values) - 4)
    x = u - i
    w = np.stack([-(x - 1) * (x - 2) * (x - 3) / 6, x * (x - 2) * (x - 3) / 2,
                  -x * (x - 1) * (x - 3) / 2, x * (x - 1) * (x - 2) / 6], axis=1)
    return sum(w[:, k, None] * values[i + k] for k in range(4))


def main():
    with spice_kernels():
        et0, et1 = utc_to_et(START_UTC), utc_to_et(END_UTC)
        ets = np.arange(et0, et1 + STEP_S, STEP_S)
        table = np.array([spice.pxform("J2000", "MOON_ME", float(t)).reshape(9) for t in ets])
        rng = np.random.default_rng(42)
        probe = rng.uniform(et0 + STEP_S * 2, et1 - STEP_S * 2, 3000)
        truth = np.array([spice.pxform("J2000", "MOON_ME", float(t)).reshape(9) for t in probe])
        got = lagrange4(table.astype(np.float32).astype(np.float64), probe, et0, STEP_S)
        # The error that matters: how far a 6378 km vector lands from where SPICE puts it, in metres.
        error_m = float(np.abs(got - truth).max() * STATION_RADIUS_M * np.sqrt(3))
        assert error_m < 100.0, error_m
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ephemeris_rotation.bin").write_bytes(table.astype("<f4").tobytes())
    (OUT / "ephemeris_rotation.json").write_text(json.dumps({
        "format": "float32 little-endian, shape [count][9]: row-major rotation J2000 -> MOON_ME",
        "kernels": list(KERNELS), "et0": float(et0), "step_s": STEP_S, "count": int(len(ets)),
        "interpolation": "4-point Lagrange", "max_error_m_at_station_distance": round(error_m, 3),
    }, indent=1))
    print(f"wrote {len(ets)} epochs, {table.size * 4 / 1e3:.0f} kB; max error {error_m:.3f} m at 6378 km")


if __name__ == "__main__":
    main()
