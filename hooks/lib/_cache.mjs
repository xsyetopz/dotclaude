// The advice for a prompt cache that has expired. A prompt after the expiry
// writes the whole context to the cache again, at a higher price than a read.

import { clause } from "./_terms.mjs";

const ADVICE =
  "A handoff note and `/clear` can cost less than continuing with this context.";

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
  return clause(
    "cold-cache",
    `<cold_cache>\nThe prompt cache of this session expired.${cost}\n${ADVICE}\nTell the user this in one sentence in your first reply.\n</cold_cache>`,
  );
}

/** The note for a prompt that comes `idleMs` after the last turn. */
export const idleNote = (idleMs) =>
  clause(
    "cold-cache",
    `<cold_cache>\nThe last turn ended ${span(idleMs)} ago, so the prompt cache has expired, and this prompt writes the whole context again.\n${ADVICE}\n</cold_cache>`,
  );
