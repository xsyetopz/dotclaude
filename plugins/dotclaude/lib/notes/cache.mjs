// The advice for a prompt cache that has expired. A prompt after the expiry
// writes the whole context to the cache again, at a higher price than a read.

import { ruleText, section } from "../terms.mjs";

const ADVICE = ruleText("cold-offer");

/** The time in words: minutes under 2 hours, else hours. */
export function span(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 120
    ? `${minutes} minutes`
    : `${Math.round(minutes / 60)} hours`;
}

/** The SessionStart context for a resumed session, from its input fields. */
export function resumeNote(data) {
  const usd = Number(data.estimated_cache_write_usd);
  const cost =
    Number.isFinite(usd) && usd > 0
      ? ` The next prompt writes the context to the cache again for about $${usd.toFixed(2)} (\`estimated_cache_write_usd\`).`
      : " The next prompt writes the context to the cache again.";
  return section(
    "prompt-cache",
    `The prompt cache of this session expired.${cost}\nTell the user this in one sentence in your first reply.\n${ADVICE}`,
  );
}

/** The note for a prompt that comes `idleMs` after the last turn. */
export const idleNote = (idleMs) =>
  section(
    "prompt-cache",
    `The last turn ended ${span(idleMs)} ago, so the prompt cache has expired.\nThis prompt writes the whole context again.\n${ADVICE}`,
  );

/** The section for a session on the API plan, whose prompt cache lives 5 minutes. */
export const API_NOTE = section(
  "prompt-cache",
  `The plan of the user is pay-per-token API.\n${ruleText("api-wait")}`,
);
