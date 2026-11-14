"""Export Sun, Earth and Moon positions for the browser engine.

Writes web/data/ephemeris.bin (little-endian float32, [epoch][body][x, y, z] km) and
web/data/ephemeris.json (header). Bodies: SUN and EARTH from the Moon's centre in
MOON_ME (for the lander's sky), and MOON from Earth's centre in J2000 (for DSN station
visibility, rotated to Earth-fixed in the browser); all with LT+S. Epochs are uniform in ET (TDB seconds past J2000). The browser
interpolates with 4-point Lagrange; error vs SPICE is checked here (< 0.05 arcsec).

    uv run python pipeline/export_ephemeris.py
"""

import json
from pathlib import Path

import numpy as np
import spiceypy as spice

from lunazen.kernels import KERNELS, spice_kernels, utc_to_et
from lunazen.visibility import SPICE_CORRECTION

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
START_UTC, END_UTC, STEP_S = "2024-01-01T00:00:00", "2044-01-01T00:00:00", 4 * 3600.0
TABLES = (("SUN", "MOON_ME", "MOON"), ("EARTH", "MOON_ME", "MOON"), ("MOON", "J2000", "EARTH"))
BODIES = tuple(t[0] for t in TABLES)


def lagrange4(positions, ets, et0, step):
    u = (ets - et0) / step
    i = np.clip(np.floor(u).astype(int) - 1, 0, len(positions) - 4)
    x = u - i
    w = np.stack([-(x - 1) * (x - 2) * (x - 3) / 6, x * (x - 2) * (x - 3) / 2,
                  -x * (x - 1) * (x - 3) / 2, x * (x - 1) * (x - 2) / 6], axis=1)
    return sum(w[:, k, None] * positions[i + k] for k in range(4))


def angle_arcsec(a, b):
    return np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b), axis=1), np.sum(a * b, axis=1))) * 3600.0


def main():
    with spice_kernels():
        et0, et1 = utc_to_et(START_UTC), utc_to_et(END_UTC)
        ets = np.arange(et0, et1 + STEP_S, STEP_S)
        table = np.stack([np.asarray(spice.spkpos(b, ets, frame, SPICE_CORRECTION, observer)[0])
                          for b, frame, observer in TABLES], axis=1).astype("<f4")

        rng = np.random.default_rng(42)
        probe = rng.uniform(et0 + STEP_S * 2, et1 - STEP_S * 2, 5000)
        errors = {}
        for k, (body, frame, observer) in enumerate(TABLES):
            truth = np.asarray(spice.spkpos(body, probe, frame, SPICE_CORRECTION, observer)[0])
            got = lagrange4(table[:, k, :].astype(np.float64), probe, et0, STEP_S)
            errors[body] = float(angle_arcsec(got, truth).max())
        assert max(errors.values()) < 0.05, errors

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ephemeris.bin").write_bytes(table.tobytes())
    header = {
        "format": "float32 little-endian, shape [count][bodies][3], km",
        "bodies": list(BODIES), "frames": [t[1] for t in TABLES], "observers": [t[2] for t in TABLES],
        "aberration_correction": SPICE_CORRECTION, "kernels": list(KERNELS),
        "et0": float(et0), "step_s": STEP_S, "count": int(len(ets)),
        "start_utc": START_UTC, "end_utc": END_UTC,
        "interpolation": "4-point Lagrange", "max_error_arcsec": errors,
    }
    (OUT / "ephemeris.json").write_text(json.dumps(header, indent=1))
    print(f"wrote {len(ets)} epochs, {table.nbytes / 1e6:.2f} MB; max interpolation error {errors} arcsec")


if __name__ == "__main__":
    main()
