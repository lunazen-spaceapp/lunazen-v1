// A small pool of Web Workers for the heavy tasks of Compare and the Planner (see tasks.js).
// If workers cannot start (an old browser, a blocked script), the same tasks run on the main thread.

import { Ephemeris } from "../engine/index.js";
import { runTask } from "./tasks.js";
import { withCustom } from "./customs.js";

// base: absolute URL of the data folder. local: { ephemeris, catalog } already loaded on the page.
export function createPool(base, local) {
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  let rotation = null;
  const onMainThread = (task) => new Promise((resolve, reject) => setTimeout(async () => {
    try {
      if (task.dsnRule === "station" && !local.ephemeris.rotation) await (rotation ??= Ephemeris.loadRotation(local.ephemeris, base)); // only the station-level DSN test needs it
      resolve(runTask(local, task));
    } catch (error) { reject(error); }
  })); // the timeout lets the page repaint between tasks
  let workers = [];
  try {
    for (let k = 0; k < size; k++) workers.push(new Worker(new URL("./worker.js", import.meta.url), { type: "module" }));
  } catch {
    workers = [];
  }
  if (!workers.length) return { size: 0, run: (task) => onMainThread(withCustom(local.catalog, task)) };

  const idle = [...workers];
  const queue = [];
  const pending = new Map();
  let nextId = 0;
  let broken = false;

  const pump = () => {
    while (idle.length && queue.length) {
      const worker = idle.pop();
      const job = queue.shift();
      const id = ++nextId;
      pending.set(id, { ...job, worker });
      worker.postMessage({ id, base, task: job.task });
    }
  };
  const fallBack = () => { // a worker failed to start: finish everything on the main thread
    broken = true;
    for (const w of workers) w.terminate();
    const jobs = [...pending.values(), ...queue];
    pending.clear();
    queue.length = 0;
    for (const job of jobs) onMainThread(job.task).then(job.resolve, job.reject);
  };
  for (const worker of workers) {
    worker.onerror = fallBack;
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      idle.push(job.worker);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
      pump();
    };
  }
  return {
    size,
    run: (task) => {
      task = withCustom(local.catalog, task);
      return broken ? onMainThread(task) : new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
    },
  };
}
