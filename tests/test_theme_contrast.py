"""The palette in web/app/style.css keeps text readable in both themes: 4.5:1 for text, 3:1 for the large labels and lines."""

import re

import pytest

from lunazen.paths import ROOT

CSS = (ROOT / "web" / "app" / "style.css").read_text()


def block(selector_start):
    """The declarations of the first rule that starts with the given text."""
    i = CSS.index(selector_start)
    return CSS[CSS.index("{", i) + 1 : CSS.index("}", i)]


def tokens(text):
    return dict(re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})", text))


LIGHT = tokens(block(":root {"))
DARK = tokens(block(':root[data-theme="dark"] {'))


def luminance(hex_colour):
    channels = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


TEXT_ON_GROUND = ["--text-strong", "--text", "--text-2", "--text-3", "--text-faint", "--accent"]


@pytest.mark.parametrize("theme,palette", [("light", LIGHT), ("dark", DARK)])
@pytest.mark.parametrize("name", TEXT_ON_GROUND)
@pytest.mark.parametrize("ground", ["--bg", "--bg-2"])
def test_text_reaches_4_5_to_1_on_the_page_grounds(theme, palette, name, ground):
    assert ratio(palette[name], palette[ground]) >= 4.5, (theme, name, ground, ratio(palette[name], palette[ground]))


@pytest.mark.parametrize("theme,palette", [("light", LIGHT), ("dark", DARK)])
def test_the_primary_button_and_selected_states_are_readable(theme, palette):
    assert ratio(palette["--on-accent"], palette["--accent-fill"]) >= 4.5
    assert ratio(palette["--text"], palette["--accent-bg"]) >= 4.5
    assert ratio(palette["--accent"], palette["--accent-bg"]) >= 4.5
    assert ratio(palette["--accent-line"], palette["--bg"]) >= 3  # lines and the active-nav underline


TABLE_TEXT = [("--tbl-head-text", "--tbl-head"), ("--pass-text", "--pass-bg"), ("--rep-text", "--rep-bg"), ("--tag-text", "--tag-bg"), ("--src-text", "--bg"), ("--cat-text", "--bg")]


@pytest.mark.parametrize("theme,palette", [("light", LIGHT), ("dark", DARK)])
@pytest.mark.parametrize("text,ground", TABLE_TEXT)
def test_the_resources_table_text_is_readable(theme, palette, text, ground):
    assert ratio(palette[text], palette[ground]) >= 4.5, (theme, text, ground, ratio(palette[text], palette[ground]))


MAP_TEXT = [("--text-strong", "--mp-side"), ("--text-2", "--mp-side"), ("--text-3", "--mp-side"), ("--mp-earth", "--mp-side"), ("--mp-sub", "--mp-side"), ("--accent", "--mp-side"),
            ("--text-strong", "--mp-sel"), ("--mp-earth", "--mp-sel"), ("--text-strong", "--mp-card"), ("--text-3", "--mp-card"), ("--text-strong", "--mp-tile"),
            ("--tip-text", "--tip-bg"), ("--ok-card-text", "--ok-card-bg"), ("--text-strong", "--ok-card-bg"), ("--err-mark", "--err-bg"), ("--text-strong", "--err-bg"),
            ("--text-strong", "--saved-bg"), ("--full-text", "--full-bg"), ("--moon-accent", "--moon-panel"), ("--moon-accent", "--exp-panel"), ("--text-3", "--exp-panel"), ("--text-2", "--exp-panel"), ("--text-strong", "--exp-card"), ("--text-3", "--exp-card"), ("--text-2", "--exp-card"), ("--text-2", "--bg-2"), ("--text-3", "--bg-2"), ("--moon-accent", "--bg"), ("--mp-earth", "--moon-panel"), ("--text-3", "--moon-panel"), ("--text-2", "--moon-panel"), ("--text-faint", "--moon-panel"), ("--text-faint", "--bg"), ("--moon-icon", "--bg"), ("--ok-card-text", "--mp-tile")]


@pytest.mark.parametrize("theme,palette", [("light", LIGHT), ("dark", DARK)])
@pytest.mark.parametrize("text,ground", MAP_TEXT)
def test_the_map_sidebar_band_and_message_boxes_are_readable(theme, palette, text, ground):
    assert ratio(palette[text], palette[ground]) >= 4.5, (theme, text, ground, ratio(palette[text], palette[ground]))


@pytest.mark.parametrize("theme,palette", [("light", LIGHT), ("dark", DARK)])
def test_the_saved_diamond_in_its_box_is_a_visible_mark(theme, palette):
    """The ◆ is a graphic that repeats the words beside it, so 3:1 is the bar."""
    assert ratio(palette["--saved-mark"], palette["--saved-bg"]) >= 3
