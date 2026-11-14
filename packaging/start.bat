@echo off
cd /d "%~dp0"
echo LunaZen: open http://localhost:8000/  (Ctrl+C to stop)
python -m http.server 8000 || py -m http.server 8000
