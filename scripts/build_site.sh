#!/usr/bin/env bash
# Build the deployable site into public/: the web app (one minified bundle per page script), the data and the guide PDF.
#     bash scripts/build_site.sh
# Vercel runs this (vercel.json); it also works locally: then serve public/ with  python3 -m http.server --directory public 8000
# No .gz files are written; the host compresses responses itself.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf public && mkdir public
cp -r web/* public/
cp docs/learn/lunazen_guide.pdf public/
# The guide used to be one PDF with this name; the old address still opens the (user) guide.
cp docs/learn/lunazen_guide.pdf public/how_the_app_works.pdf
# Tests and development files stay out of the site.
rm -rf public/app/test public/engine/test public/serve.mjs public/package.json

# The entry points: every module script a page loads (read from the HTML, so a new page script cannot be forgotten) and the
# worker, which pool.js starts from a URL and so is in no HTML.
ENTRIES=$(grep -ho '<script type="module" src="[^"]*"' web/*.html | sed 's/.*src="//; s/"$//' | sort -u)
ENTRIES="$ENTRIES app/worker.js"
if [ -z "$(echo "$ENTRIES" | grep -v '^app/worker.js$')" ]; then echo "no page scripts found in web/*.html" >&2; exit 1; fi
for f in $ENTRIES; do [ -f "web/$f" ] || { echo "missing entry point: web/$f" >&2; exit 1; }; done

# One minified bundle per script instead of a chain of 30 module requests.
rm -rf public/app/*.js
(cd web && npx --yes esbuild@0.25.0 $(echo $ENTRIES) --bundle --minify --format=esm --target=es2022 --outdir=../public/app)
rm -rf public/engine

test -f public/index.html
echo "built public/ ($(du -sh public | cut -f1))"
