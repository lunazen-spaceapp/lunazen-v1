#!/usr/bin/env bash
# Fetch all external data into data/external/ (git-ignored). Safe to re-run:
# complete files are skipped, partial ones resume, and every file is checked
# (some servers answer a missing file with an HTML page and HTTP 200).
#
#   kernels/       NAIF SPICE kernels (leap seconds, lunar frames, DE440 ephemeris)
#   pgda/<site>/   NASA PGDA 5 m/px candidate-site DEMs and slope maps (method: Barker et al. 2021),
#                  plus region-of-interest shapefiles where NASA provides them
#   lola/          LOLA gridded DEMs: polar 20 m and 80 m, global 64 px/deg
#   illumination/  LOLA average Sun / Earth visibility maps (Mazarico et al. 2011)
#   windows/       terrain windows at CLPS landing sites (lunazen/windows.py): LOLA 20 m around
#                  IM-1 and IM-2, SLDEM2015 (59 m) around Blue Ghost 1; HTTP range requests,
#                  ~700 MB of transfer, ~150 MB kept
#
# LOLA products come from the MIT LOLA team mirror of the PDS archive. If it is
# slow or down, the same files are on the PDS Geosciences Node:
#   https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/data/external"

check() {  # check <file>: reject HTML error pages and wrong file types
  local file="$1" head
  head="$(head -c 16 "$file" | od -An -tx1 | tr -d ' \n')"
  if head -c 512 "$file" | grep -qiE "<!doctype html|<html"; then
    echo "    ERROR: $(basename "$file") is an HTML page, not data (missing on the server?)" >&2
    rm -f "$file"; return 1
  fi
  case "$file" in
    *.tif) [[ "$head" == 49492a00* || "$head" == 4d4d002a* ]] || { echo "    ERROR: $file is not a TIFF" >&2; return 1; } ;;
    *.tgz) [[ "$head" == 1f8b* ]] || { echo "    ERROR: $file is not gzip" >&2; return 1; } ;;
    *.LBL) head -c 64 "$file" | grep -q "PDS_VERSION_ID" || { echo "    ERROR: $file is not a PDS label" >&2; return 1; } ;;
  esac
}

fetch() {  # fetch <url> <destination>
  mkdir -p "$(dirname "$2")"
  printf "  %-48s" "$(basename "$2")"
  # Abort a stalled transfer (< 10 kB/s for 60 s) and resume it, up to 10 times.
  curl -fsSL -C - --speed-limit 10000 --speed-time 60 \
       --retry 10 --retry-delay 5 --retry-all-errors -o "$2" "$1"
  check "$2"
  echo " $(du -h "$2" | cut -f1)"
}

NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
echo "SPICE kernels"
fetch "$NAIF/lsk/naif0012.tls"                     "$EXT/kernels/naif0012.tls"
fetch "$NAIF/pck/pck00011.tpc"                     "$EXT/kernels/pck00011.tpc"
fetch "$NAIF/fk/satellites/moon_de440_250416.tf"   "$EXT/kernels/moon_de440_250416.tf"
fetch "$NAIF/pck/moon_pa_de440_200625.bpc"         "$EXT/kernels/moon_pa_de440_200625.bpc"
fetch "$NAIF/spk/planets/de440s.bsp"               "$EXT/kernels/de440s.bsp"

PGDA=https://pgda.gsfc.nasa.gov/data/LOLA_5mpp
echo "NASA PGDA 5 m candidate sites (~1.4 GB; the selection rule is in data/sites/site_selection.csv)"
for site in Site01 Site04 Site06 Site07 Site11 Site20 Site23 Site42 Haworth DM2 SL2 SL3 LM7; do
  for kind in surf slp; do
    fetch "$PGDA/$site/${site}_final_adj_5mpp_$kind.tif" "$EXT/pgda/$site/${site}_final_adj_5mpp_$kind.tif"
  done
done
for site in Site01 Site04 Site07 Site11; do  # NASA provides ROI shapefiles only for these
  fetch "$PGDA/$site/${site}_ROIs.tgz" "$EXT/pgda/$site/${site}_ROIs.tgz"
done

LOLA=https://imbrium.mit.edu/DATA/LOLA_GDR
echo "LOLA DEMs (~1.1 GB)"
for product in LDEM_80S_80M LDEM_85S_20M; do
  for ext in LBL IMG; do fetch "$LOLA/POLAR/IMG/$product.$ext" "$EXT/lola/$product.$ext"; done
done
for ext in LBL IMG; do fetch "$LOLA/CYLINDRICAL/IMG/LDEM_64.$ext" "$EXT/lola/LDEM_64.$ext"; done

echo "LOLA illumination maps"
for product in AVGVISIB_85S_060M_201608 AVGVISIB_85S_060M_201608_EARTH; do
  for ext in LBL IMG; do fetch "https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/$product.$ext" "$EXT/illumination/$product.$ext"; done
done
echo "Terrain windows at CLPS landing sites"
(cd "$ROOT" && uv run python -m lunazen.windows)
echo "done: $(du -sh "$EXT" | cut -f1) in data/external/"
