[![tests](https://github.com/lunazen-spaceapp/lunazen-v1/actions/workflows/test.yml/badge.svg)](https://github.com/lunazen-spaceapp/lunazen-v1/actions/workflows/test.yml)

# LunaZen: Lunar Landing Site Navigator

At the lunar south pole the Sun never climbs more than a few degrees, so a ridge far away can decide whether a lander has light and a line to Earth. A landing site that appears favourable on a broad illumination map may therefore be unsuitable at the actual landing location.

LunaZen shows, for a spot and a date, when the Sun and Earth are above the real terrain horizon and how long the dark lasts. It helps users explore candidate landing sites, evaluate mission windows and understand how changing mission constraints affects landing feasibility.

It runs entirely in your browser. A NASA Space Apps 2026 project.

- **App:** https://lunazen-v1.vercel.app
- **Overview video:** https://youtu.be/9aBHnTUXZ4o
- **User Guide:** [lunazen_guide.pdf](docs/learn/lunazen_guide.pdf), 10 pages; page 2 is a one-page overview
- **Videos:** https://www.youtube.com/playlist?list=PLct6-XOWUjH8 (a six-part series on the south polar sky)

![The Home page: the Sun and Earth over the Site01-1 skyline through March 2027](docs/media/hero.gif)

## What you can do

- **Ask a planning question as a sentence.** The Planner tests every landing time at a spot, and at 12 points up to 100 m around it, and answers in about a second.
- **See what would make a landing work.** Another spot, a lander that tolerates a longer night, or a tighter landing radius, each checked by the engine.
- **Re-plan when the date slips.** Delay Analyzer shows the next valid window and the backup spots; Compare landings shifts pinned landings by any number of days.
- **Look at the real sky.** The Explorer draws the Sun and Earth on the terrain skyline, in a panorama and in 3D, with countdowns to the next sunset and Earthset and exportable visibility windows.
- **Browse the whole pole.** The Map shows NASA's sunlight and Earth-visibility maps with 13 sites and 67 spots; add your own point and save it.
- **Compare.** Ranker ranks all 67 spots for one landing; Compare sites puts two to four sites side by side.
- **Go beyond the pole.** Twelve landing sites (Apollo, Chang'e, Chandrayaan-3, SLIM) with their skies beside the pole's.

![The Planner at its default question: Site01-1 from 15 March 2027](docs/media/planner.png)

## Try it

The Plan pages open on Site01-1 from 15 March 2027.

1. **Planner.** 18% of landing times are valid at the spot, but none within 100 m. Under *Constraint relaxation*, DM2-4 has 9 valid landing days from 7 April; a lander that tolerates 253 h of darkness would work; so would a 50 m radius (2 landing times, from 9 April). Press the pin icon on a landing.
2. **Compare landings.** Enter 9 days and press *Rerun pins* to see what a nine-day slip does to each pin.
3. **Delay Analyzer.** Site01-1 is not valid on 15 March (DSN visibility is too low); the next valid window opens on 2 April, 18 days later.
4. **Explorer.** Site01-1 on 1 March 2027 at 06:15 UTC: the Sun sets in 36 h 15 min and Earth rises in 3 d 18 h.
5. **Map.** In *Plot a point*, pick a point inside a mapped site for its four figures, then *Save to My points*.

## Why you can rely on it

Each step is checked against evidence the program did not produce; the Evidence page in the app (under Resources) shows every check against its tolerance.

- Sun and Earth directions match JPL Horizons to 0.1″ (4 sites, 70 dates each).
- 18.6-year average sunlight matches NASA's LOLA maps to 1.6 percentage points RMS over 26 points.
- The seven Connecting Ridge regions of Barker et al. (2021) are reproduced to within 1.4 points.
- The Sun's angle at the Apollo 11, 12 and 14 moonwalks matches the Apollo Lunar Surface Journal to 0.12°.
- Blue Ghost 1's sunset is reproduced to about 6 minutes, and IM-1's terrain height to 15 m.
- The browser engine is tested against the Python reference on every run.

These figures describe the project's documented validation cases and test datasets. They should not be interpreted as a guarantee of equivalent accuracy at every possible lunar location or for every mission scenario.

LunaZen answers geometry questions: light, darkness and line of sight. It judges a lander against a darkness limit with a source (5 h, what Blue Ghost 1 survived; 50 h, VIPER's design figure) or hours you enter, and it leaves a lander's power and thermal design to the lander's team.

### Scope and limitations

LunaZen is a terrain-aware geometry and mission-scenario decision-support tool. Its outputs should be interpreted within the scope of the models implemented:

- **Communications visibility:** DSN visibility represents geometric line of sight and station elevation constraints. It is not a radio-frequency link budget, signal-strength calculation or complete operational DSN scheduling model.
- **Sun energy:** The Sun energy figure is the light a Sun-tracking upright array would collect (Wh per W of panel, the hours of full Sun). It is not a prediction of lander power generation and does not model a power system.
- **Survival:** Darkness-tolerance scenarios compare the longest dark interval against a specified tolerance. They do not simulate battery capacity, energy consumption, thermal behaviour or a complete lander survival system.
- **Terrain uncertainty:** Results are also tested with the skyline raised 0.1° and 0.25°; a higher skyline never adds sunlight. This does not cover every terrain or landing-location uncertainty.

LunaZen supports exploration and comparison of landing scenarios. It does not certify a landing site or replace detailed mission engineering and operational analysis.

## Run it

```bash
cd web && npm run serve        # then open http://localhost:8000/
```

Node is the only requirement. A packaged zip of the app runs with `./start.sh` (macOS, Linux) or `start.bat` (Windows).

The app is best on a laptop or desktop browser and also works on phones; the 3D tab needs WebGL2.

```bash
bash scripts/build_site.sh
```

Builds the deployable site into `public/`.

```bash
scripts/package_web.sh
```

Builds the downloadable zip.

## Tests

```bash
cd web && npm test
```

Runs the browser engine against the Python fixtures and tests the app helpers.

```bash
uv sync && uv run pytest
```

Runs the Python tests; with Chrome installed it also drives the pages (`tests/test_web_flows.py`).

```bash
./scripts/fetch_data.sh
```

Downloads about 2.5 GB into `data/external/`; enables the terrain, illumination and notebook tests.

`uv run python pipeline/site_report.py Site01-1 2027-01-01 2028-01-01` is the Explorer on the command line (Sun up 89.7% of the year, Earth 55.2%, longest night 138 h).

Two notebooks in `notebooks/` follow the method step by step (`uv run jupyter lab`, after fetching the data).

## Repository

| Folder | What is in it |
|---|---|
| `lunazen/` | The Python reference: SPICE geometry, terrain horizons, visibility, DSN, missions, ranking |
| `web/` | The app: pages (`*.html`), scripts (`app/`), the browser engine (`engine/`) and its data (`data/`) |
| `pipeline/`, `validation/` | The offline builds that turn NASA data into the app's data, and the checks against independent sources |
| `data/` | Site definitions with sources and small precomputed products (`external/` is downloaded and git-ignored) |
| `tests/`, `scenarios/` | The Python tests, including the browser flows, and a re-runnable slipped-landing walkthrough |
| `notebooks/`, `docs/` | The notebooks, and the User Guide with its figure and screenshot scripts |
| `scripts/`, `packaging/` | Data download, the site build and the downloadable zip |

## Use of AI

LunaZen was developed through a human-directed, AI-assisted workflow. The team conceived the project, defined its scientific and technical approach, made design decisions, directed implementation and evaluated the resulting application. Generative AI was used to assist with software development and media production.

### AI tools and their contribution

- **Anthropic Claude and Claude Code:** Used as AI coding assistants to generate and refine Python code and support software implementation.
- **Video and animation workflows:** Claude Code was also used to generate Python scripts for video and audio production. Manim was used for mathematical and scientific animations, while Kokoro and Microsoft Edge TTS were used for text-to-speech narration.

### Human contribution

The human team was responsible for the project concept, scientific problem framing, architecture, technical direction, selection and interpretation of data sources, decisions about modelling assumptions, validation approach, review of generated code and integration of the application.

AI assistance accelerated implementation and supported the production workflow, but the project's scientific design, engineering decisions and evaluation remained human-directed.

### Scientific integrity

LunaZen's displayed scientific results are calculated by its own geometry and terrain-modelling engine using the project's NASA and other documented reference datasets. The project includes comparisons against independent scientific references.

Generative AI is not used to invent or supply the application's calculated Sun, Earth, terrain or mission-visibility results.

## Team

**Team LunaZen**

- **Ishaan**
- **Anirban**

No names, voices or faces of anyone under 18 appear in the app, the guide or the videos.

## Licence and credits

- The code and the documentation (the guide, its figures and the notebooks) are under the [Apache License 2.0](LICENSE).
- NASA data is used under NASA's public-domain and open-data terms. Not endorsed by NASA; no NASA logo or mission patch is used.
- The bundled fonts, Jost and Public Sans (`web/app/fonts/`), are under the SIL Open Font License 1.1; the licence texts are next to the fonts.

### Data sources

- NASA/JPL NAIF SPICE kernels (DE440, lunar frames).
- LRO LOLA elevation models (PDS, via the MIT LOLA mirror).
- NASA PGDA 5 m candidate-site maps (Barker et al. 2021).
- SLDEM2015 terrain (LOLA and Kaguya).
- LROC and NSSDCA landing positions.
- LOLA average illumination and Earth-visibility maps (Mazarico et al. 2011).
- Deep Space Network antenna positions from NASA/JPL document 810-005.
- JPL Horizons (validation only).