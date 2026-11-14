// Web Worker: loads the ephemeris and the site catalogue once, then runs tasks (tasks.js).

import { Ephemeris, SiteCatalog } from "../engine/index.js";
import { runTask } from "./tasks.js";

let ready = null;
let rotation = null;

self.onmessage = async ({ data: { id, base, task } }) => {
  try {
    ready ??= Promise.all([Ephemeris.load(base), SiteCatalog.load(base)]).then(([ephemeris, catalog]) => ({ ephemeris, catalog }));
    const ctx = await ready;
    if (task.dsnRule === "station" && !ctx.ephemeris.rotation) await (rotation ??= Ephemeris.loadRotation(ctx.ephemeris, base)); // the Moon-orientation table, only for the station-level DSN test
    self.postMessage({ id, result: runTask(ctx, task) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
