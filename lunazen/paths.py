"""Repository data locations. External data is fetched by scripts/fetch_data.sh."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXTERNAL = DATA / "external"
KERNELS = EXTERNAL / "kernels"
PGDA = EXTERNAL / "pgda"
LOLA = EXTERNAL / "lola"
ILLUMINATION = EXTERNAL / "illumination"
PRODUCTS = DATA / "products"
SITES = DATA / "sites"
