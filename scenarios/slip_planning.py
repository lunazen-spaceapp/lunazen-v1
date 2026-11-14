"""Scenario: a landing slips. A lander is planned for DM2-4 on 7 April 2027 (a 50 h darkness limit, a 14-day mission,
DSN in view at least 50%, a 2 m mast). What does a mission planner see when the date moves, how do the candidate spots
compare, and when are the launch windows?

It drives the real pages in a browser and prints what each step reads, as a numbered log. Nothing is asserted: change the
spots, dates and rules below, add steps, and read the log. It exits non-zero only if a page does not load.

    uv run python scenarios/slip_planning.py [--headed] [--shots DIR] [--json FILE]
"""

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from playwright.sync_api import sync_playwright  # noqa: E402

from scenarios import webflow  # noqa: E402

SPOT = "DM2-4"
PLANNED = date(2027, 4, 7)
SLIPS_DAYS = (14, 28, 60)
ALTERNATIVES = ("Haworth-3", "Site01-1")
SEARCH_START, SEARCH_DAYS = "2027-03-15", 61
LANDER = "mast=2&mission=14&rule=viper&dark=50&link=50"


class Log:
    def __init__(self, shots=None):
        self.steps, self.shots, self.n = [], shots, 0

    def step(self, title, page=None, **facts):
        self.n += 1
        print(f"\n{self.n}. {title}")
        for key, value in facts.items():
            print(f"   {key}: {value}")
        self.steps.append({"step": self.n, "title": title, **facts})
        if self.shots and page is not None:
            self.shots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(self.shots / f"{self.n:02d}.png"), full_page=True)


def tiles(page):
    return page.locator("#answers .lz-tile").evaluate_all("els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")


def table_rows(page, limit=6):
    return page.locator("#table tbody tr").evaluate_all(f"els => els.slice(0, {limit}).map(e => e.innerText.replace(/\\s+/g, ' ').trim())")


def run(base, browser, log):
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = context.new_page()
    day = PLANNED.isoformat()

    # 1. The baseline: the landing as planned.
    webflow.open_planner(page, base, f"#spot={SPOT}&start={SEARCH_START}&days={SEARCH_DAYS}&{LANDER}&landing={day}T06")
    log.step(f"Planner: {SPOT} planned for {day} 06:00 UTC", page, verdict=webflow.text(page, "#verdict .t"), detail=webflow.text(page, "#verdict .s"),
             heatmap=webflow.text(page, "#heat-summary"), ring=webflow.text(page, "#ring")[:160])

    # 2. Delay impact: does the spot still work, for how long, when is the next window?
    for slip in (0, *SLIPS_DAYS):
        new = (PLANNED + timedelta(days=slip)).isoformat()
        webflow.open_windows(page, base, f"#spot={SPOT}&date={new}&{LANDER}")
        log.step(f"Delay impact: {SPOT} if the landing slips {slip} d to {new}", page, verdict=webflow.text(page, "#verdict .t"), tiles=tiles(page), story=webflow.text(page, "#story"))

    # 3. Which spots work on a slipped day?
    slipped = (PLANNED + timedelta(days=SLIPS_DAYS[0])).isoformat()
    webflow.open_rank(page, base, f"#start={slipped}&{LANDER.replace('mission', 'days')}")
    log.step(f"Rank: every spot for a landing on {slipped}", page, verdict=webflow.text(page, "#verdict .t"), top=table_rows(page))

    # 4. Pin candidates and compare them. Pins live in this browser context's localStorage.
    next_window = (PLANNED + timedelta(days=29)).isoformat()
    candidates = [(SPOT, next_window), *[(spot, slipped) for spot in ALTERNATIVES]]
    pinned = []
    for spot, new in candidates:
        # Search 14 days from the slipped day and take the answer: a day works if any of its four landing times does.
        webflow.open_planner(page, base, f"#spot={spot}&start={new}&days=14&{LANDER}")
        has_pin = page.locator("#pin").count() > 0
        if has_pin and page.locator("#pin").get_attribute("aria-pressed") != "true":
            page.locator("#pin").click()
        pinned.append(f"{spot} {new}: {webflow.text(page, '#verdict .t')}" + ("" if has_pin else " (no landing in the search works, so there is nothing to pin)"))
    log.step("Planner: candidates tried and pinned", page, candidates=pinned)

    page.goto(f"{base}compare.html")
    page.wait_for_function("document.querySelectorAll('#cards article, #cards .lz-card').length > 0", timeout=webflow.RESULT_TIMEOUT_MS)
    log.step("Compare landings: the pinned landings", page, cards=webflow.text(page, "#cards")[:600])
    for shift in (9, 30):
        page.fill("#shift", str(shift))
        page.click("#rerun")
        page.wait_for_function("/shifted/.test(document.getElementById('status').innerText)", timeout=webflow.RESULT_TIMEOUT_MS)
        log.step(f"Compare landings: every pin shifted by {shift} d", page, status=webflow.text(page, "#status"), cards=webflow.text(page, "#cards")[:700])
    with page.expect_download() as download:
        page.click("#csv")
    log.step("Compare landings: decision record exported", csv=Path(download.value.path()).read_text()[:400])

    # 5. Launch windows: a season of landing days, and what the other seasons offer.
    for spot in (SPOT, "Haworth-3"):
        webflow.open_planner(page, base, f"#goal=all&spot={spot}&start=2027-09-01&days=122&{LANDER}")
        log.step(f"Planner: every landing within 100 m at {spot}, 1 Sep to 31 Dec 2027", page, heatmap=webflow.text(page, "#heat-summary"), runs=webflow.text(page, "#runs")[:500])
    for new in ("2027-04-21", "2027-10-15"):
        webflow.open_rank(page, base, f"#start={new}&{LANDER.replace('mission', 'days')}")
        log.step(f"Rank on {new}", page, verdict=webflow.text(page, "#verdict .t"), top=table_rows(page, 4))
    for label, rule in (("Blue Ghost 1 (5 h)", "rule=bg1&dark=5"), ("a 150 h limit", "rule=custom&dark=150")):
        webflow.open_planner(page, base, f"#spot={SPOT}&start={SEARCH_START}&days={SEARCH_DAYS}&mast=2&mission=14&{rule}&link=50")
        log.step(f"Planner: {SPOT} with {label}", page, verdict=webflow.text(page, "#verdict .t"), detail=webflow.text(page, "#verdict .s"), heatmap=webflow.text(page, "#heat-summary"))
    context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--headed", action="store_true", help="show the browser")
    parser.add_argument("--shots", type=Path, help="save a screenshot of every step in this folder")
    parser.add_argument("--json", type=Path, help="write the log as JSON")
    args = parser.parse_args()
    log = Log(args.shots)
    with webflow.serve() as base, sync_playwright() as p:
        browser = webflow.launch(p, headless=not args.headed)
        if browser is None:
            sys.exit("No Chrome or Chromium that Playwright can start.")
        try:
            run(base, browser, log)
        finally:
            browser.close()
    if args.json:
        args.json.write_text(json.dumps(log.steps, indent=2))


if __name__ == "__main__":
    main()
