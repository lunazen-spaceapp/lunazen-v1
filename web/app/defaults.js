// The starting point shared by the planning pages (Windows, Planner, Rank, Compare), so they open on the same
// question. 15 March 2027 is the date the guide's walkthroughs use (Site01-1 from that day, a 61-day Planner range ending
// 14 May 2027), so a first load reproduces the guide. It lies in the precomputed years (the Windows year grid for 2027 is
// stored), and it is a hard case on purpose: nothing works within 100 m at Site01-1, so the Planner's suggestions
// (another spot, a smaller miss distance, a lander that tolerates the night) are the first thing a visitor sees.
// The date is one constant to move later.

export const PLANNING = { date: "2027-03-15", mast: 2, mission: 14, rule: "viper", dark: 50, link: 50, within: 100, dbelow: 0, dstation: 0 };
