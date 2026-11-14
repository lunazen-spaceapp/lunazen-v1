"""SPICE kernel loading and UTC <-> ET conversion."""

from contextlib import contextmanager

import spiceypy as spice

from lunazen.paths import KERNELS as KERNEL_DIR

KERNELS = (
    "naif0012.tls",  # leap seconds
    "pck00011.tpc",  # planetary constants
    "moon_de440_250416.tf",  # lunar frames: MOON_ME, MOON_PA
    "moon_pa_de440_200625.bpc",  # high-accuracy lunar orientation
    "de440s.bsp",  # DE440 planetary ephemeris, 1849-2150
)


def load_kernels():
    for name in KERNELS:
        spice.furnsh(str(KERNEL_DIR / name))


@contextmanager
def spice_kernels():
    load_kernels()
    try:
        yield
    finally:
        spice.kclear()


def utc_to_et(utc):
    return spice.str2et(utc)


def et_to_utc(et, precision=3):
    return spice.et2utc(float(et), "ISOC", precision)
