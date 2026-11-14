"""Retake the app screenshots the User Guide shows (figures/app_*.png) and the README's Planner picture (docs/media/planner.png).

Run from the repository root:  uv run python docs/learn/shots.py
The app is served from web/ on a free port; the pages are shown in the light theme, as the PDF is light.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402

from scenarios import webflow  # noqa: E402

FIG = ROOT / "docs" / "learn" / "figures"
PINS = ("DM2-4,2027-04-07T06,2,14,viper,50,50,earliest,2027-03-15,61,robust,100;"
        "Site01-1,2027-04-09T00,2,14,viper,50,50,earliest,2027-03-15,61,robust,50")
# name: (address, selector to wait for, clicks before the picture)
PAGES = {
    "map": ("map.html#spot=Site01-1", "#band", []),
    "explorer": ("explorer.html#spot=Site01-1&mast=2&start=2027-03-01&days=45&t=25", "#moment-cards .exp-card", []),
    "planner": ("planner.html#spot=Site01-1&start=2027-03-15&days=61", "#take-list .lz-take", ["#take .exp-snap-head"]),
    "windows": ("windows.html#spot=Site01-1&date=2027-03-15", "#slip tbody tr", []),
    "compare": (f"compare.html#pins={PINS}&shift=9", ".lz-card canvas", []),
}


def main():
    with webflow.serve() as base, sync_playwright() as p:
        browser = webflow.launch(p)
        for name, (address, ready, clicks) in PAGES.items():
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, color_scheme="light")
            ctx.add_init_script("try { localStorage.setItem('lunazen-theme', 'light') } catch (e) {}")
            page = ctx.new_page()
            page.goto(base + address)
            page.wait_for_selector(ready, timeout=webflow.RESULT_TIMEOUT_MS, state="attached")
            page.wait_for_timeout(2500)
            if name == "planner":  # the suggestions are the point: wait until the other spots are checked
                page.wait_for_function("!/Checking other spots/.test(document.getElementById('take-progress').textContent) || document.getElementById('take-progress').hidden", timeout=webflow.RESULT_TIMEOUT_MS)
            for selector in clicks:
                page.click(selector)
            page.wait_for_timeout(1500)
            page.evaluate("document.getElementById('lz-tray')?.remove()")
            page.locator("main").screenshot(path=str(FIG / f"app_{name}.png"))
            if name == "planner":
                page.locator("main").screenshot(path=str(ROOT / "docs" / "media" / "planner.png"))
            ctx.close()
            print(name, "ok")
        browser.close()


main()
