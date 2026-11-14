# CLAUDE.md

This file guides AI coding assistants (Claude Code was used to build this project) and human contributors.

LunaZen Landing Site Navigator (NASA Space Apps 2026): for a lunar south-pole spot and a date, when the Sun and Earth are above the real terrain horizon, and how long the dark lasts. A Python reference (`lunazen/`) and a dependency-free browser engine (`web/engine/`) compute it; `web/` is a static app. The documentation is the README and the User Guide (`docs/learn/lunazen_guide.pdf`, source `lunazen_guide.tex`); the physics is in `lunazen/` (the reference) and `web/engine/` (read the relevant module before changing physics). The pages are in `web/`, the data builds in `pipeline/`, the checks in `validation/` and `tests/`.

## Commands

```bash
uv sync                          # Python env (3.12)
./scripts/fetch_data.sh          # kernels, DEMs, validation maps -> data/external/ (~2.5 GB, idempotent)
uv run pytest                    # Python tests (some need data/external/; tests/test_web_flows.py drives the pages in Chrome)
cd web && npm test               # browser engine vs the Python fixtures, app helper tests
cd web && npm run serve          # the app at http://localhost:8000/
bash scripts/build_site.sh       # the deployable site -> public/ (Vercel runs it); scripts/package_web.sh builds the zip
uv run python pipeline/site_report.py Site01-1 2027-01-01 2028-01-01   # the Explorer on the command line (or im1, bg1, --lat/--lon)
cd docs/learn && node compute.mjs && uv run python figures.py          # guide figures; then xelatex twice per .tex (see their headers)
```

## Conventions

- Units: metres for positions (SPICE returns km; convert at once), degrees at interfaces, ET (TDB seconds past J2000) for time. Azimuth from north, clockwise, 0-360; elevation above the local horizontal; frame MOON_ME; lunar sphere R = 1737.4 km.
- Every series is sampled every `STEP_S` = 15 min (`lunazen/mission.py`, `web/engine/mission.js`); change both together and regenerate products and fixtures.
- Python modules and files are snake_case; tests are named after the behaviour they check; data paths come from `lunazen/paths.py`, never hard-coded. Match the surrounding style; comments give intent, not narration.

## Science rules (do not change without a documented reason)

- A body is **up when any part of its disk is above the terrain** (`lunazen/disk.py`); never use Earth-centre-only visibility.
- Survival is a darkness limit: the longest dark period against a sourced limit (5 h Blue Ghost 1, 50 h VIPER's design figure; `lunazen/survival.py`) or the user's hours. No battery or power model; never show an invented lander's power. Sun elevation is context: never rank spots by it.
- Mission sites use the finest terrain available (`lunazen/windows.py`); the global 474 m map alone smooths away near-field ridges.
- DSN in view = Earth up and a DSN complex sees the Moon above 10° (`lunazen/dsn.py`, `web/engine/dsn.js`): line of sight only, never a link budget. The station-level rule (`dsn_rule="station"`, address key `dstation`) and the darkness threshold (`dark_below`, key `dbelow`) are options; the defaults never change.
- Horizons: `trace_horizon_nested` through a priority list of maps, finest at every sample, never the maximum over overlapping maps; 2 m observer height by default (`lunazen/terrain.py`). Results are also tested with the skyline raised 0.1° and 0.25°; a higher skyline never adds sunlight.
- Candidate spots come from NASA's average-illumination map (5 m slope <= 10°, 300 m apart); site coordinates need a cited source (`data/sites/missions.csv`); Artemis region labels come only from NASA's region grids.
- Python is the reference; the JavaScript must match it (fixture tolerances 1 µs, 0.1″, 1e-4, exact metrics). Change both together and regenerate the fixtures.
- Validation thresholds live in `validation/thresholds.py`; never loosen one to make a check pass. If a locked number changes (`tests/test_physics_baseline.py`), explain the physical cause in the commit message; never update expected values just to pass.

## Working rules

- Verify claims with code or data before writing them into docs. Every number the app shows is computed, none typed in. Say "works within 100 m", never "robust" (internal ids keep `robust`).
- Keep commits focused. External addresses live in `web/app/site-config.js`; the guide's page numbers in `web/app/links.js` (update them when a PDF is rebuilt).
