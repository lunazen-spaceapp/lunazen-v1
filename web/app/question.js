// The question of a planning page as state: the sentence, its tokens, the trail of changes and the address. Rank, Windows and the Explorer use it; the Planner keeps the same behaviour in its own code. A change from a
// token editor is a new step of the trail and a new history entry, so the browser's Back button walks the same trail; the
// page's `run(state, { before })` recomputes the answer.

import { sentenceHtml, trailHtml } from "./components.js";
import { createTokens } from "./query.js";

// els: { sentence, trail, pop }; ctx: { catalog, rankHref }; parse(hash) -> state; serialize(state) -> hash;
// segments(state) -> the sentence; keyOf(patch) -> the token that changed; normalize(state) -> state; run(state, { before }).
export function createQuestion({ els, ctx, parse, serialize, segments, keyOf, normalize = (s) => s, reset = {}, run, summary = () => null, delay = 250 }) {
  let state = normalize(parse(location.hash));
  let trail = [{ label: "Start", hash: serialize(state) }];
  let at = 0;
  let changed = null;
  let focusKey = null;
  let timer = null;
  let before = null;

  const render = () => {
    const want = focusKey ?? document.activeElement?.dataset?.tok;
    els.sentence.innerHTML = sentenceHtml(segments(state), changed);
    els.trail.innerHTML = trailHtml(trail, at);
    if (want) els.sentence.querySelector(`[data-tok="${want}"]`)?.focus();
  };

  const go = (immediately = false) => {
    clearTimeout(timer);
    render();
    timer = setTimeout(() => { run(state, { before, changed }); focusKey = null; }, immediately ? 0 : delay);
  };

  const change = (patch, label) => {
    const next = normalize({ ...state, ...patch, ...reset }); // reset: what a change clears (the Planner's chosen landing)
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    before = summary();
    state = next;
    changed = keyOf(patch);
    focusKey = changed;
    const hash = serialize(state);
    history.pushState(null, "", hash);
    trail = [...trail.slice(0, at + 1), { label, hash }];
    at = trail.length - 1;
    go();
  };

  const tokens = createTokens({ sentenceEl: els.sentence, popEl: els.pop, getState: () => state, ctx: { ...ctx, apply: change } });

  window.addEventListener("hashchange", () => {
    if (location.hash === serialize(state)) return;
    state = normalize(parse(location.hash));
    const k = trail.findIndex((s) => s.hash === location.hash);
    if (k >= 0) at = k; else { trail = [...trail.slice(0, at + 1), { label: "Link", hash: location.hash }]; at = trail.length - 1; }
    before = null;
    changed = null;
    go(true);
  });
  els.trail.addEventListener("click", (e) => {
    const b = e.target.closest("[data-trail]");
    const k = b ? Number(b.dataset.trail) : at;
    if (k === at) return;
    before = summary();
    changed = null;
    history.pushState(null, "", trail[k].hash);
    state = normalize(parse(trail[k].hash));
    at = k;
    go(true);
  });

  return {
    get state() { return state; },
    // Replace the state without a trail step (a page fixing what a link got wrong, or a user setting that is not a token).
    set(patch) { state = { ...state, ...patch }; history.replaceState(null, "", serialize(state)); },
    start: () => go(true),
    change,
    render,
    tokens,
  };
}
