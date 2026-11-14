// The engine side of the Windows page: one spot, one year, from the browser engine. Used by
// pipeline/export_windows.mjs and by the test that checks the file is not stale (the page itself only reads the file).

import { parseUtc } from "../engine/index.js";
import { runTask } from "./tasks.js";
import { WINDOW_RULE } from "./windows-data.js";

// One year of one spot, from the engine: a code for each day of the year (see dayCodes). The same task the page runs in its workers.
export function windowsForSpot(ctx, spotId, year, rule = WINDOW_RULE) {
  const et0 = parseUtc(`${year}-01-01T00:00:00`);
  const days = Math.round((parseUtc(`${year + 1}-01-01T00:00:00`) - et0) / 86400);
  return runTask(ctx, { kind: "windows", spot: spotId, mast: rule.mastM, et0, days, rule }).codes;
}
