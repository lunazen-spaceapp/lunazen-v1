// What the Resources page says that comes from data: the evidence table and its date, the Scope figures and the playlist length. Pure functions,
// so the figures are tested. The wording of the labels is the design's; every number is read from evidence.json or the catalogue.

const row = (evidence, id) => evidence.scorecard.find((r) => r.id === id);
const limitOf = (r) => (r.verdict === "reported" || /^none/.test(r.tolerance) ? "—" : `${r.tolerance} max`);

// The seven checks, as the table shows them: check, compared with, result, limit and verdict (pass or reported).
export function evidenceRows(evidence) {
  const il = evidence.illumination, jpl = evidence.jpl.rows;
  const flat = /(\d+) flattest/.exec(row(evidence, "illumination").against)?.[1];
  const sunLimit = row(evidence, "illumination").tolerance.split(" and ")[0]; // the Sun's limit; the scorecard lists both bodies' limits
  const sc = (id) => row(evidence, id);
  const worstJpl = Math.max(...jpl.map((r) => r.maxSeparationArcsec));
  return [
    { check: "Sun and Earth directions", against: `JPL Horizons (${jpl.length / 2} sites, ${jpl[0].epochs} dates each)`, result: `${worstJpl.toFixed(2)}″ at worst`, limit: limitOf(sc("jpl")), verdict: sc("jpl").verdict },
    { check: "Long-term sunlight", against: `NASA LOLA illumination maps (${il.points} points)`, result: `${il.sun.rmsPp.toFixed(1)} pp RMS (worst: ${il.gentleSlopeWorstPp.sun.toFixed(1)} pp on the ${flat} flattest)`, limit: `${sunLimit} pp max`, verdict: sc("illumination").verdict },
    { check: "Connecting Ridge regions", against: "Barker et al. (2021)", result: sc("barker").result, limit: limitOf(sc("barker")), verdict: sc("barker").verdict },
    { check: "Sun angle on the surface", against: "Apollo 11, 12 and 14 moonwalk records", result: `${evidence.apollo.maxAbsDeg.toFixed(2)}° at worst`, limit: limitOf(sc("apollo")), verdict: sc("apollo").verdict },
    { check: `All ${evidence.spots.sun.n} candidate spots`, against: `NASA ${il.years}-year map (at the same pixel)`, result: sc("spots").result, limit: limitOf(sc("spots")), verdict: sc("spots").verdict },
    { check: "Two real landings", against: "IM-1's measured height; Blue Ghost 1's sunset", result: sc("missions").result, limit: limitOf(sc("missions")), verdict: sc("missions").verdict },
    { check: "Browser engine", against: "The Python reference (every spot)", result: sc("browser").result, limit: limitOf(sc("browser")), verdict: sc("browser").verdict },
  ];
}

// The four figures of Scope: NASA sites, candidate spots, CLPS landings and the sites away from the pole.
export function siteCounts(catalog) {
  return [
    [catalog.sites.length, "NASA sites (5 m)"],
    [catalog.spots.size, "Candidate spots"],
    [catalog.missions.size, "CLPS landings"],
    [catalog.beyond.sites.length, "Historical & global sites"],
  ];
}

// All the PGDA south-pole sites that were checked against the selection rule: the rows of data/sites/site_selection.csv
// (a test compares this with the file). The other counts in the Scope paragraph come from the catalogue.
export const EVALUATED_SITES = 27;
export const scopeLead = (catalog) => `All ${EVALUATED_SITES} NASA PGDA south-pole sites were checked against one rule: in an Artemis candidate region, or with NASA-published regions of interest and error estimates, and covered by NASA's visibility map. The result is a ${catalog.sites.length}-site polar catalogue on 5 m terrain maps, plus ${catalog.missions.size + catalog.beyond.sites.length} historical and commercial landing sites for comparison.`;

// The video series "The south polar sky": titles and running times. Video 1's title comes from site-config.js.
export const PLAYLIST_DURATIONS = ["4:26", "4:31", "6:09", "9:57", "3:49", "9:53"];
export const PLAYLIST_TITLES = [null, "The Sun and Earth in the South Polar Sky", "Under the Hood, Part 1: The J2000 Frame", "Under the Hood, Part 2: Following One SPICE Call",
  "Under the Hood, Part 3: The Sun in the Sky of a Landing Site", "Under the Hood, Part 4: Horizons and Visibility at the Lunar South Pole"];
const seconds = (mmss) => { const [m, s] = mmss.split(":").map(Number); return m * 60 + s; };
export const playlistMinutes = (durations = PLAYLIST_DURATIONS) => Math.round(durations.reduce((a, d) => a + seconds(d), 0) / 60);
export const playlistLine = (durations = PLAYLIST_DURATIONS) => `Technical playlist · ${durations.length} videos · about ${playlistMinutes(durations)} minutes`;
