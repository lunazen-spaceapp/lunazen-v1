"""Notebook 2 (one place, many moments) must agree with the packaged modules for the same spot and year."""

import copy
import json

import nbformat
import numpy as np
import pytest
from nbclient import NotebookClient

from lunazen import dsn
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import STEP_S, longest_run_hours, summarize
from lunazen.paths import KERNELS, ROOT
from lunazen.planner import evaluate_landings, feasible
from lunazen.products import candidate_spots
from lunazen.visibility import earth_state, sun_state

PATH = ROOT / "notebooks" / "02_one_place_many_moments.ipynb"
needs_kernels = pytest.mark.skipif(not (KERNELS / "de440s.bsp").exists(), reason="run scripts/fetch_data.sh")

PROBE = """
import json
print("PROBE" + json.dumps({
    "ground_m": float(GROUND_M), "n": int(N), "complex_share": float(complex_sees.mean()),
    "sunlit": float(sunlit.mean()), "link": float(link.mean()), "longest_night_h": float(dark_hours.max()),
    "n_landings": int(len(good)), "n_good": int(good.sum()), "energy": float(upright),
}))
"""


def run_probe():
    notebook = copy.deepcopy(nbformat.read(PATH, as_version=4))
    notebook.cells.append(nbformat.v4.new_code_cell(PROBE))
    NotebookClient(notebook, timeout=900, kernel_name="python3", resources={"metadata": {"path": str(PATH.parent)}}).execute()
    text = "".join(o.get("text", "") for o in notebook.cells[-1].outputs)
    return json.loads(text.split("PROBE", 1)[1])


@needs_kernels
def test_notebook_two_matches_the_modules():
    got = run_probe()
    mission_s, stride = 14 * 86400.0, 24  # 14-day missions, a new landing every 6 h (24 steps)
    with spice_kernels():
        et0, et1 = utc_to_et("2027-01-01T00:00:00"), utc_to_et("2028-01-01T00:00:00")
        _, horizon = candidate_spots(2.0)["Site01-1"]  # the app's horizon: 5 m tile near the spot, not only the 20 m map
        site = candidate_spots(2.0)["Site01-1"][0]
        ets = et0 + STEP_S * np.arange(got["n"])
        assert got["n"] == int(round((et1 - et0) / STEP_S)) + 1
        # Terrain-independent: exactly the same DSN geometry.
        assert got["complex_share"] == pytest.approx(float(dsn.dsn_in_view(ets).mean()), abs=1e-9)
        # Terrain-dependent: the notebook uses the 20 m map alone, so allow for the difference.
        summary = summarize(site, horizon, et0, et1, STEP_S)
        assert got["sunlit"] == pytest.approx(summary["sunlitFraction"], abs=0.005)
        assert got["link"] == pytest.approx(summary["dsnLinkFraction"], abs=0.02)
        assert got["energy"] == pytest.approx(summary["energyWhPerW"], rel=0.03)
        assert got["longest_night_h"] == pytest.approx(summary["longestDarkHours"], abs=6.0)
        ets_x = et0 + STEP_S * np.arange(got["n"] + int(mission_s / STEP_S))
        sun_up = sun_state(ets_x, site, horizon)["fraction"] > 0
        link = (earth_state(ets_x, site, horizon)["fraction"] > 0) & dsn.dsn_in_view(ets_x)
    results = evaluate_landings(sun_up, link, STEP_S, mission_s, stride)
    results = [r for r in results if r["startIndex"] < got["n"]]
    assert got["n_landings"] == len(results) == 1461
    good = sum(feasible(r, 0.5, 50.0) for r in results)
    assert got["n_good"] == pytest.approx(good, abs=15)
