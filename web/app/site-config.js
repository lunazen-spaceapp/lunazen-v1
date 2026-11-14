// Every external address the app, the README and the guide point to, in one place. Each value is a placeholder until it is
// known; a link whose address is still a placeholder is hidden (links.js), never shown dead. Replace a placeholder with the
// full https:// address. The README, packaging/README.txt and the guide's \repourl and \appurl carry the same addresses.
export const REPO_URL = "https://github.com/lunazen-spaceapp/lunazen-v1"; // the public source repository
export const APP_URL = "https://lunazen-v1.vercel.app"; // the deployed app (Vercel production)
export const DEMO_URL = "https://youtube.com/video0";  // the 30-second demo (temporary address)
export const PLAYLIST_URL = "https://youtube.com/playlist1"; // the six-part video series (temporary address)
export const EXPLORER_VIDEO_URL = "EXPLORER_VIDEO_URL"; // "The Sun and Earth in the South Polar Sky"
export const CONTACT_EMAIL = "lunazen.spaceapp@gmail.com";          // the address on the Contact page; the row stays visible while it is a placeholder
export const TEAM = "Team LunaZen · Ishaan & Anirban"; // the team line on the Contact page; hidden while it still has a bracketed part
export const VIDEO_1_TITLE = "Exploring the Lunar South Pole: Why Everyone Is Going, and Why It Is Hard to Land";    // the title of the first video of the series, on Resources
export const VIDEO_URLS = [1, 2, 3, 4, 5, 6].map((n) => `https://youtube.com/video${n}`); // the six videos in order; a video without an address shows its title as text
