"""The darkness threshold: a sample counts as dark when less than a share of the Sun's disk is visible."""
import numpy as np
from conftest import needs_kernels

from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import STEP_S, dark_mask, longest_run_hours, summarize
from lunazen.planner import evaluate_landings
from lunazen.products import candidate_spots


def test_dark_mask_defaults_to_no_part_of_the_sun():
    f = np.array([0.0, 0.01, 0.05, 0.1, 0.49, 0.5, 1.0])
    assert dark_mask(f).tolist() == [True, False, False, False, False, False, False]
    assert dark_mask(f, 0.1).tolist() == [True, True, True, False, False, False, False]
    assert dark_mask(f, 0.5).tolist() == [True, True, True, True, True, False, False]


def test_the_planner_reference_takes_a_dark_mask_and_leaves_the_rest_alone():
    fraction = np.array([0, 0, 0.05, 0.05, 0, 0, 0.6, 0.6])
    up, link = fraction > 0, np.ones(8, bool)
    plain = evaluate_landings(up, link, 900.0, 8 * 900.0, 1)[0]
    strict = evaluate_landings(up, link, 900.0, 8 * 900.0, 1, dark=dark_mask(fraction, 0.1))[0]
    assert plain["longestDarkHours"] == 0.5 and strict["longestDarkHours"] == 1.5
    assert plain["sunlitFraction"] == strict["sunlitFraction"] and plain["linkFraction"] == strict["linkFraction"]
    assert longest_run_hours(dark_mask(fraction, 0.1), 900.0) == 1.5


@needs_kernels
def test_site01_1_longest_night_of_2027_by_threshold():
    """The figures quoted in the guide (section 7): 138 h with any part of the Sun, 142 h below 10%, 155 h below 50%."""
    site, horizon = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        et0, et1 = utc_to_et("2027-01-01T00:00:00"), utc_to_et("2028-01-01T00:00:00")
        hours = {below: summarize(site, horizon, et0, et1, STEP_S, dark_below=below)["longestDarkHours"] for below in (0.0, 0.1, 0.5)}
    assert hours == {0.0: 138.25, 0.1: 142.0, 0.5: 154.75}
