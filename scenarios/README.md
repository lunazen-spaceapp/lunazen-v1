# Scenarios

Re-runnable walks through the app in a real browser, for exploring what a planner sees. They are not tests: a scenario prints a numbered log of what each page shows (verdicts, tiles, table rows, exports) and asserts nothing, so you can change the spots, dates and rules, add steps, and compare logs between versions of the app. The assertions live in `tests/test_web_flows.py`.

Needs Playwright and Google Chrome (or Chromium). `scenarios/webflow.py` holds what both share: serving `web/`, starting the browser, and waiting for a page to finish computing.

```bash
uv run python scenarios/slip_planning.py                       # print the log
uv run python scenarios/slip_planning.py --headed              # watch it
uv run python scenarios/slip_planning.py --shots /tmp/slip     # a screenshot per step
uv run python scenarios/slip_planning.py --json /tmp/slip.json # the log as JSON
```

## slip_planning.py

A lander planned for DM2-4 on 7 April 2027 (a 50 h darkness limit, 14-day mission, DSN in view at least 50%, 2 m mast) slips.

1. Planner: the baseline landing, its verdict and the 13-point ring.
2. Delay impact: does DM2-4 still work if the landing slips 14, 28 or 60 days, how long it keeps working, when the next window opens.
3. Rank: which spots work on a slipped day.
4. Planner and Compare landings: pin the next DM2-4 window and two other candidates, shift every pin by 9 and by 30 days (a lunar month is 29.5 days), export the decision record.
5. Launch windows: every robust landing at two spots from September to December 2027, Rank on a spring and an autumn date, the Blue Ghost 1 (5 h) and a 150 h rule.

The constants at the top of the file (`SPOT`, `PLANNED`, `SLIPS_DAYS`, `ALTERNATIVES`, `LANDER`) are the knobs. To add a scenario, copy the file, change the steps, and use `Log.step(title, page, **facts)` to record what you read.
