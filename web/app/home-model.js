// The words of the Home animation's status row, from a body's visible fraction. Pure, so the three states are tested.

// state: "up" (the whole disk is above the terrain), "part" (some of it is), "behind" (none of it is).
export function visibility(fraction) {
  if (!(fraction > 0)) return { state: "behind", percent: 0 };
  if (fraction >= 0.995) return { state: "up", percent: 100 };
  return { state: "part", percent: Math.min(99, Math.max(1, Math.round(fraction * 100))) };
}

// "Sun · up", "Sun · 40% visible", "Sun · behind the terrain"; Earth says "in view" where the Sun says "up".
export function pillText(name, fraction) {
  const v = visibility(fraction);
  const word = v.state === "up" ? (name === "Earth" ? "in view" : "up") : v.state === "part" ? `${v.percent}% visible` : "behind the terrain";
  return `${name} · ${word}`;
}

// The dot is filled while any of the body is visible and a ring when it is behind the terrain.
export const dotFilled = (fraction) => visibility(fraction).state !== "behind";

// "Day 19 of 30 · 19 Mar 2027 08:47 UTC", rounded to the minute.
export function whenText(etSinceStartS, ms, days) {
  const day = Math.min(days, Math.floor(etSinceStartS / 86400) + 1);
  const d = new Date(Math.round(ms / 60000) * 60000);
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `Day ${day} of ${days} · ${d.getUTCDate()} ${month} ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

// "1–30 March 2027" for a window of `days` days from startMs.
export function windowLabel(startMs, days) {
  const end = new Date(startMs + (days - 1) * 86400000);
  return `${new Date(startMs).getUTCDate()}–${end.getUTCDate()} ${end.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${end.getUTCFullYear()}`;
}
