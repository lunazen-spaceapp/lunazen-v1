"""Darkness tolerances with sources: how long real landers survive with the Sun hidden.

A lander's survival depends on its load, heaters, battery and panels, which are rarely
published. How long it lasts in darkness is, for a few vehicles. The app judges survival
by comparing a site's longest dark period (no part of the Sun above the terrain) with
these tolerances, or with a custom number of hours.
"""

VIPER_NOTE = ("VIPER was a rover meant to move to sunlit areas; here 50 h is used as a limit "
              "for a lander that stays in one place.")
DARKNESS_PRESETS = (
    {"id": "bg1", "name": "5 h (Blue Ghost 1, flown)", "hours": 5.0,
     "phrase": "5 h (Blue Ghost 1)", "option": "5 h \u00b7 what Blue Ghost 1 survived after sunset",
     "quote": '"Blue Ghost continued operations for five hours after lunar sunset on March 16" (2025)',
     "basis": '"Blue Ghost continued operations for five hours after lunar sunset on March 16" (2025)',
     "source": "https://www.nasa.gov/news-release/nasa-firefly-invite-media-to-discuss-end-of-blue-ghost-moon-mission/"},
    {"id": "viper", "name": "50 h darkness limit (from VIPER's design)", "hours": 50.0,
     "phrase": "the 50 h limit", "option": "50 h \u00b7 design figure from NASA's VIPER rover",
     "quote": '"The rover cannot endure more than 50 hours of continuous darkness."',
     "basis": '"The rover cannot endure more than 50 hours of continuous darkness." ' + VIPER_NOTE,
     "note": VIPER_NOTE,
     "source": "https://science.nasa.gov/mission/viper/lunar-operations/"},
)
