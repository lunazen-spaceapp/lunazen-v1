// UTC <-> ET (TDB seconds past J2000), following NAIF DELTET (naif0012.tls):
// ET - TAI = 32.184 + K sin(E), E = M + EB sin(M), M = M0 + M1 * ET.

const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DELTA_T_A = 32.184;
const K = 1.657e-3;
const EB = 1.671e-2;
const M0 = 6.239996;
const M1 = 1.99096871e-7;

// [UTC ms when it takes effect, TAI - UTC seconds]; enough for 2012 onward.
const LEAP_SECONDS = [
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

function taiMinusUtc(utcMs) {
  if (utcMs < LEAP_SECONDS[0][0]) throw new RangeError("dates before 2012-07-01 are not supported");
  let value = LEAP_SECONDS[0][1];
  for (const [start, seconds] of LEAP_SECONDS) if (utcMs >= start) value = seconds;
  return value;
}

function periodic(et) {
  const m = M0 + M1 * et;
  return K * Math.sin(m + EB * Math.sin(m));
}

export function utcMsToEt(utcMs) {
  const tdt = (utcMs - J2000_UTC_MS) / 1000 + taiMinusUtc(utcMs) + DELTA_T_A;
  return tdt + periodic(tdt);
}

export function etToUtcMs(et) {
  const tdt = et - periodic(et);
  // Leap-second offset is constant across the supported range except at steps; iterate once.
  let utcMs = J2000_UTC_MS + (tdt - DELTA_T_A - 37) * 1000;
  utcMs = J2000_UTC_MS + (tdt - DELTA_T_A - taiMinusUtc(utcMs)) * 1000;
  return utcMs;
}

export function parseUtc(iso) {
  return utcMsToEt(Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`));
}
