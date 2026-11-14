import pytest

from lunazen.kernels import spice_kernels
from lunazen.paths import ILLUMINATION, KERNELS, LOLA, PGDA


def _missing(*paths):
    return not all(p.exists() for p in paths)


needs_kernels = pytest.mark.skipif(_missing(KERNELS / "de440s.bsp"), reason="run scripts/fetch_data.sh")
needs_dems = pytest.mark.skipif(
    _missing(PGDA / "Site01" / "Site01_final_adj_5mpp_surf.tif", LOLA / "LDEM_85S_20M.IMG", LOLA / "LDEM_80S_80M.IMG"),
    reason="run scripts/fetch_data.sh",
)
needs_global_dem = pytest.mark.skipif(_missing(LOLA / "LDEM_64.IMG"), reason="run scripts/fetch_data.sh")
needs_illumination = pytest.mark.skipif(_missing(ILLUMINATION / "AVGVISIB_85S_060M_201608.IMG"), reason="run scripts/fetch_data.sh")


@pytest.fixture(scope="module")
def spice_loaded():
    with spice_kernels():
        yield
