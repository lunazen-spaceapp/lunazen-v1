"""Helpers shared by the browser flow tests (tests/test_web_flows.py) and the scenarios in this folder.

They serve web/ on a free local port, start Google Chrome (or Chromium) through Playwright and wait for the pages
to finish computing. Nothing here knows about a particular question; a scenario is a list of steps built on them.
"""

import contextlib
import functools
import http.server
import threading

from lunazen.paths import ROOT

WEB = ROOT / "web"
RESULT_TIMEOUT_MS = 90_000


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextlib.contextmanager
def serve(directory=WEB):
    """Serve `directory` and yield its base address, such as http://127.0.0.1:50000/."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()


def launch(playwright, headless=True):
    """Google Chrome if it is installed, else Playwright's Chromium; None when neither can start."""
    for options in ({"channel": "chrome"}, {}):
        try:
            return playwright.chromium.launch(headless=headless, **options)
        except Exception:
            continue
    return None


def _fresh(page):
    """Leave the current page first: a change of address hash alone does not reload it, and a step should start clean."""
    page.goto("about:blank")


def open_planner(page, base, hash_=""):
    _fresh(page)
    page.goto(f"{base}planner.html{hash_}")
    page.wait_for_function("document.getElementById('status') && /evaluated in/.test(document.getElementById('status').innerText)", timeout=RESULT_TIMEOUT_MS)


def open_windows(page, base, hash_=""):
    _fresh(page)
    page.goto(f"{base}windows.html{hash_}")
    page.wait_for_function("document.getElementById('story') && document.getElementById('story').innerText.length > 10", timeout=RESULT_TIMEOUT_MS)


def open_rank(page, base, hash_=""):
    _fresh(page)
    page.goto(f"{base}rank.html{hash_}")
    page.wait_for_selector("#table tbody tr", timeout=RESULT_TIMEOUT_MS)


def text(page, selector):
    """The visible text of the first match, with runs of white space collapsed; empty when absent."""
    loc = page.locator(selector)
    return " ".join(loc.first.inner_text().split()) if loc.count() else ""
