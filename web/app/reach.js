// How far the lander may miss. The catalogue stores, for every spot, a ring of 12 nearby points: six at 50 m, then six at 100 m
// (lunazen.custom.RING_RADII_M), so a smaller miss distance is the first points of the same ring. "Works" at a miss distance means
// the spot and every point up to that distance work. Pure, so it is unit-tested in Node.

export const REACHES = [
  { m: 0, ring: 0, name: "Target spot only", about: "Only the spot itself is tested: a landing exactly on target." },
  { m: 50, ring: 6, name: "50 m dispersion radius", about: "The spot and six dispersion points around it at 50 m." },
  { m: 100, ring: 12, name: "100 m dispersion radius", about: "The spot and twelve dispersion points around it, six at 50 m and six at 100 m." },
];
export const DEFAULT_REACH = 100;

export const isReach = (m) => REACHES.some((r) => r.m === m);
export const normalizeReach = (m) => (isReach(m) ? m : DEFAULT_REACH);

// The number of nearby points a miss distance tests.
export const ringCount = (m) => REACHES.find((r) => r.m === normalizeReach(m)).ring;

// Words (the Plan pages' vocabulary: valid / fail, dispersion points, dispersion radius).
// worksText: the result ("valid within 100 m dispersion"); tokenText: a short form ("within 100 m"); nearbyText: what a row counts.
export const worksText = (m) => (normalizeReach(m) === 0 ? "valid at the target spot" : `valid within ${normalizeReach(m)} m dispersion`);
// The same words for a plural subject ("spots valid within 100 m dispersion").
export const workText = worksText;
// The sentence's token: "100 m dispersion radius" (the sentence reads "..., mast 2 m, 100 m dispersion radius").
export const sentenceText = (m) => (normalizeReach(m) === 0 ? "target spot only" : `${normalizeReach(m)} m dispersion radius`);
export const tokenText = (m) => (normalizeReach(m) === 0 ? "at the target spot" : `within ${normalizeReach(m)} m`);
export const nearbyText = (m) => `${ringCount(m)} dispersion point${ringCount(m) === 1 ? "" : "s"}`;
// "the spot and its 12 dispersion points" / "the spot itself"
export const testText = (m) => (ringCount(m) === 0 ? "the spot itself" : `the spot and its ${nearbyText(m)}`);
