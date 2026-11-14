"""The station-level DSN rule: the lander must see the DSN complex itself above its skyline (lunazen/dsn.py)."""
import numpy as np
from conftest import needs_kernels

from lunazen.dsn import dsn_in_view, station_in_view, station_vectors_m
from lunazen.kernels import spice_kernels, utc_to_et
from lunazen.mission import STEP_S, summarize
from lunazen.products import candidate_spots
from lunazen.visibility import earth_state


@needs_kernels
def test_station_rule_is_never_more_generous_than_the_disk_rule_and_differs_only_when_earth_is_partly_hidden():
    site, horizon = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        et0 = utc_to_et("2027-03-15T00:00:00")
        ets = et0 + np.arange(61 * 96) * STEP_S
        fraction = earth_state(ets, site, horizon)["fraction"]
        disk = (fraction > 0) & dsn_in_view(ets)
        station = (fraction > 0) & station_in_view(ets, site, horizon)
    assert not np.any(station & ~disk)
    assert np.any(disk & ~station)  # Earth is partly hidden part of the time at this spot
    assert np.all((fraction[disk & ~station] > 0) & (fraction[disk & ~station] < 1))


@needs_kernels
def test_a_station_is_within_the_earth_disk_seen_from_the_moon():
    site, _ = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        ets = utc_to_et("2027-03-15T00:00:00") + np.arange(0, 86400, 3600.0)
        centre = earth_state(ets, site, candidate_spots(2.0)["Site01-1"][1])
        vectors = station_vectors_m(ets, site)
    for v in vectors.values():
        azimuth, elevation = site.az_el(v)
        dx = (azimuth - centre["azimuth_deg"] + 540) % 360 - 180
        separation = np.hypot(dx * np.cos(np.radians(elevation)), elevation - centre["elevation_deg"])
        assert np.all(separation <= centre["angular_radius_deg"] * 1.001)


@needs_kernels
def test_the_station_rule_option_changes_only_the_dsn_figures():
    site, horizon = candidate_spots(2.0)["Site01-1"]
    with spice_kernels():
        et0, et1 = utc_to_et("2027-03-15T00:00:00"), utc_to_et("2027-05-14T00:00:00")
        disk = summarize(site, horizon, et0, et1, STEP_S)
        station = summarize(site, horizon, et0, et1, STEP_S, dsn_rule="station")
    for key in ("sunlitFraction", "earthFraction", "bothFraction", "energyWhPerW", "longestDarkHours", "longestCommsGapHours"):
        assert station[key] == disk[key]
    assert station["dsnLinkFraction"] < disk["dsnLinkFraction"]
    assert station["longestDsnLinkGapHours"] >= disk["longestDsnLinkGapHours"]
