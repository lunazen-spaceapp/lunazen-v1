#!/bin/sh
# Build the distributable: a zip of the site (the same build the website uses, scripts/build_site.sh), the start scripts and
# the guide PDF (no tests, pipeline or notebooks).
#     scripts/package_web.sh [output-folder]      writes <output-folder>/lunazen-landing-site-navigator-<commit>.zip (default: ~/Downloads)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/Downloads}"
NAME="lunazen-landing-site-navigator-$(git -C "$ROOT" rev-parse --short HEAD)"
STAGE="$(mktemp -d)"
bash "$ROOT/scripts/build_site.sh" >/dev/null 2>&1 || { echo "the site build failed; run scripts/build_site.sh to see why" >&2; exit 1; }
mkdir -p "$STAGE/$NAME"
cp -R "$ROOT/public/." "$STAGE/$NAME/"
cp "$ROOT/packaging/README.txt" "$ROOT/packaging/start.sh" "$ROOT/packaging/start.bat" "$STAGE/$NAME/"
# The node fallback of start.sh: serve.mjs serves the guides from docs/ in the repo; in the package the PDFs sit next to it.
python3 - "$ROOT/web/serve.mjs" "$STAGE/$NAME/serve.mjs" <<'PY'
import sys
s = open(sys.argv[1]).read()
s = s.replace('const PDFS = { "/lunazen_guide.pdf": "lunazen_guide.pdf", "/how_the_app_works.pdf": "lunazen_guide.pdf" };\n\n', '')
s = s.replace('  const pdf = PDFS[path]; // the site build copies the PDFs into the root; in development they are served from docs/learn\n  if (pdf) file = join(root, "..", "docs", "learn", pdf);\n', '')
s = s.replace(' && !pdf', '')
open(sys.argv[2], "w").write(s)
PY
mkdir -p "$OUT"
rm -f "$OUT/$NAME.zip"
(cd "$STAGE" && zip -qr "$OUT/$NAME.zip" "$NAME" -x "*/.DS_Store")
rm -rf "$STAGE"
echo "$OUT/$NAME.zip"
