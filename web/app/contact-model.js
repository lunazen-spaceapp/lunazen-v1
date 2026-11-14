// What the Contact page shows from site-config.js: the email always (a placeholder is shown in brackets), the repository and the
// team only once they hold a real value. Pure, so the rules are tested.

import { hasUrl } from "./links.js";

// A placeholder is a bare constant name (CONTACT_EMAIL) or text with a bracketed part ([Team name] · [Members and roles]).
export const isPlaceholder = (value) => !value || /^[A-Z][A-Z_]*$/.test(value) || /\[[^\]]+\]/.test(value);

export function contactRows({ email, repo, team }) {
  return {
    email: { text: isPlaceholder(email) ? `[${email}]` : email, href: `mailto:${isPlaceholder(email) ? `[${email}]` : email}` }, // visible either way
    repo: hasUrl(repo) ? { text: repo, href: repo } : null,
    team: isPlaceholder(team) ? null : { text: team },
  };
}
