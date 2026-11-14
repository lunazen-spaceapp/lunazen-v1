"""Notebook 1 (one place, one moment) must agree with the packaged modules it re-derives."""

import copy
import json

import nbformat
import numpy as np
import pytest
from nbclient import NotebookClient

from lunazen import dsn
from lunazen.geometry import site_from_latlon
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.paths import KERNELS, ROOT
from lunazen.products import candidate_spots
from lunazen.visibility import body_state

PATH = ROOT / "notebooks" / "01_one_point_one_moment.ipynb"
needs_kernels = pytest.mark.skipif(not (KERNELS / "de440s.bsp").exists(), reason="run scripts/fetch_data.sh")

PROBE = """
import json
print("PROBE" + json.dumps({
    "ground_m": float(GROUND_M), "sun_az": float(sun_az), "sun_el": float(sun_el),
    "earth_az": float(earth_az), "earth_el": float(earth_el),
    "sun_f": float(sun_f), "earth_f": float(earth_f),
    "sun_skyline": float(horizon_at(sun_az)), "earth_skyline": float(horizon_at(earth_az)),
    "dsn_el": {k: float(v) for k, v in dsn_el.items()}, "link": bool(link),
}))
"""


def run_probe():
    notebook = copy.deepcopy(nbformat.read(PATH, as_version=4))
    notebook.cells.append(nbformat.v4.new_code_cell(PROBE))
    NotebookClient(notebook, timeout=600, kernel_name="python3", resources={"metadata": {"path": str(PATH.parent)}}).execute()
    text = "".join(o.get("text", "") for o in notebook.cells[-1].outputs)
    return json.loads(text.split("PROBE", 1)[1])


@needs_kernels
def test_notebook_one_matches_modules():
    got = run_probe()
    with spice_kernels():
        et = np.array([utc_to_et("2027-03-01T06:15:00")])
        # Same spot as the notebook; the product's 5 m tile horizon differs a little from the notebook's 20 m map.
        _, horizon = candidate_spots(2.0)["Site01-1"]
        site = site_from_latlon(-89.47485136585945, 222.55686188749715, got["ground_m"] + 2.0)
        for body, key in (("SUN", "sun"), ("EARTH", "earth")):
            state = body_state(body, et, site, horizon)
            assert got[f"{key}_az"] == pytest.approx(float(state["azimuth_deg"][0]), abs=0.01)
            assert got[f"{key}_el"] == pytest.approx(float(state["elevation_deg"][0]), abs=0.01)
            assert got[f"{key}_skyline"] == pytest.approx(float(horizon.at(got[f"{key}_az"])), abs=0.3)
        elevations = dsn.moon_elevations(et)
        link = bool(body_state("EARTH", et, site, horizon)["visible"][0] and dsn.dsn_in_view(et)[0])
    for name, key in (("Goldstone", "Goldstone (DSS-14)"), ("Canberra", "Canberra (DSS-43)"), ("Madrid", "Madrid (DSS-63)")):
        assert got["dsn_el"][key] == pytest.approx(float(elevations[name][0]), abs=0.01)
    assert got["link"] is link is False
