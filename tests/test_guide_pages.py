"""Every #page=N link in the app opens the section it names, in the User Guide as built (needs pdftotext)."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "docs" / "learn" / "lunazen_guide.pdf"
LINKS = (ROOT / "web" / "app" / "links.js").read_text()

pytestmark = pytest.mark.skipif(shutil.which("pdftotext") is None or shutil.which("pdfinfo") is None, reason="needs poppler (pdftotext)")


def page_text(pdf, n):
    return subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), str(pdf), "-"], capture_output=True, text=True, check=True).stdout


def pages(pdf):
    return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout).group(1))


def test_guide_page_numbers_match_the_built_pdf():
    stored = {k: int(v) for k, v in re.findall(r"^\s+(summary|series|method|limits):\s*(\d+)", LINKS, re.M)}
    assert set(stored) == {"summary", "series", "method", "limits"}
    heading = {"series": "Plan tab", "method": "Where the numbers come from", "limits": "Modelling assumptions and limitations"}
    for key, text in heading.items():
        assert text in page_text(PDF, stored[key]), f"{key}: page {stored[key]} does not hold '{text}'"
    assert "Overview at a Glance" in page_text(PDF, stored["summary"])


def test_the_page_count_in_links_js_matches_the_pdf():
    assert int(re.search(r"GUIDE_PAGE_COUNT = (\d+)", LINKS).group(1)) == pages(PDF)
