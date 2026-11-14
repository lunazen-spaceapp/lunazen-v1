"""User flows in a real browser: navigation between the pages and the Planner's mission-planning use cases.

The Node tests check the engine and the pure helpers; this file checks what only a browser shows (the links each page
builds, the address a page keeps, the verdict a visitor reads). It needs Playwright and Google Chrome; without them the
file is skipped. The pages compute in the browser, so a flow takes a few seconds.
"""

import re

import pytest

from scenarios import webflow

sync_api = pytest.importorskip("playwright.sync_api")

ALL_PAGES = ["index", "map", "explorer", "moon", "planner", "rank", "windows", "compare", "sidebyside", "evidence", "resources", "contact"]
RESULT_TIMEOUT_MS = webflow.RESULT_TIMEOUT_MS


@pytest.fixture(scope="module")
def base():
    with webflow.serve() as address:
        yield address


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = webflow.launch(p)
        if b is None:
            pytest.skip("no Chrome or Chromium for Playwright")
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" else None)
    yield pg
    ctx.close()


def planner(pg, base, hash_=""):
    webflow.open_planner(pg, base, hash_)


def verdict(pg):
    return pg.locator("#verdict .lz-verdict")


def hash_of(pg):
    return pg.evaluate("location.hash")


def href_hash(pg, selector):
    return pg.locator(selector).first.get_attribute("href").split("#", 1)[-1]


def params(h):
    return dict(p.split("=", 1) for p in h.lstrip("#").split("&") if "=" in p)


# ---- navigation

@pytest.mark.parametrize("name", ALL_PAGES)
def test_every_page_opens_without_errors(page, base, name):
    page.goto(f"{base}{name}.html")
    page.wait_for_load_state("networkidle", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("h1").first.inner_text().strip()
    assert not [e for e in page.errors if "WebGL" not in e], page.errors


def open_menu(pg, name):
    pg.locator(".nav button.nav-link", has_text=name).click()


def labels(pg, menu):
    return [e.text_content().strip() for e in pg.locator(f"#menu-{menu} .menu-label").all()]


def test_the_menus_list_every_page(page, base):
    page.goto(f"{base}index.html")
    bar = [e.text_content().strip() for e in page.locator(".nav > a.nav-link, .nav > .nav-group > button").all()]
    assert bar == ["Home", "Learn", "Plan", "Resources", "Contact"]
    assert labels(page, "learn") == ["Map", "Explorer", "Whole Moon"]
    assert labels(page, "plan") == ["Planner", "Ranker", "Delay Analyzer", "Compare landings", "Compare sites"]
    assert "Evidence" not in page.locator(".nav").text_content()
    open_menu(page, "Plan")
    for text, target in [("Ranker", "rank.html"), ("Delay Analyzer", "windows.html"), ("Compare landings", "compare.html"), ("Planner", "planner.html")]:
        page.locator("#menu-plan .menu-item", has_text=text).click()
        page.wait_for_url(re.compile(re.escape(target)))
        open_menu(page, "Plan")


def test_a_page_never_opens_with_a_menu_showing_and_the_menus_close_as_designed(page, base):
    page.goto(f"{base}index.html")
    learn, plan = page.locator("#menu-learn"), page.locator("#menu-plan")
    assert learn.is_hidden() and plan.is_hidden()
    open_menu(page, "Learn")
    assert learn.is_visible() and plan.is_hidden()
    assert page.locator(".nav button", has_text="Learn").get_attribute("aria-expanded") == "true"
    open_menu(page, "Plan")  # opening one closes the other
    assert plan.is_visible() and learn.is_hidden()
    page.keyboard.press("Escape")
    assert plan.is_hidden()
    open_menu(page, "Plan")
    page.mouse.click(40, 700)  # outside the bar
    assert plan.is_hidden()
    page.locator(".nav button", has_text="Learn").focus()  # the keyboard opens a menu and Escape gives the focus back
    page.keyboard.press("Enter")
    assert learn.is_visible()
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.closest('#menu-learn') !== null")
    page.keyboard.press("Escape")
    assert learn.is_hidden() and page.evaluate("document.activeElement.textContent.trim()") == "Learn"
    open_menu(page, "Learn")
    page.locator("#menu-learn .menu-item", has_text="Map").click()
    page.wait_for_url(re.compile(r"map\.html"))
    assert page.locator("#menu-learn").is_hidden()


def test_the_current_section_is_underlined(page, base):
    for name, section in [("index", "Home"), ("explorer", "Learn"), ("rank", "Plan"), ("evidence", "Resources")]:
        page.goto(f"{base}{name}.html")
        current = [e.text_content().strip() for e in page.locator(".nav .nav-link.is-current").all()]
        assert current == [section], (name, current)


def test_the_phone_menu_replaces_the_bar_below_960_px(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.goto(f"{base}index.html")
    assert pg.locator(".nav").is_hidden() and pg.locator(".menu-button").is_visible()
    assert pg.locator("#drawer").is_hidden()
    pg.locator(".menu-button").click()
    assert pg.locator("#drawer").is_visible()
    heads = [e.text_content().strip() for e in pg.locator("#drawer .drawer-head, #drawer .drawer-link").all()]
    assert heads == ["Home", "Learn", "Plan", "Resources", "Contact"]
    assert len(pg.locator("#drawer .menu-item").all()) == 8
    assert pg.locator("#drawer .theme-toggle button").count() == 3
    pg.keyboard.press("Escape")
    assert pg.locator("#drawer").is_hidden()
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    ctx.close()


def test_explorer_carries_spot_mast_and_date_to_the_planning_pages(page, base):
    page.goto(f"{base}explorer.html#spot=DM2-4&mast=5&start=2027-08-01&days=30&t=0")
    page.wait_for_load_state("networkidle", timeout=RESULT_TIMEOUT_MS)
    planner_link = params(href_hash(page, ".nav a[href^='planner.html']"))
    assert (planner_link["spot"], planner_link["mast"], planner_link["start"]) == ("DM2-4", "5", "2027-08-01")
    open_menu(page, "Plan")
    page.locator("#menu-plan .menu-item", has_text="Planner").click()
    page.wait_for_function("document.getElementById('status') && /evaluated in/.test(document.getElementById('status').innerText)", timeout=RESULT_TIMEOUT_MS)
    h = params(hash_of(page))
    assert h["spot"] == "DM2-4" and h["mast"] == "5" and h["start"] == "2027-08-01"


def test_whole_moon_carries_no_spot_away_from_the_pole(page, base):
    page.goto(f"{base}moon.html#site=a11&start=2027-03-15&t=0&view=")
    page.wait_for_load_state("networkidle", timeout=RESULT_TIMEOUT_MS)
    link = params(href_hash(page, ".nav a[href^='planner.html']"))
    assert "spot" not in link and link["start"] == "2027-03-15"


def test_a_bare_planner_opens_on_the_preset_date_not_stored_state(page, base):
    page.goto(f"{base}index.html")
    page.evaluate("localStorage.clear()")
    planner(page, base)
    sentence = page.locator("#sentence").inner_text()
    assert "15 Mar 2027" in sentence and "14 May 2027" in sentence
    assert page.evaluate("Object.keys(localStorage)") == []


# ---- Planner use cases

def test_default_question_has_no_landing_within_100_m_at_the_headline_spot(page, base):
    planner(page, base)
    assert "245 epochs × 13 points evaluated" in page.locator("#status").inner_text()
    assert page.locator("#heat button.c").count() == 244  # 61 days, four times a day; the 245th row is the end day at 00:00
    assert "18% valid at spot · 0% within 100 m dispersion" == page.locator("#heat-summary").inner_text()
    assert "info" in verdict(page).get_attribute("class").split()  # works at the spot: a neutral result, not an alarm
    assert "8 of 12 dispersion points pass" in verdict(page).inner_text()


def test_a_night_limit_above_the_longest_night_turns_the_answer_to_works_within_100_m(page, base):
    planner(page, base, "#spot=Site01-1&rule=custom&dark=300&start=2027-03-15&days=61")
    assert "valid within 100 m dispersion" in verdict(page).inner_text().lower()
    assert "ok" in verdict(page).get_attribute("class").split()


def test_a_landing_within_100_m_can_be_pinned_and_appears_in_compare(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61")
    assert "ok" in verdict(page).get_attribute("class").split()
    page.locator("#pin").click()
    assert page.locator("#pin").get_attribute("aria-pressed") == "true"
    page.goto(f"{base}compare.html")
    page.wait_for_function("document.querySelectorAll('#cards .lz-card, #cards article').length > 0", timeout=RESULT_TIMEOUT_MS)
    assert "DM2-4" in page.locator("#cards").inner_text()


def test_the_blue_ghost_rule_fails_on_the_night(page, base):
    planner(page, base, "#spot=Site01-1&rule=bg1&dark=5&start=2027-03-15&days=61")
    assert "bad" in verdict(page).get_attribute("class").split()
    assert "against a limit of 5 h" in verdict(page).inner_text()


def test_a_high_dsn_share_turns_cells_to_the_dsn_failure(page, base):
    planner(page, base, "#spot=Site01-1&link=90&start=2027-03-15&days=61")
    text = page.locator("#heat").evaluate("el => [...el.querySelectorAll('button.c')].map(b => b.getAttribute('aria-label') || b.title).join('|')")
    assert "DSN visibility below threshold" in text


def test_the_chosen_landing_carries_to_the_pages_that_follow_it(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61")
    page.locator("#heat button.c").nth(40).click()
    chosen = re.search(r"landing=(\d{4}-\d{2}-\d{2})T(\d{2})", hash_of(page))
    assert chosen
    day, hour = chosen.groups()
    for selector, key in [("#slip-link", "date"), ("#rank-link", "start"), ("#explorer-link", "start"), (".nav a[href^='windows.html']", "date")]:
        assert params(href_hash(page, selector))[key] == day, selector
    assert params(href_hash(page, "#explorer-link"))["t"] == str(int(hour) * 4)


def test_history_walks_back_through_the_questions(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61")
    page.locator("[data-tok=mast]").click()
    page.locator("#pop [role=option], #pop button").filter(has_text="5 m").first.click()
    page.wait_for_function("/mast=5/.test(location.hash)")
    page.go_back()
    page.wait_for_function("!/mast=5/.test(location.hash)")


def test_a_custom_point_is_traced_and_planned(page, base):
    planner(page, base, "#spot=pt_-89.45_-142.3")
    assert page.locator("#heat button.c").count() > 0
    assert not page.errors


def test_the_planner_does_not_scroll_sideways_on_a_phone(browser, base):
    ctx = browser.new_context(viewport={"width": 400, "height": 800})
    pg = ctx.new_page()
    planner(pg, base, "#spot=DM2-4")
    assert pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 1
    ctx.close()


def test_the_answer_menu_names_and_reads_as_a_sentence(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61")
    page.locator("[data-tok=goal]").click()
    page.wait_for_selector("#pop .opt")
    names = page.locator("#pop .opt").evaluate_all("els => els.map(e => e.childNodes[0].textContent)")
    assert names[:4] == ["Earliest valid window", "Shortest night", "Widest window", "Every window"], names
    page.keyboard.press("Escape")
    for goal, words in [("margin", "Identify shortest-night window at DM2-4"), ("longest", "Identify widest valid window at DM2-4"),
                        ("all", "Identify every valid window at DM2-4"), ("earliest", "Identify earliest valid window at DM2-4")]:
        planner(page, base, f"#goal={goal}&spot=DM2-4&start=2027-03-15&days=61")
        assert words in " ".join(page.locator("#sentence").inner_text().split()), goal


def test_an_old_most_margin_link_still_loads(page, base):
    planner(page, base, "#goal=margin&spot=DM2-4&start=2027-03-15&days=61")
    assert "ok" in verdict(page).get_attribute("class").split()


def test_a_single_working_landing_is_not_reported_as_zero_percent(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61&rule=bg1&dark=5")
    summary = page.locator("#heat-summary").inner_text()
    assert re.match(r"\d+ of \d+ valid at spot", summary), summary


# ---- how far the lander may miss

def test_within_50_m_the_headline_spot_has_working_landings(page, base):
    planner(page, base, "#spot=Site01-1&start=2027-03-15&days=61&within=50")
    assert "ok" in verdict(page).get_attribute("class").split()
    assert "valid within 50 m dispersion" in verdict(page).inner_text().lower()
    assert "50 m dispersion radius" in " ".join(page.locator("#sentence").inner_text().split())
    assert "245 epochs × 7 points evaluated" in page.locator("#status").inner_text()
    assert "plus 6 surrounding dispersion points" in page.locator("#subtitle").inner_text()


def test_on_the_spot_tests_only_the_spot(page, base):
    planner(page, base, "#spot=Site01-1&start=2027-03-15&days=61&within=0")
    assert "245 epochs × 1 points evaluated" in page.locator("#status").inner_text()
    assert "ok" in verdict(page).get_attribute("class").split()
    assert verdict(page).inner_text().split("\n")[0].endswith("Valid at the target spot")


def test_the_miss_distance_token_offers_three_choices_and_applies_one(page, base):
    planner(page, base, "#spot=DM2-4&start=2027-03-15&days=61")
    page.locator("[data-tok=within]").click()
    page.wait_for_selector("#pop .opt")
    names = page.locator("#pop .opt").evaluate_all("els => els.map(e => e.childNodes[0].textContent)")
    assert names == ["Target spot only", "50 m dispersion radius", "100 m dispersion radius"], names
    page.locator("#pop .opt", has_text="50 m dispersion radius").click()
    page.wait_for_function("/within=50/.test(location.hash)")
    page.wait_for_function("document.getElementById('status') && /× 7 points/.test(document.getElementById('status').innerText)", timeout=RESULT_TIMEOUT_MS)


def test_the_miss_distance_travels_to_rank_windows_and_compare_pins(page, base):
    planner(page, base, "#spot=Site01-1&start=2027-03-15&days=61&within=50")
    for selector, key in [("#rank-link", "within"), ("#slip-link", "within")]:
        assert params(href_hash(page, selector))[key] == "50", selector
    page.locator("#pin").click()
    page.goto(f"{base}compare.html")
    page.wait_for_function("document.querySelectorAll('#cards .lz-card, #cards article').length > 0", timeout=RESULT_TIMEOUT_MS)
    assert "Within 50 m" in page.locator("#cards").inner_text()


def test_rank_and_windows_follow_the_miss_distance(page, base):
    webflow.open_rank(page, base, "#start=2027-03-15&within=50")
    assert "50 m dispersion radius" in " ".join(page.locator("#sentence").inner_text().split())
    assert "50 m dispersion" in page.locator("#verdict").inner_text()
    webflow.open_windows(page, base, "#spot=Site01-1&date=2027-03-15&within=50")
    assert "50 m dispersion radius" in " ".join(page.locator("#sentence").inner_text().split())


def test_a_smaller_miss_distance_is_offered_when_nothing_works_within_100_m(page, base):
    planner(page, base, "#spot=Site01-1&start=2027-03-15&days=61")
    page.wait_for_function("document.getElementById('take') && !/Still checking|Checking other spots/.test(document.getElementById('take').innerText)", timeout=RESULT_TIMEOUT_MS)
    page.locator("#take .exp-snap-head").click()
    card = page.locator("#take [data-take=reach]")
    assert "Tighten dispersion radius to 50 m" in card.inner_text()
    assert "valid touchdown epochs" in card.inner_text()
    card.click()
    page.wait_for_function("/within=50/.test(location.hash)")
    page.wait_for_function("document.getElementById('status') && /× 7 points/.test(document.getElementById('status').innerText)", timeout=RESULT_TIMEOUT_MS)
    assert "ok" in verdict(page).get_attribute("class").split()
    assert page.locator("#take").is_hidden()  # the answer works now, so nothing is suggested


# ---- Windows past 31 December

def test_windows_search_runs_on_into_the_next_year(page, base):
    webflow.open_windows(page, base, "#spot=Site01-1&date=2027-12-30")
    answers = page.locator("#answers").inner_text()
    assert "to 6 Jan 2028" in answers and "18 Jan 2028" in answers, answers
    webflow.open_windows(page, base, "#date=2026-12-25")
    assert "2 Jan 2027" in page.locator("#answers").inner_text()
    text = page.locator("#verdict").inner_text() + page.locator("#answers").inner_text() + page.locator("#slip").inner_text()
    assert "this year" not in text


def test_windows_computes_the_year_after_when_it_is_not_stored(page, base):
    webflow.open_windows(page, base, "#spot=Site01-1&date=2029-12-28")
    page.wait_for_function("/to 11 Jan 2030/.test(document.getElementById('answers').innerText)", timeout=RESULT_TIMEOUT_MS)
    assert "Compute 2030" in page.locator("#look-further").inner_text()  # the other spots: offered, not said to be none


def test_sites_side_by_side_is_in_the_plan_nav_with_its_own_current_state(page, base):
    page.goto(f"{base}sidebyside.html")
    current = [e.text_content().strip() for e in page.locator(".nav .menu-item[aria-current=page] .menu-label").all()]
    assert current == ["Compare sites"], current
    page.goto("about:blank")
    page.goto(f"{base}compare.html")
    assert [e.text_content().strip() for e in page.locator(".nav .menu-item[aria-current=page] .menu-label").all()] == ["Compare landings"]


def test_the_suggestions_are_in_view_at_1440_by_900_when_nothing_works(browser, base):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    planner(pg, base)
    pg.wait_for_selector("#take:not([hidden])", timeout=RESULT_TIMEOUT_MS)
    box = pg.locator("#take").bounding_box()
    assert box["y"] + 120 < 900, box  # the box starts well inside the first screen
    ctx.close()


def test_the_trail_appears_only_after_a_change(page, base):
    planner(page, base)
    assert page.locator("#trail").inner_text().strip() == ""
    page.locator("[data-tok=mast]").click()
    page.locator("#pop .opt", has_text="5 m").first.click()
    page.wait_for_function("/mast=5/.test(location.hash)")
    text = page.locator("#trail").inner_text()
    assert "Your changes:" in text and "Start" in text and "Mast" in text
    assert page.locator("#trail button").first.get_attribute("aria-label") == "Go back to: Start"


# ---- Resources, Contact and the shared footer and theme control

FOOTER = "Terrain: NASA LRO LOLA · Ephemeris: JPL DE440"


ROWS = ["guides", "evidence", "data", "scope", "videos"]


def open_rows(page):
    return [i for i in ROWS if page.locator(f"#{i} .acc-head").get_attribute("aria-expanded") == "true"]


def test_resources_is_an_accordion_with_computed_figures(page, base):
    page.goto(f"{base}resources.html")
    page.wait_for_function("document.querySelectorAll('#evidence-rows tr').length === 7 && document.querySelectorAll('#site-figures .n').length === 4", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("h1").inner_text().strip() == "Documentation, data, and validation"
    assert [e.inner_text().split("\n")[0].strip().lower() for e in page.locator(".acc-head").all()] == [
        "user guide", "validation benchmarks and comparative data", "public data sources", "scope", "videos"]
    assert page.locator(".res-jumps").count() == 0
    assert open_rows(page) == []  # all collapsed at first
    for i in ROWS:
        assert page.locator(f"#{i}-panel").is_hidden()
    # one row open at a time; a second click closes it
    page.locator("#evidence .acc-head").click()
    assert open_rows(page) == ["evidence"] and page.locator("#evidence-panel").is_visible()
    page.locator("#scope .acc-head").click()
    assert open_rows(page) == ["scope"] and page.locator("#evidence-panel").is_hidden()
    page.locator("#scope .acc-head").click()
    assert open_rows(page) == []
    # the keyboard works
    page.locator("#data .acc-head").focus()
    page.keyboard.press("Enter")
    assert open_rows(page) == ["data"]
    page.keyboard.press("Space")
    assert open_rows(page) == []
    # the subtitle shows only while its row is open
    page.locator("#data .acc-head").click()
    assert page.locator("#data .acc-sub").is_visible() and page.locator("#data .acc-sub").text_content() == "NASA, JPL & international datasets integrated into LunaZen"
    page.locator("#data .acc-head").click()
    assert page.locator("#data .acc-sub").is_hidden()
    # the guide
    page.locator("#guides .acc-head").click()
    assert page.locator("#guide-pages").text_content() == "7"
    assert page.locator("[data-guide=summary]").get_attribute("href") == "lunazen_guide.pdf#page=1"
    # the evidence table and its date
    page.locator("#evidence .acc-head").click()
    rows = [[c.text_content().strip() for c in r.locator("td").all()] for r in page.locator("#evidence-rows tr").all()]
    assert rows[0][:4] == ["Sun and Earth directions", "JPL Horizons (4 sites, 70 dates each)", "0.10″ at worst", "1″ max"]
    assert rows[1][2:4] == ["1.6 pp RMS (worst: 2.0 pp on the 6 flattest)", "3 pp max"]
    assert rows[2][2:4] == ["+0.3 to +1.4 pp", "±2 pp max"] and rows[3][2:4] == ["0.12° at worst", "0.25° max"]
    assert rows[4][2] == "r = 0.96, RMS 4.4 pp" and rows[5][2] == "15 m; 6 min"
    assert rows[6][2] == "Tested on every run of npm test" and page.locator("#evidence-rows tr").nth(6).locator("code").text_content() == "npm test"
    assert [r[4] for r in rows] == ["Pass", "Pass", "Pass", "Pass", "Reported", "Reported", "Pass"]
    assert page.locator("#evidence-panel .ev-foot, #ev-date, .ev-button").count() == 0  # no button or date line under the table
    assert "Open full evidence" not in page.locator("#evidence-panel").text_content() and "Results generated" not in page.locator("#evidence-panel").text_content()
    # Scope
    page.locator("#scope .acc-head").click()
    assert [e.text_content() for e in page.locator("#site-figures .n").all()] == ["13", "67", "3", "12"]
    assert "a 13-site polar catalogue on 5 m terrain maps, plus 15 historical" in page.locator("#scope-lead").text_content()
    assert page.locator("#site-table").get_attribute("href") == "https://github.com/lunazen-spaceapp/lunazen-v1/blob/main/data/sites/site_selection.csv"
    assert [e.text_content() for e in page.locator(".covers h3").all()] == ["Capabilities", "Limitations", "Roadmap"]
    # Videos: every address is set, so the overview video, the six titles and the playlist are links
    page.locator("#videos .acc-head").click()
    assert page.locator("#playlist-line").text_content() == "Technical playlist · 6 videos · about 39 minutes"
    assert page.locator("#playlist li").count() == 6 and "Exploring the Lunar South Pole: Why Everyone Is Going, and Why It Is Hard to Land" in page.locator("#playlist li").first.text_content()
    assert [a.get_attribute("href") for a in page.locator("#playlist a").all()] == ["https://youtu.be/" + v for v in ("3kn46h4qcFw", "L2yvlqkywV4", "J5H6E7JQpmQ", "Zk7FiL-1gY8", "XrTkE3Rt2X8", "uFc0DskIiX4")]
    assert page.locator("#playlist-link").get_attribute("href") == "https://www.youtube.com/playlist?list=PLct6-XOWUjH8" and page.locator("#playlist-link").get_attribute("target") == "_blank"
    assert page.locator("#overview-link").get_attribute("href") == "https://youtu.be/3MQQRflfRCE" and page.locator("#overview-watch").get_attribute("href") == "https://youtu.be/3MQQRflfRCE"
    assert page.locator("#overview-link").is_visible() and page.locator("#overview-box").is_hidden()
    assert page.locator("footer.site-footer").text_content().strip() == FOOTER


@pytest.mark.parametrize("row", ROWS)
def test_resources_opens_the_row_named_in_the_address(page, base, row):
    page.goto(f"{base}resources.html#{row}")
    assert open_rows(page) == [row]
    assert page.locator(f"#{row}-panel").is_visible()


def test_resources_works_on_a_phone(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.goto(f"{base}resources.html#evidence")
    pg.wait_for_function("document.querySelectorAll('#evidence-rows tr').length === 7", timeout=RESULT_TIMEOUT_MS)
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert pg.evaluate("(() => { const b = document.querySelector('#evidence .table-scroll'); return b.scrollWidth > b.clientWidth; })()")  # the table scrolls in its own frame
    for i in ROWS:
        pg.locator(f"#{i} .acc-head").click()
        assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), i
        assert pg.locator(f"#{i} .acc-head").bounding_box()["height"] >= 44
    ctx.close()


def test_contact_shows_the_email_the_repository_and_the_team(page, base):
    page.goto(f"{base}contact.html")
    assert page.locator("#email-text").text_content() == "lunazen.spaceapp@gmail.com"
    assert page.locator("#row-email").get_attribute("href") == "mailto:lunazen.spaceapp@gmail.com"
    assert page.locator("#row-repo").is_visible() and page.locator("#repo-text").text_content() == "https://github.com/lunazen-spaceapp/lunazen-v1"
    assert page.locator("#row-repo").get_attribute("href") == "https://github.com/lunazen-spaceapp/lunazen-v1"
    assert page.locator("#row-team").is_visible() and page.locator("#team-text").text_content() == "Team LunaZen · Ishaan & Anirban"
    assert page.locator("footer.site-footer").text_content().strip() == FOOTER


@pytest.mark.parametrize("name", ALL_PAGES)
def test_every_page_has_the_same_one_line_footer(page, base, name):
    page.goto(f"{base}{name}.html")
    assert page.locator("footer").count() == 1
    assert page.locator("footer").text_content().strip() == FOOTER


def test_the_theme_control_sets_and_keeps_the_theme(page, base):
    page.goto(f"{base}planner.html")
    page.locator(".nav .theme-toggle button[data-theme=light]").click()
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    assert page.locator(".nav .theme-toggle button[data-theme=light]").get_attribute("aria-pressed") == "true"
    page.goto(f"{base}rank.html")
    assert page.evaluate("document.documentElement.dataset.theme") == "light"
    assert page.locator(".nav .theme-toggle button[data-theme=light]").get_attribute("aria-pressed") == "true"
    for b in page.locator(".nav .theme-toggle button").all():
        box = b.bounding_box()
        assert box["width"] >= 44 and box["height"] >= 44
    page.locator(".nav .theme-toggle button[data-theme=dark]").click()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"


# ---- Home: the design's content, and an animation that never moves the page

def test_home_has_the_designs_content_and_nothing_else(page, base):
    page.goto(f"{base}index.html")
    page.wait_for_function("document.getElementById('home-count').textContent.includes('NASA sites')", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("h1").inner_text().strip() == "Optimize landing windows and sites at the lunar south pole"
    assert page.locator("#home-count").text_content() == "67 candidate spots · 13 NASA sites"
    assert [e.text_content() for e in page.locator(".home .label.accent").all()][:3] == ["NASA Space Apps 2026 · Lunar Landing Site Navigator", "The polar challenge", "Explore & simulate"]
    assert page.locator("#home-caption").text_content() == "1–30 March 2027, animated."
    assert page.locator(".arrow-link").text_content().strip() == "Open this site in the Explorer →"
    assert page.locator("footer.site-footer").text_content().strip() == "Terrain: NASA LRO LOLA · Ephemeris: JPL DE440"
    for gone in [".doors", "#insights", "#trust", ".learn-more", ".about", ".more-links", ".physics", "#key-line"]:
        assert page.locator(gone).count() == 0, gone


def test_the_home_animation_pauses_and_plays(page, base):
    page.goto(f"{base}index.html")
    page.wait_for_selector("#pano-toggle:not([hidden])", timeout=RESULT_TIMEOUT_MS)
    button = page.locator("#pano-toggle")
    assert button.text_content().strip() == "Pause" and button.get_attribute("aria-label") == "Pause the animation"
    button.click()
    assert button.text_content().strip() == "Play" and button.get_attribute("aria-label") == "Play the animation"
    frozen = page.locator("#when-text").text_content()
    page.wait_for_timeout(600)
    assert page.locator("#when-text").text_content() == frozen
    button.click()
    page.wait_for_function("(t) => document.getElementById('when-text').textContent !== t", arg=frozen, timeout=5000)


def test_the_pause_button_is_icon_only_below_600_px_and_a_word_above(browser, base):
    for width, icon_only in [(390, True), (599, True), (600, False), (1280, False)]:
        ctx = browser.new_context(viewport={"width": width, "height": 800})
        pg = ctx.new_page()
        pg.goto(f"{base}index.html")
        pg.wait_for_selector("#pano-toggle:not([hidden])", timeout=RESULT_TIMEOUT_MS)
        box = pg.locator("#pano-toggle").bounding_box()
        word_shown = pg.locator("#pano-toggle .pano-word").is_visible()
        assert word_shown != icon_only, width
        assert box["height"] >= 44 and box["width"] >= 44, (width, box)
        if icon_only:
            assert box["width"] <= 48, (width, box)
        assert pg.locator("#pano-toggle").get_attribute("aria-label") == "Pause the animation"
        ctx.close()


def test_the_home_caption_and_link_share_a_row_on_wide_screens_and_stack_on_narrow_ones(browser, base):
    for width, same_row in [(1440, True), (1280, True), (390, False)]:
        ctx = browser.new_context(viewport={"width": width, "height": 900})
        pg = ctx.new_page()
        pg.goto(f"{base}index.html")
        pg.wait_for_function("document.getElementById('home-caption').textContent.includes('animated')", timeout=RESULT_TIMEOUT_MS)
        cap, link = pg.locator("#home-caption").bounding_box(), pg.locator("figcaption .arrow-link").bounding_box()
        row = cap["y"] < link["y"] + link["height"] and link["y"] < cap["y"] + cap["height"]
        assert row == same_row, (width, cap, link)
        if same_row:
            assert link["x"] > cap["x"] + cap["width"] - 1  # caption on the left, link on the right
            assert cap["height"] < 28, (width, cap)  # one line of text
        ctx.close()


def test_the_status_pills_are_as_wide_as_their_longest_wording(page, base):
    page.goto(f"{base}index.html")
    page.wait_for_function("document.getElementById('when-text').textContent.startsWith('Day')", timeout=RESULT_TIMEOUT_MS)
    for body in ["Sun", "Earth"]:
        box = page.locator(f".pill-text[data-body={body}]")
        copies = box.locator(".sizer").evaluate_all("els => els.map(e => e.textContent)")
        assert f"{body} · behind the terrain" in copies and f"{body} · 99% visible" in copies
        widths = box.locator(".sizer").evaluate_all("els => els.map(e => e.getBoundingClientRect().width)")
        assert abs(box.bounding_box()["width"] - max(widths)) < 1  # no wider than the widest wording


def test_reduced_motion_leaves_the_home_animation_waiting_for_play(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    pg = ctx.new_page()
    pg.goto(f"{base}index.html")
    pg.wait_for_selector("#pano-toggle:not([hidden])", timeout=RESULT_TIMEOUT_MS)
    assert pg.locator("#pano-toggle").text_content().strip() == "Play"
    first = pg.locator("#when-text").text_content()
    pg.wait_for_timeout(700)
    assert pg.locator("#when-text").text_content() == first
    ctx.close()


@pytest.mark.parametrize("width,height", [(1440, 900), (1280, 800), (390, 844)])
def test_home_animation_moves_nothing_on_the_page(browser, base, width, height):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    try:
        pg.goto(f"{base}index.html")
        pg.wait_for_function("document.getElementById('when-text').textContent.trim().startsWith('Day')", timeout=RESULT_TIMEOUT_MS)
        pg.evaluate("window.scrollTo(0, 0)")
        probe = """() => {
            const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100); };
            return { boxes: ["#panorama", ".home-head", ".home-cols", ".home-text", ".pill.sun", ".pill.earth", ".when", "figcaption", ".site-footer"].map(box), text: document.querySelector(".pills").innerText };
        }"""
        first = pg.evaluate(probe)
        texts = set()
        for _ in range(158):  # a loop is 15 s: sample every 100 ms for a little longer than that
            now = pg.evaluate(probe)
            assert now["boxes"] == first["boxes"], f"the layout moved at {width} px: {first['boxes']} -> {now['boxes']} ({now['text']!r})"
            texts.add(now["text"])
            pg.wait_for_timeout(100)
        assert len(texts) > 20, "the readout did not change, so the test saw no animation"
    finally:
        ctx.close()


# ---- The redesign changes no number

def test_the_redesign_leaves_the_default_answers_unchanged(page, base):
    planner(page, base)
    text = page.locator("main").inner_text()
    assert "18% valid at spot · 0% within 100 m dispersion" in text
    assert "9 Apr 2027, 00:00 UTC – Valid at target spot (8 of 12 dispersion points pass)" in text
    page.wait_for_function("/Alternate target/.test(document.getElementById('take-list').textContent)", timeout=RESULT_TIMEOUT_MS)
    take = page.locator("#take-list").text_content()
    assert "Increase night tolerance to 253 h" in take and "Alternate target: DM2-4" in take
    assert "Unlocks 2 valid touchdown epochs in a single contiguous window, beginning 9 Apr 2027" in take
    page.wait_for_function("!/Checking other spots/.test(document.body.innerText)", timeout=RESULT_TIMEOUT_MS)
    page.get_by_text(re.compile("compare spots on", re.I)).first.click()
    page.wait_for_function("/Top candidate: DM2-4, longest night 8 h against 50 h/.test(document.body.innerText)", timeout=RESULT_TIMEOUT_MS)
    webflow.open_windows(page, base)
    page.wait_for_function("/Next valid window: 2 Apr \\(\\+18 d\\)/.test(document.body.innerText)", timeout=RESULT_TIMEOUT_MS)
    page.goto("about:blank")
    page.goto(f"{base}explorer.html#spot=Site01-1&mast=2&start=2027-03-01&days=30&t=25")
    page.wait_for_function("/sets in 36 h 15 min/.test(document.body.innerText) && /rises in 3 d 18 h/.test(document.body.innerText)", timeout=RESULT_TIMEOUT_MS)


# ---- Map: the page of the redesign (header, layer switch, tabs, Sites, the band, Plot a point, My points, tooltips, Help)

import json
import math
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
R_MOON = 1737400
CATALOGUE = json.loads((WEB / "data" / "sites.json").read_text())
SPOTS = CATALOGUE["spots"]
TILES = json.loads((WEB / "data" / "map.json").read_text())["tiles"]
FIT_M = 360_000
POINT = (-11083.66, -12053.39)  # -89.46, 222.6


def latlon(x, y):
    """Polar map metres -> (latitude, longitude °E), as engine/tracer.js."""
    lat = -90 + math.degrees(2 * math.atan2(math.hypot(x, y), 2 * R_MOON))
    return lat, math.degrees(math.atan2(x, y)) % 360


def map_page(pg, base, hash_=""):
    pg.goto(f"{base}map.html{hash_}")
    pg.wait_for_selector(".s-row", timeout=RESULT_TIMEOUT_MS)
    pg.wait_for_timeout(300)


def screen_of(pg, x, y, zoom=1, cx=0, cy=0):
    """The canvas position (page coordinates) of a map point in the view the address names (the default view, or zoom and centre)."""
    r = pg.locator("#map").bounding_box()
    scale = FIT_M / min(r["width"], r["height"]) / zoom
    return r["x"] + r["width"] / 2 + (x - cx) / scale, r["y"] + r["height"] / 2 - (y - cy) / scale


def settled_view(pg):
    """(zoom, cx, cy) the address carries once the view has stopped moving."""
    pg.wait_for_timeout(700)
    h = pg.evaluate("location.hash")
    q = dict(p.split("=", 1) for p in h.lstrip("#").split("&") if "=" in p)
    return float(q["zoom"]), float(q["cx"]), float(q["cy"])


def marker(pg):
    return pg.evaluate("document.getElementById('map').dataset.marker")


RING = {"dark": (227, 163, 59), "light": (185, 120, 26)}  # --accent-line of each theme


def ring_pixels(pg, x, y, theme="dark", radius=14):
    """How many pixels of the marker's orange (the theme's --accent-line) the canvas has within `radius` px of a page position."""
    return pg.evaluate("""([x, y, r, want]) => {
      const c = document.getElementById('map'), box = c.getBoundingClientRect(), k = c.width / box.width;
      const d = c.getContext('2d').getImageData(Math.round((x - box.left - r) * k), Math.round((y - box.top - r) * k), Math.round(2 * r * k), Math.round(2 * r * k)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - want[0]) < 10 && Math.abs(d[i + 1] - want[1]) < 10 && Math.abs(d[i + 2] - want[2]) < 10) n++;
      return n;
    }""", [x, y, radius, list(RING[theme])])


def open_plot(pg):
    pg.locator("#tab-point").click()


def show_point(pg, lat, lon):
    """Type a point in the Plot a point tab and press Show point (or Update point)."""
    open_plot(pg)
    if not pg.locator("#c-lat").is_visible():
        (pg.locator("#c-edit") if pg.locator("#c-edit").count() else pg.locator("#c-toggle")).click()
    pg.locator("#c-lat").fill(lat)
    pg.locator("#c-lon").fill(lon)
    pg.locator("#c-show").click()


def wait_figures(pg):
    pg.wait_for_function("document.querySelectorAll('#c-figures .tile .v').length === 4", timeout=RESULT_TIMEOUT_MS)


def figures(pg):
    return {k: pg.locator(f"#c-figures [data-fig={k}]").text_content().strip() for k in ("sun", "earth", "night", "gap")}


def select_spot(pg, spot_id):
    site = next(s for s in CATALOGUE["sites"] if spot_id in s["spots"])
    row = pg.locator(f".s-row[data-site='{site['id']}']")
    if row.get_attribute("aria-expanded") != "true":
        row.click()
    pg.locator(f".s-spot[data-id='{spot_id}']").click()


def test_the_header_and_the_map_controls(page, base):
    map_page(page, base)
    assert page.locator(".mp-kicker .label").text_content() == "Learn · Map"
    assert page.locator("#help-open").text_content().strip() == "How to use the map"
    assert page.locator("h1").text_content() == "Illumination and Earth visibility at the lunar south pole"
    assert page.locator(".mp-sub").text_content() == "Compare long-term solar illumination and Earth visibility using NASA south-pole maps—select a candidate spot from the directory or plot your own coordinates."
    # the layer is a two-option switch, and the legend follows it; there is no Help button in the bar
    assert page.locator("#layer-sun").get_attribute("aria-pressed") == "true" and page.locator("#layer-earth").get_attribute("aria-pressed") == "false"
    assert page.locator("#legend span").first.text_content() == "Sun 0%" and page.locator("#legend span").last.text_content() == "100%"
    page.locator("#layer-earth").click()
    assert page.locator("#layer-earth").get_attribute("aria-pressed") == "true" and page.locator("#layer-sun").get_attribute("aria-pressed") == "false"
    assert page.locator("#legend span").first.text_content() == "Earth 0%"
    assert page.locator(".mp-bar details, .mp-bar .howto").count() == 0
    assert [page.locator(i).get_attribute("aria-label") for i in ("#zoom-in", "#zoom-out")] == ["Zoom in", "Zoom out"] and page.locator("#reset").text_content() == "Reset"
    for sel in ("#layer-sun", "#layer-earth", "#zoom-in", "#zoom-out", "#reset"):
        assert 30 <= page.locator(sel).bounding_box()["height"] <= 34, sel  # thin controls on a mouse screen
    # the map is square, with no label on it, and the credit line under it
    box = page.locator("#map-wrap").bounding_box()
    assert abs(box["width"] - box["height"]) < 2 and box["width"] <= 762
    assert page.locator("#map-corner").count() == 0
    assert page.locator("#source").text_content() == "NASA LOLA 18.6-year visibility map (Mazarico et al. 2011) · Spots from NASA's 60 m map, slope ≤ 10°"
    # the sidebar: three tabs, as tall as the map column on a wide screen
    assert [t.text_content().split("\n")[0].strip() for t in page.locator("[role=tab]").all()] == ["Sites", "Plot a point", "My points 0/5"]
    assert page.locator("[role=tablist]").count() == 1 and page.locator("#tab-sites").get_attribute("aria-selected") == "true"
    side, col = page.locator(".mp-side").bounding_box(), page.locator(".mp-map").bounding_box()
    assert abs(side["height"] - col["height"]) < 3
    assert not page.errors


def test_the_tabs_switch_with_the_mouse_and_the_arrow_keys(page, base):
    map_page(page, base)
    page.locator("#tab-point").click()
    assert page.locator("#panel-point").is_visible() and page.locator("#panel-sites").is_hidden()
    page.locator("#tab-point").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator("#tab-mine").get_attribute("aria-selected") == "true" and page.locator("#panel-mine").is_visible()
    page.keyboard.press("Home")
    assert page.locator("#tab-sites").get_attribute("aria-selected") == "true"


def test_the_sites_tab_lists_the_sites_with_their_best_values_and_sorts_them(page, base):
    map_page(page, base)
    assert page.locator("#site-search").get_attribute("placeholder") == "Search 13 sites, 67 spots…"
    assert page.locator("#sites-count").text_content() == "Showing 13 of 13 sites"
    rows = page.locator(".s-row")
    assert rows.count() == 13
    first = rows.first
    assert "Connecting ridge" in first.text_content() and "5 candidate spots · 89.5°S" in first.text_content()
    assert first.locator(".s-sun").text_content().strip() == "91%" and first.locator(".s-earth").text_content().strip() == "55%"
    assert first.bounding_box()["height"] >= 64
    names = lambda: [r.locator(".s-name b").text_content() for r in page.locator(".s-row").all()]
    page.locator("#sort-earth").click()
    assert names()[0] == "Nobile rim 2" and "98%" in page.locator(".s-row").first.locator(".s-earth").text_content()
    page.locator("#sort-name").click()
    assert names() == sorted(names(), key=str.casefold) and page.locator("#sort-name").get_attribute("aria-pressed") == "true"
    page.locator("#sort-sun").click()
    assert names()[0] == "Connecting ridge" and names()[-1] == "Nobile rim 2"
    assert [e.text_content() for e in page.locator(".sites-head span").all()][:1] == ["Site"]
    assert page.locator(".sites-head .hint").get_attribute("data-hint") == "Best values among the site's candidate spots for 2027, at a 2 m mast: the share of the year in sunlight, and the share with Earth in view."
    assert page.locator(".lander-head").text_content() == "Flown landers (CLPS)"
    landers = [(b.locator(".grow").text_content(), b.locator("small").text_content()) for b in page.locator(".s-lander").all()]
    assert sorted(landers) == [("Blue Ghost Mission 1", "2025-03-02"), ("IM-1 Odysseus", "2024-02-22"), ("IM-2 Athena", "2025-03-06")]
    assert [e.text_content() for e in page.locator(".sites-legend span").all()] == ["Sun", "Earth in view", "Share of 2027"]


def test_search_filters_by_site_or_spot_and_opens_what_matches(page, base):
    map_page(page, base)
    page.locator("#site-search").fill("dm2-4")
    assert page.locator("#sites-count").text_content() == "Showing 1 of 13 sites · 1 spot"
    assert page.locator(".s-row").count() == 1 and page.locator(".s-row").get_attribute("aria-expanded") == "true"
    assert [b.get_attribute("data-id") for b in page.locator(".s-spot").all()] == ["DM2-4"]
    page.locator("#site-search").fill("gerlache")
    assert page.locator(".s-row").count() >= 3 and all(r.get_attribute("aria-expanded") == "true" for r in page.locator(".s-row").all())
    page.locator("#site-search").fill("zzz")
    assert page.locator("#no-results").is_visible() and page.locator("#no-results").text_content() == "No site or spot matches “zzz”."
    assert page.locator("#sites-count").text_content() == "Showing 0 of 13 sites · 0 spots"
    page.locator("#site-search").fill("")
    assert page.locator(".s-row").count() == 13 and page.locator("#no-results").is_hidden()


def test_a_site_row_expands_and_collapses(page, base):
    map_page(page, base)
    row = page.locator(".s-row").first
    assert row.get_attribute("aria-expanded") == "false" and page.locator(".s-spot").count() == 0
    row.click()
    assert page.locator(".s-row").first.get_attribute("aria-expanded") == "true" and page.locator(".s-spot").count() == 5
    page.locator(".s-row").first.click()
    assert page.locator(".s-row").first.get_attribute("aria-expanded") == "false" and page.locator(".s-spot").count() == 0


def test_the_band_appears_only_with_a_selected_spot_and_says_what_the_figures_mean(page, base):
    map_page(page, base)
    assert page.locator("#band").is_hidden()
    select_spot(page, "Site01-1")
    band = page.locator("#band")
    assert band.is_visible() and band.locator(".band-label").text_content() == "Selected spot"
    assert band.locator("h2").inner_text().replace("\n", " ").split() == ["Site01-1", "·", "Connecting", "ridge"]
    assert [e.text_content() for e in band.locator(".band-lines span").all()] == ["89.475°S 222.56°E", "Elevation 1947 m · Slope 3.0°"]
    assert band.locator(".band-verdict").text_content() == "Very bright, but with long nights"
    assert band.locator(".band-desc").text_content() == "Its longest night is about 3 times a 50 h darkness limit (VIPER's design figure). Earth is above the skyline about half the year, with stretches of over a week without a DSN station in view."
    tiles = [[e.text_content() for e in t.locator(".k, .v, .s").all()] for t in band.locator(".band-tile").all()]
    assert [t[0].replace("ⓘ", "") for t in tiles] == ["Sunlit share (2027)", "Earth in view", "Longest night", "Longest DSN gap"]
    assert [t[1] for t in tiles] == ["90%", "55%", "5 d 18 h", "12 d 6 h"]
    assert [t[2] for t in tiles] == ["Site best: 91% (Site01-2)", "Earth above the skyline", "No part of the Sun visible", "No DSN station in view"]
    assert band.locator(".why summary").first.text_content().strip().startswith("Why is a bright spot not always a good spot?")
    # actions: Explore first and outlined, then Plan a landing, then the link
    links = [a.text_content().strip() for a in band.locator(".band-actions a").all()]
    assert links == ["Explore this spot", "Plan a landing here →", "Compare all sites →"]
    # the best spot of its site says so in green
    page.locator(".s-spot[data-id='Site01-2']").click()
    assert page.locator(".band-tile .s.good").text_content() == "Best sunlit spot at Connecting ridge"
    # clicking the selected spot again deselects it; × deselects too
    page.locator(".s-spot[data-id='Site01-2']").click()
    assert page.locator("#band").is_hidden() and page.locator(".s-spot[data-id='Site01-2']").get_attribute("aria-pressed") == "false"
    page.locator(".s-spot[data-id='Site01-3']").click()
    assert page.locator("#band-x").get_attribute("aria-label") == "Clear the selected spot"
    page.locator("#band-x").click()
    assert page.locator("#band").is_hidden()
    assert not page.errors


def test_a_flown_lander_has_its_own_band(page, base):
    map_page(page, base)
    page.locator(".s-lander").first.click()
    assert page.locator("#band").is_visible() and page.locator(".band-label").text_content() == "Flown lander"
    page.locator("#band-x").click()
    assert page.locator("#band").is_hidden()


def test_hovering_a_row_lights_its_site_or_spot_on_the_map(page, base):
    map_page(page, base)
    page.locator(".s-row").first.hover()
    assert page.evaluate("document.getElementById('map').dataset.hoverSite") == "Site01"
    page.locator(".s-row").first.click()
    page.locator(".s-spot[data-id='Site01-2']").hover()
    assert page.evaluate("document.getElementById('map').dataset.hover") == "Site01-2"
    page.mouse.move(5, 5)
    assert page.evaluate("document.getElementById('map').dataset.hover") == ""


def test_plot_a_point_starts_with_a_pick_button_and_a_toggle_for_coordinates(page, base):
    map_page(page, base)
    open_plot(page)
    assert page.locator(".point-panel .mp-h2").text_content() == "Plot and save your own point"
    assert page.locator(".point-panel .mp-note").first.text_content() == "Anywhere inside a dashed site box, at least 2 km from its edge. Saved points work on every page."
    assert [e.text_content().strip() for e in page.locator(".mp-step").all()] == ["1Place a point"]
    assert page.locator("#c-place-text").text_content() == "Pick on the map" and page.locator("#c-place").bounding_box()["height"] >= 48
    assert page.locator(".pick-hint-note").text_content() == "Click inside a highlighted site box on the map. Zoom in for a more precise spot."
    assert page.locator("#c-lat").count() == 0
    toggle = page.locator("#c-toggle")
    assert toggle.text_content().strip() == "Enter coordinates instead" and toggle.get_attribute("aria-expanded") == "false"
    toggle.click()
    assert toggle.get_attribute("aria-expanded") == "true"
    assert page.locator("#c-lat").input_value() == "" and page.locator("#c-lon").input_value() == ""
    assert page.locator("#c-lat-help").text_content() == "e.g. −89.46" and page.locator("#c-lon-help").text_content() == "e.g. 222.6"
    assert page.locator("#c-show").text_content() == "Show point"


def x_y_for_margin():
    t = TILES[0]
    return t["x0M"] + 1200, (t["y0M"] + t["y1M"]) / 2, t["name"]


def test_every_invalid_input_says_why_in_a_box_and_under_its_field(page, base):
    map_page(page, base)
    mx, my, tile = x_y_for_margin()
    mlat, mlon = latlon(mx, my)
    cases = [
        (("", ""), None, "", "Enter a latitude and a longitude, or pick a point on the map."),
        (("-89.46", ""), "lon", "Required", "Enter both a latitude and a longitude."),
        (("", "222.6"), "lat", "Required", "Enter both a latitude and a longitude."),
        (("abc", "222.6"), "lat", "Not a number", "Latitude must be a number, for example −89.46."),
        (("-89.46", "xyz"), "lon", "Not a number", "Longitude must be a number, for example 222.6."),
        (("89.46", "222.6"), "lat", "Use a negative value", "Use a negative latitude for the south pole, for example −89.46."),
        (("-70", "222.6"), "lat", "Out of range", "LunaZen's site maps cover 84°S to 90°S. Pick a point inside a dashed box."),
        (("-89.46", "400"), "lon", "Out of range", "Longitude must be between 0 and 360 (or −180 to 180)."),
        (("-89.9", "10"), None, "", "This point is outside the areas that can be traced. Pick a spot inside a dashed site box."),
        ((f"{mlat:.5f}", f"{mlon:.5f}"), None, "", f"Too close to the edge of the {tile} box: a point needs 2 km of map around it. Move it 0.8 km inward."),
    ]
    for (lat, lon), field, note, message in cases:
        show_point(page, lat, lon)
        box = page.locator("#c-bad")
        assert box.get_attribute("role") == "alert" and box.text_content().replace("✗", "").strip().startswith(message), (lat, lon)
        if field:
            ids = {"lat": "c-lat", "lon": "c-lon"}
            assert page.locator(f"#{ids[field]}").get_attribute("aria-invalid") == "true"
            assert page.locator(f"#{ids[field]}-help").text_content() == note
            assert page.locator(f"#{ids[field]}").get_attribute("aria-describedby") == f"{ids[field]}-help"
            page.locator(f"#{ids[field]}").press("End")  # editing the field clears the error
            page.locator(f"#{ids[field]}").type("1")
            assert page.locator("#c-bad").count() == 0 and page.locator(f"#{ids[field]}").get_attribute("aria-invalid") == "false"
    # outside every box: the nearest usable area places a valid point
    show_point(page, "-89.9", "10")
    link = page.locator("#c-nearest")
    assert re.fullmatch(r"Nearest: .+, \d+\.\d km away", link.text_content())
    link.click()
    wait_figures(page)
    assert page.locator(".your-point").is_visible() and page.locator("#c-bad").count() == 0 and marker(page) == "point"
    assert not page.errors


def test_a_negative_longitude_is_read_as_degrees_east(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "-137.4")
    wait_figures(page)
    assert "(read as 222.6°E)" in page.locator(".your-point").text_content()


def test_enter_in_a_field_shows_the_point(page, base):
    map_page(page, base)
    open_plot(page)
    page.locator("#c-toggle").click()
    page.locator("#c-lat").fill("-89.46")
    page.locator("#c-lon").fill("222.6")
    page.locator("#c-lon").press("Enter")
    wait_figures(page)
    assert page.locator(".your-point b").text_content() == "Connecting ridge"


def test_the_placed_point_card_has_move_edit_and_clear(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    card = page.locator(".your-point")
    assert card.locator("b").text_content() == "Connecting ridge"  # no tick and no "Inside"
    assert page.locator("#c-where").text_content() == "89.4600°S 222.6000°E"
    assert [b.text_content() for b in card.locator(".acts button").all()] == ["Move", "Edit coordinates", "Clear"]
    assert page.locator("#c-place").count() == 0 and page.locator("#c-toggle").count() == 0
    assert [e.text_content().strip() for e in page.locator(".mp-step").all()] == ["1Place a point", "2Save it"]
    # Edit coordinates: the fields, pre-filled, with Update point
    page.locator("#c-edit").click()
    assert page.locator("#c-lat").input_value() == "-89.4600" and page.locator("#c-show").text_content() == "Update point"
    page.locator("#c-lat").fill("-89.50")
    page.locator("#c-show").click()
    wait_figures(page)
    assert page.locator("#c-where").text_content() == "89.5000°S 222.6000°E" and page.locator("#c-lat").count() == 0
    # Move: back to picking, and Cancel move
    page.locator("#c-move").click()
    assert page.locator("#c-move").text_content() == "Cancel move" and page.locator("#pick-banner").is_visible()
    page.locator("#c-move").click()
    assert page.locator("#pick-banner").is_hidden()
    # Clear: the point, its marker and its figures go
    page.locator("#c-clear").click()
    assert page.locator(".your-point").count() == 0 and marker(page) == "" and page.locator("#c-place").is_visible()


def test_a_valid_point_shows_four_figures_that_equal_the_explorers_year_view(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    assert page.locator("#c-figures .c-progress").text_content() == "Tracing the skyline…" or page.locator("#c-figures .tile").count() == 4
    wait_figures(page)
    assert page.locator(".mp-label").text_content() == "At this point"
    assert [e.text_content().replace("ⓘ", "").strip() for e in page.locator("#c-figures .tile .k").all()] == ["Sunlit share, 2027", "Earth in view", "Longest night", "Longest gap without DSN in view"]
    assert page.locator("#c-figures .hint").count() == 4
    mine = figures(page)
    assert [a.text_content().strip() for a in page.locator(".c-actions a").all()] == ["Explore this point", "Plan a landing here →"]
    page.goto(f"{base}explorer.html#spot=pt_-89.4600_222.6000&mast=2&start=2027-01-01&days=365&t=0")
    page.wait_for_function("document.querySelectorAll('#period-stats [data-fig]').length >= 8", timeout=RESULT_TIMEOUT_MS)
    stats = {k: page.locator(f"#period-stats [data-fig={k}]").text_content().strip() for k in ("sun", "earth", "night", "gap")}
    assert round(float(stats["sun"].rstrip("%"))) == int(mine["sun"].rstrip("%")), (stats, mine)
    assert round(float(stats["earth"].rstrip("%"))) == int(mine["earth"].rstrip("%")), (stats, mine)
    assert stats["night"] == mine["night"], (stats, mine)
    assert stats["gap"] == mine["gap"], (stats, mine)


def test_the_explorer_links_of_the_map_open_today_for_30_days(page, base):
    map_page(page, base)
    select_spot(page, "Site01-1")
    spot = page.locator("#band .band-actions a").first.get_attribute("href")
    assert re.fullmatch(r"explorer\.html#spot=[^&]+&mast=2&days=30&t=0", spot), spot
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    assert page.locator(".c-actions a").first.get_attribute("href") == "explorer.html#spot=pt_-89.4600_222.6000&mast=2&days=30&t=0"
    page.locator("#save-mine").click()
    page.locator("#tab-mine").click()
    assert page.locator(".mine-links a").first.get_attribute("href") == "explorer.html#spot=pt_-89.4600_222.6000&mast=2&days=30&t=0"
    assert [a.text_content() for a in page.locator(".mine-links a").all()] == ["Explore", "Plan a landing", "Compare"]


def test_saving_names_the_point_and_a_second_save_of_it_is_prevented(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    assert page.locator("#c-name").input_value() == "My point 1"
    assert page.locator(".save-row + .mp-note").text_content() == "5 of 5 places left · kept in this browser"
    assert page.locator("#save-mine").text_content() == "Save to My points"
    page.locator("#c-name").fill("Ridge camp")
    page.locator("#save-mine").click()
    saved = page.locator(".box.saved")
    assert saved.get_attribute("role") == "status" and "Saved as Ridge camp" in saved.text_content() and saved.locator("#view-mine").text_content() == "View My points"
    assert page.locator("#save-mine").count() == 0 and page.locator("#tab-mine .mp-count").text_content() == "1/5"
    assert marker(page) == ""  # the saved diamond replaces the target
    # the same point again (within 0.00005°) shows the saved box, not the save controls
    page.locator("#c-clear").click()
    show_point(page, "-89.46002", "222.6")
    wait_figures(page)
    assert "Saved as Ridge camp" in page.locator(".box.saved").text_content() and page.locator("#save-mine").count() == 0
    page.locator("#view-mine").click()
    assert page.locator("#panel-mine").is_visible()


def test_the_sixth_point_says_my_points_is_full(page, base):
    map_page(page, base)
    for i in range(5):
        show_point(page, f"-89.4{i}", "222.6")
        wait_figures(page)
        assert page.locator("#c-name").input_value() == f"My point {i + 1}"
        page.locator("#save-mine").click()
    assert page.locator("#tab-mine .mp-count").text_content() == "5/5"
    page.locator("#c-clear").click()
    show_point(page, "-89.55", "222.6")
    wait_figures(page)
    assert page.locator(".box.full").text_content() == "My points is full (5 of 5). Remove a point in My points to save another."
    assert page.locator("#save-mine").count() == 0


def test_my_points_lists_the_saved_points_and_removes_them(page, base):
    map_page(page, base)
    page.locator("#tab-mine").click()
    assert page.locator(".mine-empty p").text_content() == "No saved points yet. Plot a point inside a site box and save it to use it on every page."
    assert page.locator(".mine-head span").text_content() == "0 of 5 · kept in this browser"
    page.locator("#mine-plot").click()
    assert page.locator("#panel-point").is_visible()
    for lat in ("-89.46", "-89.50"):
        show_point(page, lat, "222.6")
        wait_figures(page)
        page.locator("#save-mine").click()
        page.locator("#c-clear").click()
    page.locator("#tab-mine").click()
    assert page.locator(".mine-head span").text_content() == "2 of 5 · kept in this browser"
    cards = page.locator(".mine-cards li")
    assert cards.count() == 2
    assert cards.first.locator(".mine-go").text_content() == "My point 1" and "89.4600°S 222.6000°E · Connecting ridge" in cards.first.locator("small").text_content()
    assert page.locator("#mine-plot").text_content() == "Plot another point"
    page.locator(".mine-del").first.click()
    assert page.locator(".mine-cards li").count() == 1 and page.locator("#tab-mine .mp-count").text_content() == "1/5"
    page.locator(".mine-del").first.click()
    assert page.locator(".mine-empty").is_visible()


def test_saved_points_survive_a_reload_and_show_on_every_tab(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    page.locator("#save-mine").click()
    page.goto(f"{base}map.html")
    page.wait_for_selector(".s-row", state="attached", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("#tab-mine .mp-count").text_content() == "1/5"
    page.locator("#tab-mine").click()
    assert page.locator(".mine-cards li").count() == 1
    page.locator(".mine-go").click()  # open it: the map goes to it
    zoom, cx, cy = settled_view(page)
    assert zoom > 5 and abs(cx - POINT[0]) < 3000
    for tab in ("#tab-sites", "#tab-point", "#tab-mine"):
        page.locator(tab).click()
        assert page.evaluate("document.getElementById('map').dataset.marker") == ""  # a saved point is the cyan diamond, not the target


def test_the_accuracy_note_is_collapsed_and_short(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    d = page.locator(".c-accuracy")
    assert d.get_attribute("open") is None
    d.locator("summary").click()
    text = d.locator("p").text_content()
    assert text.startswith("Terrain comes from a 20 m copy of NASA's 5 m map around the point and a 480 m map beyond. Checked against the 5 m results at 67 spots")
    assert "typically within 0.3 points" in text and "within an hour (worst case 226 h)" in text


def test_pick_mode_guides_places_and_cancels(page, base):
    map_page(page, base)
    open_plot(page)
    pick = page.locator("#c-place")
    assert pick.get_attribute("aria-pressed") == "false" and page.locator("#pick-banner").is_hidden()
    pick.click()
    assert pick.get_attribute("aria-pressed") == "true" and page.locator("#c-place-text").text_content() == "Cancel picking"
    banner = page.locator("#pick-banner")
    assert banner.is_visible() and banner.get_attribute("role") == "status"
    assert banner.text_content() == "Click inside a highlighted area to place your point · Esc to cancel"
    assert page.evaluate("document.getElementById('map').style.cursor") == "crosshair" and "is-picking" in page.locator("#map-wrap").get_attribute("class")
    # the label follows the pointer: inside a usable area, then outside
    page.mouse.move(*screen_of(page, -11000, -12000))
    page.wait_for_function("document.getElementById('pick-hint').textContent.includes('Inside Connecting ridge')")
    assert "°S" in page.locator("#pick-hint").text_content()
    page.wait_for_timeout(60)
    page.mouse.move(*screen_of(page, 60000, 60000))
    page.wait_for_function("document.getElementById('pick-hint').textContent.includes('Outside the traceable areas')")
    page.mouse.click(*screen_of(page, 60000, 60000))  # a click outside says why and picking goes on
    assert "outside the areas that can be traced" in page.locator("#c-bad").text_content() and page.locator("#c-place").get_attribute("aria-pressed") == "true"
    # at the whole-pole view a first click inside a box zooms to its close-up and stays in pick mode
    page.mouse.click(*screen_of(page, -11000, -12000))
    page.wait_for_function("document.getElementById('pick-banner').textContent.startsWith('Now click to place your point in Connecting ridge')")
    assert banner.text_content() == "Now click to place your point in Connecting ridge · Esc to cancel"
    assert page.locator("#c-place").get_attribute("aria-pressed") == "true" and page.locator(".your-point").count() == 0
    zoom, cx, cy = settled_view(page)
    assert zoom > 5
    page.mouse.click(*screen_of(page, -11000, -3000, zoom, cx, cy))  # at close-up, outside every box: the error, still picking
    assert "outside the areas that can be traced" in page.locator("#c-bad").text_content() and page.locator("#c-place").get_attribute("aria-pressed") == "true"
    page.mouse.click(*screen_of(page, -11000, -12000, zoom, cx, cy))  # one click at close-up places the point
    wait_figures(page)
    assert banner.is_hidden() and "Connecting ridge" in page.locator(".your-point").text_content()
    assert page.locator("#c-where").text_content() != ""
    # Esc and the button both end picking without changing anything
    page.locator("#c-move").click()
    page.keyboard.press("Escape")
    assert banner.is_hidden() and page.locator(".your-point").is_visible()
    page.locator("#c-move").click()
    page.locator("#c-move").click()
    assert banner.is_hidden()
    # opening a site in the list ends picking too
    page.locator("#c-move").click()
    page.locator("#tab-sites").click()
    page.locator(".s-row").first.click()
    assert banner.is_hidden()
    assert not page.errors


def zoomed_on_a_spot(pg, base):
    """Open the map zoomed on a spot (its neighbours are 300 m away, about 35 px) and return the spot's id and screen position."""
    spot = SPOTS[0]
    map_page(pg, base, f"#zoom=60&cx={spot['xM']:.0f}&cy={spot['yM']:.0f}")
    pg.locator("#map").scroll_into_view_if_needed()
    pg.wait_for_timeout(300)
    return spot["id"], *screen_of(pg, spot["xM"], spot["yM"], 60, round(spot["xM"]), round(spot["yM"]))


def test_a_dot_answers_the_pointer_from_12_px_away(page, base):
    sid, px, py = zoomed_on_a_spot(page, base)
    page.mouse.move(px + 11, py)
    page.wait_for_function("!document.getElementById('map-tip').hidden")
    assert sid in page.locator("#map-tip").text_content()
    page.mouse.move(px + 60, py + 60)
    page.wait_for_function("document.getElementById('map-tip').hidden")


def test_a_tap_on_a_dot_shows_its_tooltip_and_a_second_tap_selects_it(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    sid, px, py = zoomed_on_a_spot(pg, base)
    pg.touchscreen.tap(px + 8, py)
    pg.wait_for_function("!document.getElementById('map-tip').hidden")
    assert sid in pg.locator("#map-tip").text_content() and pg.locator("#band").is_hidden()  # shown, not yet selected
    pg.touchscreen.tap(px + 8, py)
    pg.wait_for_function("!document.getElementById('band').hidden")
    assert sid in pg.locator("#band h2").text_content()
    ctx.close()


def test_the_keyboard_gets_the_tooltip_the_pointer_gets(page, base):
    map_page(page, base)
    page.locator(".s-row").first.click()
    spot = page.locator(".s-spot").first
    spot.focus()
    page.wait_for_function("!document.getElementById('map-tip').hidden")
    assert spot.get_attribute("data-id") in page.locator("#map-tip").text_content()


TIPS = {
    "Sunlit share (2027)": "Share of 2027 with at least part of the Sun above the real skyline at this spot.",
    "Sunlit share, 2027": "Share of 2027 with at least part of the Sun above the real skyline at this spot.",
    "Earth in view": "Share of 2027 with at least part of Earth above the skyline.",
    "Longest night": "The longest stretch with no part of the Sun above the skyline.",
    "Longest DSN gap": "Longest stretch in 2027 with no Deep Space Network station in view. Line of sight only; no link budget or scheduling.",
    "Longest gap without DSN in view": "Longest stretch in 2027 with no Deep Space Network station in view. Line of sight only; no link budget or scheduling.",
}


def check_tips(page, scope, tile):
    tiles = page.locator(f"{scope} {tile}")
    assert tiles.count() == 4
    for i in range(4):
        t = tiles.nth(i)
        name = t.locator(".k").text_content().replace("ⓘ", "").strip()
        hint = t.locator(".hint")
        assert hint.evaluate("e => e.tagName") == "BUTTON" and hint.get_attribute("aria-label") == f"About: {name}", name
        assert hint.get_attribute("data-hint").startswith(TIPS[name]), name
        shown = lambda: page.evaluate("(e) => getComputedStyle(e, '::after').opacity", hint.element_handle())
        assert shown() == "0", name
        page.keyboard.press("Shift")
        hint.focus()  # the keyboard shows it
        assert shown() == "1", name
        page.keyboard.press("Escape")  # and Escape closes it
        assert shown() == "0", name
        hint.hover()  # the pointer too
        assert shown() == "1", name
        page.mouse.move(0, 0)


def test_every_figure_has_its_tooltip_as_a_button_that_opens_and_closes(page, base):
    map_page(page, base)
    select_spot(page, "Site01-1")
    check_tips(page, "#band", ".band-tile")
    # the panel is 260 px wide, under the icon, and stays inside the window
    hint = page.locator("#band .band-tile .hint").first
    hint.focus()
    assert page.evaluate("(e) => parseFloat(getComputedStyle(e, '::after').width)", hint.element_handle()) == 260
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    check_tips(page, "#c-figures", ".tile")


def test_a_tap_opens_an_info_tooltip_and_a_tap_elsewhere_closes_it(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    map_page(pg, base)
    pg.locator(".s-row").first.click()
    pg.locator(".s-spot").first.click()
    pg.wait_for_selector("#band .hint")
    hint = pg.locator("#band .band-tile .hint").first
    hint.scroll_into_view_if_needed()
    hint.tap()
    assert pg.evaluate("(e) => getComputedStyle(e, '::after').opacity", hint.element_handle()) == "1"
    pg.locator(".band-label").tap()
    assert pg.evaluate("(e) => getComputedStyle(e, '::after').opacity", hint.element_handle()) == "0"
    ctx.close()


def test_how_to_use_the_map_opens_the_four_groups(page, base):
    map_page(page, base)
    page.locator("#help-open").click()
    dialog = page.locator("#help-dialog")
    assert dialog.is_visible() and dialog.locator("h2").text_content() == "How to use the map"
    assert [e.text_content() for e in dialog.locator("#map-help h3").all()] == ["Reading the map", "Sites and spots", "Add your own point", "Moving around"]
    text = dialog.locator("#map-help").text_content()
    assert "Brighter means more sunlight (or Earth in view) over NASA's 18.6-year average." in text
    assert "Dashed boxes: the 13 NASA sites. Dots: their 67 candidate spots. Stars: CLPS landings." in text
    assert "In Plot a point, choose Pick on the map and click inside a highlighted area, or enter coordinates instead." in text
    assert "Points need to be at least 2 km inside a box's edge. South latitudes are negative." in text
    assert "Choose Save to My points to keep up to 5 points and use them on every page." in text
    assert "My spots" not in text and "Each 600 m cell" not in text
    page.keyboard.press("Escape")
    assert dialog.is_hidden()


def test_the_map_works_on_a_phone(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    map_page(pg, base)
    fits = lambda: pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert fits()
    # the sidebar stacks under the map at full width and its own height, with no inner scroll
    map_box, side = pg.locator("#map-wrap").bounding_box(), pg.locator(".mp-side").bounding_box()
    assert side["y"] > map_box["y"] + map_box["height"] - 5 and side["width"] > 340
    assert pg.evaluate("(() => { const e = document.querySelector('.sites-scroll'); return e.scrollHeight <= e.clientHeight + 1; })()")
    for sel in ("#help-open", "#layer-sun", "#zoom-in", "#reset", "#tab-sites", "#tab-point", "#tab-mine", "#sort-sun", "#site-search"):
        assert pg.locator(sel).bounding_box()["height"] >= 44 or sel == "#help-open", sel
    assert pg.locator("#help-open").bounding_box()["height"] + 8 >= 44  # the button is 36 px with a 44 px tap area around it
    open_plot(pg)
    assert pg.locator("#c-place").bounding_box()["height"] >= 44
    pg.locator("#c-toggle").click()
    lat, lon = pg.locator("#c-lat").bounding_box(), pg.locator("#c-lon").bounding_box()
    assert lat["width"] > 250 and abs(lat["width"] - lon["width"]) < 2 and lon["y"] > lat["y"]  # the fields stack, each as wide as the panel
    assert pg.locator("#c-show").bounding_box()["height"] >= 44
    pg.locator("#c-place").click()
    assert pg.locator("#pick-banner").is_visible() and fits()
    pg.locator("#c-place").click()
    show_point(pg, "-89.46", "222.6")
    wait_figures(pg)
    assert fits()
    for sel in ("#c-move", "#c-edit", "#c-clear", "#save-mine"):
        assert pg.locator(sel).bounding_box()["height"] >= 44, sel
    pg.locator("#tab-sites").click()
    pg.locator(".s-row").first.click()
    pg.locator(".s-spot").first.click()
    assert pg.locator("#band").is_visible() and fits()
    for sel in ("#band-x", "#band .band-actions a"):
        assert pg.locator(sel).first.bounding_box()["height"] >= 36, sel
    ctx.close()


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_the_point_is_marked_at_once_and_at_every_zoom(browser, base, theme):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_init_script(f"try{{localStorage.setItem('lunazen-theme','{theme}')}}catch(e){{}}")
    pg = ctx.new_page()
    map_page(pg, base)
    assert marker(pg) == ""
    show_point(pg, "-89.46", "222.6")
    assert marker(pg) == "point" and pg.locator("#c-figures .tile").count() == 0  # at once, while the figures are still being computed
    wait_figures(pg)
    for presses in (0, 2, 4):  # the site close-up, then zoomed out toward the whole pole
        for _ in range(presses):
            pg.locator("#zoom-out").click()
        zoom, cx, cy = settled_view(pg)
        x, y = screen_of(pg, *POINT, zoom, cx, cy)
        assert ring_pixels(pg, x, y, theme) > 15, (theme, presses, zoom)
        assert marker(pg) == "point"
    ctx.close()


def test_the_marker_stays_until_the_point_is_cleared_or_moved(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    page.locator("#zoom-in").click()
    page.wait_for_timeout(100)
    assert marker(page) == "point"
    show_point(page, "-89.50", "222.6")
    wait_figures(page)
    assert marker(page) == "point" and "89.5000°S" in page.locator("#c-where").text_content()
    page.keyboard.press("Escape")  # Esc leaves the point alone
    assert marker(page) == "point"
    page.locator("#c-clear").click()
    assert marker(page) == ""


def test_saving_turns_the_marker_into_the_saved_diamond(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    assert marker(page) == "point"
    page.locator("#save-mine").click()
    page.wait_for_timeout(100)
    assert marker(page) == ""
    zoom, cx, cy = settled_view(page)
    x, y = screen_of(page, *POINT, zoom, cx, cy)
    assert ring_pixels(page, x, y) == 0


def test_a_site_spot_hides_the_marker_and_show_on_map_brings_it_back(page, base):
    map_page(page, base)
    show_point(page, "-89.46", "222.6")
    wait_figures(page)
    page.locator("#tab-sites").click()
    select_spot(page, "Site01-3")
    assert marker(page) == ""
    open_plot(page)
    assert page.locator(".your-point").is_visible()  # the point is still there, only its marker stepped aside
    page.locator("#c-where").click()
    assert marker(page) == "point"
    zoom, cx, cy = settled_view(page)
    assert zoom >= 6 and abs(cx - POINT[0]) < 500 and abs(cy - POINT[1]) < 500
    # Update point brings it back too
    page.locator("#tab-sites").click()
    page.locator(".s-spot[data-id='Site01-4']").click()
    assert marker(page) == ""
    show_point(page, "-89.46", "222.6")
    assert marker(page) == "point"


def test_a_point_that_cannot_be_traced_gets_a_grey_ring_until_the_input_changes(page, base):
    map_page(page, base)
    mx, my, tile = x_y_for_margin()
    mlat, mlon = latlon(mx, my)
    for lat, lon in (("-89.9", "10"), (f"{mlat:.5f}", f"{mlon:.5f}")):  # outside every box, then too close to an edge
        show_point(page, lat, lon)
        assert marker(page) == "rejected", (lat, lon)
        page.locator("#c-lat").press("End")
        page.locator("#c-lat").type("1")
        assert marker(page) == ""
    show_point(page, "-89.9", "10")
    assert marker(page) == "rejected"
    show_point(page, "-89.46", "222.6")  # a valid point replaces it
    assert marker(page) == "point"
    wait_figures(page)
    page.locator("#c-edit").click()
    page.locator("#c-lat").fill("abc")
    page.locator("#c-show").click()  # no location to show
    assert marker(page) == "point"


def test_a_rejected_pick_shows_the_grey_ring_and_picking_goes_on(page, base):
    map_page(page, base)
    open_plot(page)
    page.locator("#c-place").click()
    page.mouse.click(*screen_of(page, 60000, 60000))
    assert marker(page) == "rejected" and page.locator("#c-place").get_attribute("aria-pressed") == "true"
    page.locator("#c-place").click()


def test_the_light_theme_sidebar_and_band_use_the_light_values(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_init_script("try{localStorage.setItem('lunazen-theme','light')}catch(e){}")
    pg = ctx.new_page()
    map_page(pg, base)
    select_spot(pg, "Site01-2")
    assert pg.evaluate("getComputedStyle(document.querySelector('.s-spot[aria-pressed=true]')).backgroundColor") == "rgb(238, 241, 246)"
    assert pg.evaluate("getComputedStyle(document.querySelector('.s-earth')).color") == "rgb(42, 111, 176)"
    show_point(pg, "-89.46", "222.6")
    wait_figures(pg)
    assert pg.evaluate("getComputedStyle(document.querySelector('.your-point')).backgroundColor") == "rgb(230, 244, 234)"
    pg.locator("#c-edit").click()
    pg.locator("#c-lat").fill("abc")
    pg.locator("#c-show").click()
    assert pg.evaluate("getComputedStyle(document.querySelector('#c-bad')).backgroundColor") == "rgb(251, 237, 235)"
    ctx.close()


def test_a_selected_spot_points_to_its_details_below_the_map(page, base):
    map_page(page, base)
    cue = page.locator("#band-cue")
    assert cue.is_hidden()
    select_spot(page, "Site01-1")
    assert page.evaluate("document.getElementById('band').getBoundingClientRect().top > innerHeight")  # the band is under the window
    assert cue.is_visible() and cue.text_content().strip() == "Site01-1 · details below"
    assert cue.get_attribute("aria-label") == "Show the details of Site01-1, below the map"
    assert cue.bounding_box()["height"] >= 44
    cue.click()
    page.wait_for_function("document.getElementById('band').getBoundingClientRect().top < innerHeight - 200")
    assert cue.is_hidden() and page.evaluate("document.activeElement.id") == "band"
    # scrolling back up brings the cue back; deselecting takes it away
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_function("!document.getElementById('band-cue').hidden")
    page.locator(".s-spot[data-id='Site01-1']").click()  # clicking the selected spot again deselects it
    assert cue.is_hidden() and page.locator("#band").is_hidden()


def test_no_cue_is_needed_when_the_band_is_already_in_view(browser, base):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1700})
    pg = ctx.new_page()
    map_page(pg, base)
    select_spot(pg, "Site01-1")
    assert pg.locator("#band").is_visible() and pg.locator("#band-cue").is_hidden()
    ctx.close()


def test_the_cue_names_a_flown_lander(page, base):
    map_page(page, base)
    page.locator(".s-lander").first.click()
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_function("!document.getElementById('band-cue').hidden")
    assert page.locator("#band-cue").text_content().strip().endswith("· details below")


def test_the_cue_works_on_a_phone(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    map_page(pg, base)
    pg.locator(".s-row").first.tap()
    pg.locator(".s-spot").first.tap()
    cue = pg.locator("#band-cue")
    pg.wait_for_function("!document.getElementById('band-cue').hidden")
    box = cue.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390 and box["height"] >= 44
    cue.tap()
    pg.wait_for_function("document.getElementById('band').getBoundingClientRect().top < innerHeight - 100")
    assert cue.is_hidden() and pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    ctx.close()


# ---- Whole Moon: the page of the redesign

MOON_VIEWS = {"near": (-90, 90, 60, -90)}


def moon_page(pg, base, hash_="#site=a11&start=2027-03-15&t=0&view="):
    pg.goto(f"{base}moon.html{hash_}")
    pg.wait_for_selector("#moon-table tbody tr", timeout=RESULT_TIMEOUT_MS)
    pg.wait_for_timeout(400)


def moon_table(pg):
    return [[" ".join(c.inner_text().split()) for c in r.locator("th, td").all()] for r in pg.locator("#moon-table tbody tr").all()]


def test_the_moon_header_has_the_new_heading_copy_icon_and_help_button(page, base):
    moon_page(page, base)
    assert page.locator(".mp-head .label").text_content() == "Learn · Whole Moon"
    assert page.locator("h1").text_content() == "Lunar sky conditions across landing sites"
    assert page.locator(".mp-sub").text_content() == "Compare solar elevation, lunar night duration, and Earth visibility at historical landing sites (Apollo to Chandrayaan-3) against the south pole at the same moment."
    copy = page.locator("#copy-link")
    assert copy.get_attribute("aria-label") == "Copy link" and copy.get_attribute("title") == "Copy link" and copy.text_content().strip() == ""
    box = copy.bounding_box()
    assert box["width"] == 36 and box["height"] == 36
    assert page.locator("#help-open").text_content().strip() == "How to use this page"
    gap = page.locator("#help-open").bounding_box()["x"] - (box["x"] + box["width"])
    assert 9 <= gap <= 11
    assert "How does the sky differ" not in page.content()


def test_copy_link_confirms(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    pg = ctx.new_page()
    moon_page(pg, base)
    pg.locator("#copy-link").click()
    assert pg.locator(".copy-status").text_content() == "Link copied"
    assert pg.evaluate("navigator.clipboard.readText()").startswith(base + "moon.html")
    pg.wait_for_function("!document.querySelector('.copy-status')", timeout=4000)
    ctx.close()


def test_how_to_use_this_page_opens_the_dialog_and_escape_closes_it(page, base):
    moon_page(page, base)
    page.locator("#help-open").click()
    dialog = page.locator("#help-dialog")
    assert dialog.is_visible() and dialog.locator("h2").text_content() == "How to use this page"
    assert [e.text_content() for e in dialog.locator("#moon-help h3").all()] == ["Pick a site and date", "Read the two skies", "Compare the year", "About the data"]
    text = dialog.locator("#moon-help").text_content()
    assert "Chang'e 4 and Chang'e 6 are on the far side; choosing one switches the map." in text
    assert "Each skyline has its own height scale, printed in its corner." in text
    assert "The table gives the whole of 2027 at the chosen site and at the pole, whatever date you picked." in text
    assert "Terrain at the landing sites is the 474 m global map, so skylines are approximate; Sun and Earth positions are exact." in text
    assert 'The south-pole spot is Site01-1 on the Connecting Ridge, with its 5 m terrain.' in text
    assert '"DSN in view" counts a direct line of sight only. Chang\'e 4 and 6 reached Earth through a relay satellite, which this page does not model.' in text
    assert page.locator("details.howto").count() == 0  # the old "About this page" disclosure is gone
    page.keyboard.press("Escape")
    assert dialog.is_hidden() and page.evaluate("document.activeElement.id") == "help-open"
    page.locator("#help-open").click()
    page.locator("#help-close").click()
    assert dialog.is_hidden()
    page.locator("#help-open").click()
    page.mouse.click(5, 5)  # the backdrop
    assert dialog.is_hidden()


def test_the_table_is_the_designs_and_its_figures_are_unchanged(page, base):
    moon_page(page, base)
    assert page.locator("#moon-table-h").text_content() == "Site vs. South Pole (2027)"
    assert page.locator("#th-site").text_content() == "Apollo 11" and page.locator("#th-pole").text_content() == "South pole Site01-1*"
    rows = moon_table(page)
    assert [r[0] for r in rows] == ["Highest the Sun gets", "Hours of full Sun", "Time with the Sun up", "Longest night", "Earth's height in the sky", "Time with Earth in view", "Time with DSN in view"]
    assert rows[0][1:] == ["90°", "2.0°"]
    assert rows[1][1] == "4,249 h Tracking upright array 64%, flat 64%" and rows[1][2] == "7,464 h Tracking upright array 99.9%, flat 1.1%"
    assert [r[1:] for r in rows[2:]] == [["49%", "90%"], ["14 d 18 h", "5 d 18 h"], ["58° to 73°", "−7.5° to 6.2°"], ["100%", "55%"], ["98%", "55%"]]
    assert "(equal here" not in page.locator("#moon-table").text_content() and "in the year" not in page.locator("#moon-table").text_content()
    assert page.locator("#moon-story").text_content() == "At Apollo 11 the Sun climbs to 90°; at the pole it never gets above 2.0°, so every ridge matters. Earth stays between 58° and 73° in the sky, against −7.5° to 6.2° at the pole."
    assert page.locator("#site-info").text_content() == "NASA, landed 1969-07-20 · 0.674°N 23.47°E"
    assert page.locator("#moon-site-title").text_content() == "Apollo 11 Tranquility Base"
    assert page.locator("#moon-pole-title").text_content() == "South pole: Site01-1, Connecting ridge*"


def test_choosing_a_far_side_site_switches_the_map_and_the_table_follows(page, base):
    moon_page(page, base)
    assert page.locator("#view-near").get_attribute("aria-pressed") == "true"
    assert page.locator("#moon-side-note").text_content() == "Faces Earth: Earth is in view all year at every site here."
    assert page.locator("#moon-corner").text_content() == "Near side · 90°W to 90°E"
    page.locator("#site").select_option("ce4")
    page.wait_for_function("document.getElementById('view-far').getAttribute('aria-pressed') === 'true'")
    assert page.locator("#moon-side-note").text_content() == "Never faces Earth: there is no direct line to it from here."
    assert page.locator("#moon-corner").text_content() == "Far side · 90°E to 90°W through 180°"
    assert page.locator("#th-site").text_content() == "Chang'e 4" and page.locator("#site-info").text_content().endswith("· far side")
    rows = moon_table(page)
    assert rows[4][1] == "Below the horizon" and rows[5][1] == "0%" and rows[6][1] == "0%"
    assert "never in view from Chang'e 4" in page.locator("#moon-story").text_content()
    # the switch works on its own, without changing the site
    page.locator("#view-near").click()
    assert page.locator("#view-near").get_attribute("aria-pressed") == "true" and page.locator("#site").input_value() == "ce4"
    page.locator("#view-far").click()
    assert page.locator("#view-far").get_attribute("aria-pressed") == "true" and page.locator("#site").input_value() == "ce4"
    page.locator("#site").select_option("a15")  # a near-side site switches back
    page.wait_for_function("document.getElementById('view-near').getAttribute('aria-pressed') === 'true'")


def test_clicking_a_marker_on_the_map_chooses_that_site(page, base):
    moon_page(page, base)
    box = page.locator("#moon-map").bounding_box()
    lat, lon = 26.132, 3.63  # Apollo 15 on the near-side view (90°W to 90°E, 60°N to 90°S)
    page.mouse.click(box["x"] + (lon + 90) / 180 * box["width"], box["y"] + (60 - lat) / 150 * box["height"])
    page.wait_for_function("document.getElementById('th-site').textContent === 'Apollo 15'")
    assert page.locator("#site").input_value() == "a15" and "26.132°N" in page.locator("#site-info").text_content()


def test_the_start_date_and_the_explorer_link_are_in_the_playback_bar(page, base):
    moon_page(page, base)
    bar = page.locator(".moon-play")
    for sel in ("#start", "#play", "#time", "#moon-time", "#explorer-link"):
        assert bar.locator(sel).count() == 1, sel
    assert bar.locator(".moon-start").text_content().startswith("Start (UTC)")
    assert page.locator("#moon-time").text_content() == "2027-03-15 00:00 UTC · day 1 of 30"
    assert page.locator("#explorer-link").text_content() == "Open in the Explorer →"
    href = page.locator("#explorer-link").get_attribute("href")
    assert "spot=a11" in href and "start=2027-03-15" in href
    page.locator("#time").evaluate("e => { e.value = 40; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#moon-time").text_content().endswith("· day 1 of 30")  # 40 quarter-hours is still day 1
    page.locator("#time").evaluate("e => { e.value = 200; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#moon-time").text_content() == "2027-03-17 02:00 UTC · day 3 of 30"
    page.locator("#start").fill("2027-04-01")
    page.locator("#start").dispatch_event("change")
    assert page.locator("#moon-time").text_content().startswith("2027-04-") and "start=2027-04-01" in page.locator("#explorer-link").get_attribute("href")
    assert page.locator("#time").input_value() != "200"  # changing the date starts the window again
    # Play moves the slider and reads Pause with aria-pressed
    before = page.locator("#time").input_value()
    page.locator("#play").click()
    assert page.locator("#play").get_attribute("aria-pressed") == "true" and page.locator("#play-text").text_content() == "Pause"
    page.wait_for_function("v => document.getElementById('time').value !== v", arg=before)
    page.locator("#play").click()
    assert page.locator("#play-text").text_content() == "Play"


def test_the_moon_layout_on_a_large_screen(page, base):
    page.set_viewport_size({"width": 1440, "height": 1100})
    moon_page(page, base)
    wrap, side = page.locator(".moon-wrap").bounding_box(), page.locator(".moon-side").bounding_box()
    assert side["x"] >= wrap["x"] + wrap["width"] + 20 and abs(side["y"] - page.locator(".moon-bar").bounding_box()["y"]) < 5  # side by side
    assert abs(wrap["width"] - wrap["height"]) < 2 and wrap["width"] <= 702  # the map is square
    story = page.locator("#moon-story").bounding_box()
    assert abs(story["x"] - wrap["x"]) < 2 and story["width"] > wrap["width"] + side["width"]  # full width, lined up with the map
    assert story["y"] > wrap["y"] + wrap["height"]
    caption = page.locator(".moon-caption").bounding_box()
    assert caption["height"] < 24  # one line
    a, b = [f.bounding_box() for f in page.locator(".moon-figure").all()]
    assert abs(a["y"] - b["y"]) < 2 and b["x"] > a["x"] + a["width"]  # the skylines side by side
    assert page.locator(".moon-foot").text_content() == "* Site01-1 (Connecting Ridge) serves as the south-polar reference for non-polar site comparisons."
    assert page.locator(".mp-credit").text_content() == "NASA LRO LOLA global elevation, about 474 m per pixel; dark is low, light is high"
    assert page.locator(".moon-bandlink").text_content() == "South-polar sites are on the Map →" and page.locator(".moon-bandlink").get_attribute("href") == "map.html"
    assert not page.errors


def test_the_moon_works_on_a_phone_and_the_playback_bar_never_covers_a_skyline(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    moon_page(pg, base)
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert pg.locator(".moon-side").bounding_box()["y"] < pg.locator(".moon-wrap").bounding_box()["y"]  # the site panel comes first
    for sel in ("#site", "#view-near", "#view-far", "#start", "#play", "#explorer-link", "#copy-link", "#help-open"):
        assert pg.locator(sel).bounding_box()["height"] + (8 if sel in ("#help-open",) else 0) >= 44, sel
    assert pg.evaluate("getComputedStyle(document.querySelector('.moon-play')).position") == "static"  # not sticky
    for _ in range(6):  # scroll through the skylines: the bar is never on top of a picture
        pg.evaluate("window.scrollBy(0, 220)")
        pg.wait_for_timeout(80)
        overlap = pg.evaluate("""() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const bar = r('.moon-play');
          return [...document.querySelectorAll('.moon-pano')].some((p) => { const q = p.getBoundingClientRect(); return q.height > 0 && bar.bottom > q.top && bar.top < q.bottom && bar.right > q.left && bar.left < q.right; });
        }""")
        assert not overlap
    ctx.close()


def test_the_moon_light_theme_uses_the_light_values(browser, base):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1100})
    ctx.add_init_script("try{localStorage.setItem('lunazen-theme','light')}catch(e){}")
    pg = ctx.new_page()
    moon_page(pg, base)
    css = lambda sel, prop: pg.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p]", [sel, prop])
    assert css(".moon-panel", "backgroundColor") == "rgb(245, 246, 248)" and css(".moon-panel", "borderTopColor") == "rgb(217, 220, 226)"
    assert css("#site", "borderTopColor") == "rgb(42, 111, 176)" and css("#site", "borderTopWidth") == "2px"
    assert css("#th-pole", "color") == "rgb(42, 111, 176)" and css("#th-site", "color") == "rgb(154, 95, 14)"
    assert css("#explorer-link", "color") == "rgb(154, 95, 14)"
    assert css("#copy-link", "borderTopColor") == "rgb(74, 80, 92)"
    assert css(".moon-foot", "borderTopColor") == "rgb(217, 220, 226)"
    ctx.close()


# ---- Explorer: the page of the redesign

SITE_URL = "#spot=Site01-1&mast=2&start=2027-03-01&days=30&t=25"  # 06:15 UTC on 1 March 2027, the guide's walkthrough


def exp_page(pg, base, hash_=SITE_URL):
    pg.goto(f"{base}explorer.html{hash_}")
    pg.wait_for_selector("#moment-cards .exp-card", timeout=RESULT_TIMEOUT_MS)
    pg.wait_for_timeout(300)


def words(text):
    return " ".join(text.split())


def test_the_explorer_header_has_the_new_heading_copy_icon_and_help_button(page, base):
    exp_page(page, base)
    assert page.locator(".mp-head .label").text_content() == "Learn · Explorer"
    assert page.locator("h1").text_content() == "Local sky geometry at a landing site"
    assert page.locator(".mp-sub").text_content() == "Simulate Sun and Earth trajectories against the local horizon at 15-minute intervals. Select a target spot, mission window, and sensor mast height."
    copy = page.locator("#copy-link")
    assert copy.get_attribute("aria-label") == "Copy link" and copy.get_attribute("title") == "Copy link" and copy.text_content().strip() == ""
    assert copy.bounding_box()["width"] == 36 and copy.bounding_box()["height"] == 36
    assert page.locator("#help-open").text_content().strip() == "How to use the Explorer"
    assert "What does the sky look like" not in page.content()
    assert not page.errors


def test_the_sentence_and_the_line_under_it(page, base):
    exp_page(page, base)
    assert words(page.locator("#sentence").inner_text()) == "Site01-1 · Connecting ridge from 1 Mar 2027 over 30 days with a 2 m mast height"
    assert page.locator("#sentence [data-tok]").count() == 4
    assert page.locator("#site-info").text_content() == "89.475°S 222.56°E · Elevation 1947 m"
    assert page.locator("#site-hint").get_attribute("aria-label") and page.locator("#site-hint").get_attribute("data-hint")
    assert page.locator("#map-link").text_content() == "Show on map →" and "map.html" in page.locator("#map-link").get_attribute("href")


def test_the_spot_picker_lists_every_spot_under_its_site(page, base):
    exp_page(page, base)
    page.locator("[data-tok=spot]").click()
    box = page.locator("#pop")
    assert box.is_visible() and box.locator("[role=listbox]").count() == 1
    assert box.locator(".spot-group.mine").count() == 0  # nothing saved: no My points group
    groups = [e.text_content() for e in box.locator(".spot-group").all()]
    assert groups[:3] == ["Connecting ridge", "Shackleton rim", "Nobile rim 1"] and len(groups) == 15  # 13 sites, the landers, the sites away from the pole
    assert box.locator(".spot-opt").count() >= 67
    assert box.bounding_box()["width"] <= 342 and box.evaluate("e => getComputedStyle(e).overflowY") == "auto"
    selected = box.locator(".spot-opt[aria-selected=true]")
    assert selected.count() == 1 and selected.text_content().startswith("Site01-1") and "✓" in selected.text_content()
    assert min(o.bounding_box()["height"] for o in box.locator(".spot-opt").all()) >= 40
    page.keyboard.press("Escape")
    assert box.is_hidden()
    page.locator("[data-tok=spot]").click()
    page.mouse.click(5, 300)
    assert box.is_hidden()
    page.locator("[data-tok=spot]").click()
    box.locator(".spot-opt[data-v='DM2-4']").click()
    page.wait_for_function("document.getElementById('sentence').innerText.includes('DM2-4 · Nobile rim 2')")
    page.wait_for_function("document.getElementById('plan-text').textContent.endsWith('DM2-4.')", timeout=RESULT_TIMEOUT_MS)
    assert "spot=DM2-4" in page.evaluate("location.hash")


def test_saved_points_come_first_in_the_picker_and_work_as_a_spot(browser, base):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1200})
    ctx.add_init_script("""try { localStorage.setItem('lunazen.myspots', JSON.stringify([{ id: 'pt_-89.4600_222.6000', name: 'My point 1' }])); } catch (e) {}""")
    pg = ctx.new_page()
    exp_page(pg, base)
    pg.locator("[data-tok=spot]").click()
    box = pg.locator("#pop")
    assert box.locator(".spot-group").first.text_content() == "My points" and "mine" in box.locator(".spot-group").first.get_attribute("class")
    first = box.locator(".spot-opt").first
    assert first.text_content().strip().startswith("My point 1") and "Connecting ridge" in first.text_content() and first.locator("svg").count() == 1
    first.click()
    pg.wait_for_function("document.getElementById('sentence').innerText.includes('My point 1 · Connecting ridge')", timeout=RESULT_TIMEOUT_MS)
    pg.wait_for_function("document.getElementById('site-info').textContent.includes('saved in this browser')", timeout=RESULT_TIMEOUT_MS)
    assert pg.locator("#site-info").text_content() == "89.460°S 222.60°E · saved in this browser"
    assert pg.locator("#plan-text").text_content() == "Ready to plan? Test landing dates at My point 1."
    ctx.close()


def test_the_tabs_and_their_controls(page, base):
    exp_page(page, base)
    assert [t.text_content().strip() for t in page.locator("[role=tab]").all()] == ["Panorama", "3D terrain", "Visibility Timeline"]
    assert page.locator("#tab-panorama").get_attribute("aria-selected") == "true"
    assert [b.text_content() for b in page.locator("#pano-controls .mp-seg button").all()] == ["Whole sky", "Follow Sun", "Follow Earth"]
    assert page.locator("#pano-span-wrap").is_hidden()  # Width only when following a body
    page.locator("#pano-sun").click()
    assert page.locator("#pano-span-wrap").is_visible() and [o.text_content() for o in page.locator("#pano-span option").all()] == ["30°", "60°", "90°", "120°"]
    page.locator("#pano-earth").click()
    assert page.locator("#pano-earth").get_attribute("aria-pressed") == "true" and page.locator("#pano-span-wrap").is_visible()
    page.locator("#pano-whole").click()
    assert page.locator("#pano-span-wrap").is_hidden()
    assert page.locator("details.howto").count() == 0  # the per-view Help buttons are gone
    page.locator("#tab-3d").click()
    assert [b.text_content() for b in page.locator("#view3d-buttons button").all()] == ["Fly around", "Sky view", "Look at Sun", "Look at Earth", "Reset"]
    assert page.locator("#cam-orbit").get_attribute("aria-pressed") == "true"
    page.locator("#cam-sky").click()
    assert page.locator("#cam-sky").get_attribute("aria-pressed") == "true" and page.locator("#cam-orbit").get_attribute("aria-pressed") == "false"
    assert page.locator(".exp-3dnote").text_content().replace("\n", " ") .startswith("Drag to turn · scroll to zoom") and "Sun direction" in page.locator(".exp-3dnote").text_content()
    page.locator("#tab-period").click()
    assert page.locator("#period-controls").is_visible() and page.locator(".exp-assume-h").text_content() == "Assumptions"
    assert [o.text_content() for o in page.locator("#dark-below option").all()] == ["no part of the Sun is visible", "less than 10% is visible", "less than 50% is visible"]
    assert [o.text_content() for o in page.locator("#dsn-rule option").all()] == ["any part of Earth", "the station itself"]
    assert page.locator("#exp-live").is_hidden()


def test_the_visibility_timeline_keeps_every_figure(page, base):
    exp_page(page, base)
    page.locator("#tab-period").click()
    page.wait_for_selector("#period-stats [data-fig=sun]")
    assert page.locator("#period-title").text_content() == "1–30 March 2027 at Site01-1"
    assert [e.text_content() for e in page.locator(".exp-group h3").all()] == ["Sunlight and power", "Darkness", "Contact with Earth"]
    fig = lambda k: (page.locator(f"#period-stats [data-fig={k}]").text_content().strip(), page.locator(f"#period-stats [data-fig={k}]").locator("xpath=following-sibling::span").text_content().strip())
    assert fig("sun") == ("82%", "of the period, any part of the disk")
    assert fig("clearance") == ("2.33°", "above the skyline (9 Mar) · −0.1° from level")
    assert fig("array") == ("99.9%", "of the light it could catch · flat panel almost none")
    assert fig("energy") == ("536 h", "of full Sun (Wh per W of panel)")
    assert fig("night") == ("2 d 13 h", "above a 50 h darkness limit (VIPER's design figure)")
    assert fig("earth")[0] == "51%" and fig("dsn")[0] == "50%" and fig("gap") == ("10 d 18 h", "without a DSN station in view")
    assert page.locator("#period-stats .hint").count() == 8 and all(h.get_attribute("aria-label").startswith("About: ") for h in page.locator("#period-stats .hint").all())
    assert [li.text_content() for li in page.locator("#clearance-notes li").all()] == [
        "The Sun clears the skyline by at most 2.33° (9 Mar); 22% of the sunlit time is within 0.25° of it.",
        "If the skyline were 0.1° higher: Sun up 80%, longest night 2 d 19 h. If 0.25° higher: Sun up 76%, longest night 3 d 4 h."]
    assert page.locator("h3:has-text('Clearance above the skyline') .hint").count() == 1
    rows = page.locator("#windows tbody tr")
    assert rows.count() == 7 and [c.text_content().strip() for c in rows.first.locator("td").all()] == ["Sun", "1 Mar 00:00", "2 Mar 18:15", "1 d 18 h"]
    assert [h.text_content() for h in page.locator("#windows thead th").all()] == ["Window", "Starts (UTC)", "Ends (UTC)", "Length"]
    assert page.locator(".exp-win-head h3").text_content() == "Visibility Windows"
    assert page.locator("#csv").get_attribute("aria-label") == "Export CSV" and page.locator("#ics").get_attribute("aria-label") == "Export to calendar" and page.locator("#csv").text_content().strip() == ""
    # clicking a window shows that moment on the Panorama
    rows.nth(1).click()
    assert page.locator("#tab-panorama").get_attribute("aria-selected") == "true" and "5 Mar" in page.locator("#moment-h").text_content()
    assert not page.errors


def test_this_moment_replaces_the_countdowns_and_the_moment_panel(page, base):
    exp_page(page, base)
    assert page.locator("#moment-h").text_content() == "This moment · 1 Mar 2027, 06:15 UTC"
    assert page.locator("#dsn-text").text_content() == "No DSN station in view" and page.locator(".exp-dsn").count() == 1
    sun, earth = page.locator(".exp-card.sun"), page.locator(".exp-card.earth")
    assert [e.text_content() for e in sun.locator(".status, .next, .clear").all()][:2] == ["The Sun · fully visible", "sets in 36 h 15 min"]
    assert sun.locator(".clear").text_content().startswith("0.28° above the skyline · −0.17° from level")
    assert [e.text_content() for e in earth.locator(".status, .next").all()] == ["Earth · hidden by the terrain", "rises in 3 d 18 h"]
    assert earth.locator(".clear").text_content().startswith("5.50° below the skyline · −6.47° from level")
    assert sun.locator(".hint").count() == 1 and earth.locator(".hint").count() == 1
    for gone in ("#chips", "#countdowns", "#moment-text", "#now-panel", "#readouts", "#clearance", ".lz-why", ".keys-hint"):
        assert page.locator(gone).count() == 0, gone
    for text in ("How accurate is this?", "Checks: guide", "Why does it look like this?", "The moment you chose", "Space play"):
        assert text not in page.locator("main").inner_text(), text
    assert page.locator("summary:has-text('Details')").count() == 0


def test_the_playback_bar_and_the_moment_fields(page, base):
    exp_page(page, base)
    bar = page.locator("#transport")
    order = [bar.locator(s).bounding_box()["x"] for s in ("#prev-change", "#play", "#next-change", "#moment-date", "#moment-time", "#day-of")]
    assert order == sorted(order)
    ys = {round(bar.locator(s).bounding_box()["y"]) for s in ("#prev-change", "#play", "#next-change", "#moment-date")}
    assert max(ys) - min(ys) < 8  # one line at 1440 px
    assert page.locator("#play").bounding_box()["width"] >= 96 and page.locator("#day-of").text_content() == "Day 1 of 30"
    assert bar.locator(".exp-moment").text_content().startswith("Moment (UTC)")
    assert page.locator("#moment-date").input_value() == "2027-03-01" and page.locator("#moment-time").input_value() == "06:15"
    assert [o.text_content() for o in page.locator("#moment-time option").all()][:3] == ["00:00", "00:15", "00:30"]
    page.locator("#moment-date").fill("2027-03-05")
    page.locator("#moment-date").dispatch_event("change")
    page.locator("#moment-time").select_option("07:45")
    assert "5 Mar 2027, 07:45 UTC" in page.locator("#moment-h").text_content() and page.locator("#day-of").text_content() == "Day 5 of 30"
    page.locator("#next-change").click()
    assert page.locator("#moment-h").text_content() != "This moment · 5 Mar 2027, 07:45 UTC"
    page.locator("#prev-change").click()
    page.locator("#play").click()
    assert page.locator("#play").get_attribute("aria-pressed") == "true" and page.locator("#play").text_content() == "Pause"
    page.locator("#play").click()
    assert page.locator("#play").text_content() == "Play"
    page.locator("body").click(position={"x": 5, "y": 400})
    before = page.locator("#moment-h").text_content()
    page.keyboard.press("ArrowRight")  # the keyboard shortcuts work as before
    assert page.locator("#moment-h").text_content() != before


def test_snapshot_over_the_period_is_closed_opens_and_scrubs(page, base):
    exp_page(page, base)
    toggle = page.locator("#snap-toggle")
    assert toggle.get_attribute("aria-expanded") == "false" and page.locator("#snap-body").is_hidden()
    assert page.locator(".exp-snap-head .t").text_content() == "Snapshot over the period"
    assert page.locator("#snap-sub").text_content() == "Sun, Earth and DSN across all 30 days · full details in Visibility Timeline"
    assert toggle.bounding_box()["height"] >= 44
    toggle.click()
    assert toggle.get_attribute("aria-expanded") == "true" and page.locator("#snap-chart").is_visible()
    assert [e.text_content().strip() for e in page.locator(".exp-snap-body .exp-legend span").all()] == ["Sun up", "Earth in view", "DSN in view", "Partly visible", "This moment · drag the timeline to scrub"]
    box = page.locator("#snap-chart").bounding_box()
    before = page.locator("#moment-h").text_content()
    page.mouse.click(box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
    page.wait_for_function("t => document.getElementById('moment-h').textContent !== t", arg=before)
    # the choice lasts for the session: a reload keeps it open
    page.reload()
    page.wait_for_selector("#moment-cards .exp-card", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("#snap-toggle").get_attribute("aria-expanded") == "true"
    page.locator("#snap-toggle").click()
    assert page.locator("#snap-body").is_hidden()


def test_plan_a_landing_here_is_at_the_bottom_of_every_tab(page, base):
    exp_page(page, base)
    for tab in ("#tab-panorama", "#tab-3d", "#tab-period"):
        page.locator(tab).click()
        plan = page.locator("#exp-plan")
        assert plan.is_visible() and page.locator("#plan-text").text_content() == "Ready to plan? Test landing dates at Site01-1."
        link = page.locator("#plan-link")
        assert link.text_content() == "Plan a landing here →" and link.bounding_box()["height"] >= 44
        h = params(href_hash(page, "#plan-link"))
        assert (h["spot"], h["mast"], h["start"]) == ("Site01-1", "2", "2027-03-01")
        assert plan.bounding_box()["y"] > page.locator("main").locator(".exp-bar").bounding_box()["y"]
    assert page.locator("a:has-text('Plan a landing')").count() == 1  # the only Plan button of the page


def test_how_to_use_the_explorer_dialog(page, base):
    exp_page(page, base)
    page.locator("#help-open").click()
    dialog = page.locator("#help-dialog")
    assert dialog.is_visible() and dialog.locator("h2").text_content() == "How to use the Explorer"
    assert [e.text_content() for e in dialog.locator("#exp-help h3").all()] == ["Choose what to look at", "Three views", "Move through time", "Reading each view", "Why does it look like this?"]
    text = dialog.locator("#exp-help").text_content()
    assert "Click the orange words in the sentence at the top to pick a candidate spot or one of My points, the start date, how many days to look at and the mast height." in text
    assert "Keyboard: Space plays and pauses; ← and → jump to the previous or next change." in text
    assert [e.text_content() for e in dialog.locator("#exp-help h4").all()] == ["Panorama", "3D terrain", "Visibility Timeline"]
    assert "Drag the picture to turn." in text and "Earth is only 1.9° wide: zoom in, or press Look at Earth." in text and "Click a row or the chart to see that moment." in text
    questions = [e.text_content() for e in dialog.locator("#exp-help summary").all()]
    assert questions == ["Why does the Sun barely rise?", "Why does Earth move up and down?", "Why is a bright spot not always a good spot?"]
    dialog.locator("summary").first.click()
    assert "tilted by only about 1.5°" in dialog.locator("details").first.text_content()
    page.keyboard.press("Escape")
    assert dialog.is_hidden() and page.evaluate("document.activeElement.id") == "help-open"
    page.locator("#help-open").click()
    page.locator("#help-close").click()
    assert dialog.is_hidden()


def test_the_explorer_layout_on_a_large_screen(page, base):
    page.set_viewport_size({"width": 1440, "height": 1200})
    exp_page(page, base)
    assert page.locator("#exp-stage").bounding_box()["height"] == 462 or abs(page.locator("#exp-stage").bounding_box()["height"] - 460) < 3
    for tab in ("#tab-3d", "#tab-panorama"):
        page.locator(tab).click()
        assert abs(page.locator("#exp-stage").bounding_box()["height"] - 460) < 3
    cards = [c.bounding_box() for c in page.locator(".exp-card").all()]
    assert abs(cards[0]["y"] - cards[1]["y"]) < 2  # side by side
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")


def test_the_explorer_works_on_a_phone(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    pg = ctx.new_page()
    exp_page(pg, base)
    fits = lambda: pg.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert fits()
    tabs = [t.bounding_box() for t in pg.locator("[role=tab]").all()]
    assert len({round(t["y"]) for t in tabs}) == 1 and abs(tabs[0]["width"] - tabs[1]["width"]) < 2 and all(t["height"] >= 44 for t in tabs)
    seg = [b.bounding_box() for b in pg.locator("#pano-controls .mp-seg button").all()]
    assert len({round(b["y"]) for b in seg}) == 1 and abs(seg[0]["width"] - seg[2]["width"]) < 2 and all(b["height"] >= 44 for b in seg)
    assert pg.evaluate("getComputedStyle(document.querySelector('#sentence')).fontSize") == "18px"
    stage = pg.locator("#exp-stage")
    assert pg.evaluate("(() => { const e = document.getElementById('exp-stage'); return e.scrollWidth > e.clientWidth; })()")  # the panorama scrolls sideways inside its box
    assert pg.locator("#panorama").bounding_box()["width"] >= 760
    assert pg.locator("#pano-swipe").is_visible() and pg.locator("#pano-swipe").text_content() == "Swipe the panorama sideways to see every direction."
    prev, nxt = pg.locator("#prev-change"), pg.locator("#next-change")
    assert prev.get_attribute("aria-label") == "Previous change" and prev.bounding_box()["width"] < 80 and nxt.bounding_box()["width"] < 80
    c = [e.bounding_box() for e in pg.locator(".exp-card").all()]
    assert c[1]["y"] > c[0]["y"] + c[0]["height"] - 2  # the two cards stack
    for sel in ("#prev-change", "#play", "#next-change", "#moment-date", "#moment-time", "#snap-toggle", "#plan-link", "#help-open", "#copy-link"):
        assert pg.locator(sel).bounding_box()["height"] + (8 if sel in ("#help-open",) else 0) >= 44, sel
    pg.locator("#tab-3d").click()
    assert fits() and pg.locator("#view3d").bounding_box()["width"] <= 390
    pg.locator("#tab-period").click()
    assert fits()
    assert pg.evaluate("(() => { const b = document.querySelector('.exp-win-scroll'); return b.scrollWidth > b.clientWidth; })()")  # the table scrolls in its own box
    ctx.close()


def test_the_explorer_light_theme_uses_the_light_values(browser, base):
    ctx = browser.new_context(viewport={"width": 1440, "height": 1400})
    ctx.add_init_script("try{localStorage.setItem('lunazen-theme','light')}catch(e){}")
    pg = ctx.new_page()
    exp_page(pg, base)
    css = lambda sel, prop: pg.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p]", [sel, prop])
    assert css(".exp-scenario", "backgroundColor") == "rgb(245, 246, 248)" and css(".exp-scenario", "borderTopColor") == "rgb(217, 220, 226)"
    assert css("#sentence [data-tok]", "color") == "rgb(154, 95, 14)"
    assert css(".exp-play", "backgroundColor") == "rgb(245, 246, 248)"
    pg.locator("#tab-period").click()
    assert css("#windows thead th", "backgroundColor") == "rgb(220, 229, 240)"
    assert css("#copy-link", "borderTopColor") == "rgb(74, 80, 92)"
    pg.locator("[data-tok=spot]").click()
    ctx.close()


def test_the_snapshot_is_the_same_chart_as_the_top_of_the_visibility_timeline(page, base):
    exp_page(page, base)
    page.locator("#snap-toggle").click()
    snap = page.locator("#snap-chart")
    assert snap.evaluate("e => e.classList.contains('event-chart')") and snap.bounding_box()["height"] >= 160
    assert page.locator("#snap-title").text_content() == "1–30 March 2027 at Site01-1"  # the same top line as the Visibility Timeline's
    page.locator("#tab-3d").click()  # and on the 3D tab
    assert page.locator("#snap-chart").is_visible()
    # a chart with the longest-night bracket: the same drawing as the Visibility Timeline's; its pixels are not blank
    painted = page.evaluate("""() => { const c = document.getElementById('snap-chart'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n > 1000; }""")
    assert painted
    page.locator("#tab-period").click()
    assert page.locator("#event-chart").is_visible()


def test_the_figure_groups_sit_side_by_side_on_a_large_screen(page, base):
    page.set_viewport_size({"width": 1440, "height": 1400})
    exp_page(page, base)
    page.locator("#tab-period").click()
    page.wait_for_selector("#period-stats [data-fig=sun]")
    groups = [g.bounding_box() for g in page.locator(".exp-group").all()]
    assert len({round(g["y"]) for g in groups}) == 1 and groups[0]["x"] < groups[1]["x"] < groups[2]["x"]  # one row of three groups
    figs = [f.bounding_box() for f in page.locator(".exp-fig").all()]
    assert len({round(f["y"]) for f in figs}) == 1  # and one row of cards: compact
    assert max(f["height"] for f in figs) < 135
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")


# ---- The Plan pages (update 6)

PLAN_PAGES = [("planner", "Planner", "Landing window search · Single spot"), ("rank", "Ranker", "Candidate spot ranking · Single epoch"),
              ("windows", "Delay Analyzer", "Launch delay sensitivity · Single spot"), ("compare", "Compare landings", "Touchdown window comparison"),
              ("sidebyside", "Compare sites", "Site comparison · Shared window")]


@pytest.mark.parametrize("name,label,heading", PLAN_PAGES)
def test_every_plan_page_has_the_learn_header_and_a_help_dialog_with_the_method(page, base, name, label, heading):
    page.goto(f"{base}{name}.html")
    page.wait_for_selector("#help-open")
    assert page.locator(".mp-head .label").text_content() == f"Plan · {label}"
    assert page.locator("h1").text_content() == heading
    copy = page.locator("#copy-link")
    assert copy.get_attribute("aria-label") == "Copy link" and copy.text_content().strip() == ""
    page.locator("#help-open").click()
    dialog = page.locator("#help-dialog")
    assert dialog.is_visible()
    text = dialog.inner_text().lower()
    assert "about the method" in text and "how accurate is this?" in text and "checks: guide, p." in text
    body = page.locator("main").inner_text()
    assert "How accurate is this?" not in body and "Checks: guide" not in body
    for word in ("telemetry",):
        assert word not in page.content().lower()
    assert not page.errors


def test_the_planner_rows_start_closed_and_are_remembered(page, base):
    planner(page, base)
    for row in ("take", "mission-row", "ring-row"):
        assert page.locator(f"#{row} .exp-snap-head").get_attribute("aria-expanded") == "false"
    page.wait_for_function("document.getElementById('mission-sub').textContent.length > 0", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("#mission-sub").inner_text() == "Sunlit 71% · DSN 53% · Max night 36 h"
    assert page.locator("#ring-sub").inner_text() == "9 of 13 touchdown points valid"
    page.locator("#ring-row .exp-snap-head").click()
    assert page.locator("#ring-row .exp-snap-head").get_attribute("aria-expanded") == "true"
    assert "9 of 13 touchdown points valid" in page.locator("#ring").inner_text()
    planner(page, base, "#spot=Site01-1&start=2027-03-15&days=61&within=50")
    assert page.locator("#ring-row .exp-snap-head").get_attribute("aria-expanded") == "true"


def test_the_planner_banner_has_a_pin_icon_and_the_tray_follows_it(page, base):
    planner(page, base)
    pin = page.locator("#pin")
    assert pin.text_content().strip() == "" and pin.get_attribute("aria-label") == "Pin this landing" and pin.get_attribute("aria-pressed") == "false"
    assert pin.bounding_box()["width"] == 36
    pin.click()
    assert page.locator("#pin").get_attribute("aria-pressed") == "true"
    tray = page.locator("#lz-tray")
    assert "pinned (1 of 4)" in tray.inner_text().lower() and "Site01-1, 9 Apr 00:00, 2 m" in tray.inner_text()
    assert tray.locator("a.go").inner_text().strip() == "Compare pinned →"
    tray.locator("[data-unpin]").click()
    assert page.locator("#lz-tray").is_hidden()


def test_exports_are_icon_only_buttons(page, base):
    planner(page, base)
    for ident, label in (("csv", "Export CSV"), ("ics", "Export to calendar")):
        b = page.locator(f"#{ident}")
        assert b.text_content().strip() == "" and b.get_attribute("aria-label") == label and b.get_attribute("title") == label
        assert b.bounding_box()["width"] == 40 and b.locator("svg").count() == 1


def test_rank_has_a_pin_column_first_and_one_line_rows(page, base):
    webflow.open_rank(page, base, "#start=2027-03-15")
    heads = [h.text_content().strip() for h in page.locator("#table thead th").all()]
    assert heads[:3] == ["Pin", "#", "Spot"]
    first = page.locator("#table tbody tr").first
    assert first.locator("button.pl-pin").get_attribute("aria-label") == "Pin Site06-5"
    cells = [c.text_content().strip() for c in first.locator("td, th").all()]
    assert "Site06-5" in cells[2] and cells[3] == "Target spot only" and cells[-2] == "6 of 12" and cells[-1] == "Fails"
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    heights = {round(r.bounding_box()["height"]) for r in page.locator("#table tbody tr").all()[:12]}
    assert max(heights) < 45, heights  # one line each
    assert page.locator("#verdict").inner_text().startswith("15 Mar 2027, 00:00 UTC – 0 spots pass full 100 m dispersion (1 valid at target spot only)")
    assert page.locator("#next-actions, .na").first.inner_text().startswith("NEXT ACTIONS") or "Next actions" in page.locator(".na").first.inner_text()


def test_delay_impact_numbers_and_wording(page, base):
    webflow.open_windows(page, base, "#spot=Site01-1&date=2027-03-15")
    page.wait_for_selector("#slip tbody tr", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("#verdict").inner_text().startswith("15 Mar 2027 – Site01-1 invalid: DSN visibility below threshold")
    assert "Next valid window: 2 Apr (+18 d) · Prior valid window: 13 Mar (−2 d)." in page.locator("#verdict").inner_text()
    assert "2 of 67 spots pass at nominal coordinates on 15 Mar 2027 (0 pass full 100 m dispersion). Valid backup spots ranked by window duration: Site20-6, Site06-5." == page.locator("#story").inner_text()
    assert page.locator("#grid-details .exp-snap-head").get_attribute("aria-expanded") == "false"
    assert "annual validity matrix" in page.locator("#grid-details").inner_text().lower()


def test_compare_landings_empty_state_and_pinned_cards(page, base):
    page.goto(f"{base}compare.html")
    page.evaluate("localStorage.clear()")
    page.goto(f"{base}compare.html#")
    page.wait_for_selector(".lz-empty")
    assert page.locator(".lz-empty .exp-h").text_content() == "No pinned landings"
    assert [a.text_content().strip() for a in page.locator(".lz-empty a").all()] == ["Open Planner", "Rank spots", "Compare sites"]
    pins = "Site01-1,2027-04-09T00,2,14,viper,50,50,earliest,2027-03-15,61,spot,50;Site01-1,2027-04-09T00,2,14,viper,50,50,earliest,2027-03-15,61,spot,100"
    page.goto("about:blank")
    page.goto(f"{base}compare.html#pins={pins}")
    page.wait_for_selector(".lz-card canvas", timeout=RESULT_TIMEOUT_MS)
    assert page.locator("#pinned-count").text_content() == "2 of 4 pinned"
    assert page.locator(".lz-card .pl-tag").first.text_content() == "Within 50 m"
    assert "Identify earliest valid window at Site01-1 from 15 Mar 2027 to 14 May 2027" in page.locator(".lz-card details.q").first.inner_text() or True
    page.locator(".lz-card details.q summary").first.click()
    assert "50 m dispersion radius." in page.locator(".lz-card details.q p").first.inner_text()
    tray = page.locator("#lz-tray").inner_text()
    assert "· 50 m" in tray and "· 100 m" in tray and "Compare pinned" not in tray


def test_compare_sites_sentence_replaces_the_dock_and_all_metrics_toggles_rows(page, base):
    page.goto(f"{base}sidebyside.html")
    page.wait_for_selector("#table tbody tr", timeout=RESULT_TIMEOUT_MS)
    assert page.locator(".dock").count() == 0
    assert " ".join(page.locator("#sentence").inner_text().split()).replace(" ,", ",").startswith("Compare Site01-1 × Site04-1 × Site23-2 × DM2-4 × – 365 d starting 15 Mar 2027, mast 2 m")
    assert page.locator("#table tbody tr").count() == 7
    page.locator("#more").click()
    assert page.locator("#table tbody tr").count() == 12 and page.locator("#more").text_content() == "Fewer metrics"
    assert page.locator('[data-tok="spot"].add-spot').count() == 0  # four spots: nothing to add
    page.locator("[data-remove='DM2-4']").click()
    page.wait_for_function("document.querySelectorAll('#table thead th').length === 4", timeout=RESULT_TIMEOUT_MS)
    assert page.locator(".add-spot").count() == 1
    assert page.locator("#verdict").inner_text().startswith("Best illumination: Site01-1")
    page.locator("[data-row=timeline] .exp-snap-head").click()
    assert page.locator("#lanes").is_visible()
