#!/bin/sh
# Serve this folder on http://localhost:8000/ (or the port given as the first argument).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
echo "LunaZen: open http://localhost:$PORT/  (Ctrl+C to stop)"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"; fi
if command -v node >/dev/null 2>&1; then exec node serve.mjs "$PORT"; fi
echo "Install Python 3 or Node.js to run the local server." >&2; exit 1
