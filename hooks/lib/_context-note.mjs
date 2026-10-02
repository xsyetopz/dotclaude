// The note that tells the main agent its context size after the allowed
// compactions. The size and the count come from `io.session`.

import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
} from "./_budget.mjs";
import { stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";

/**
 * The `<context_use>` note when the main context is at CONTEXT_NOTE_TOKENS or
 * more after COMPACTIONS_BEFORE_HANDOFF compactions, else null. Before that,
 * automatic compaction runs. With `once`, the note comes only the first time
 * after the context was last under the bound, so a long run of tool calls
 * gets it once. Without `once`, a later note in the same crossing gives only
 * the size and refers to the first one, so Claude does not write the handoff
 * again for each prompt.
 * Each note marks the session, so a note after a prompt also counts.
 */
export async function contextNote(io, data, once = false) {
  const used = await io.session.mainContextTokens();
  if (used === null) return null;
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  const file = pathFor(io.platform).join(stateDir(io), `${safe}.context-note`);
  if (used < CONTEXT_NOTE_TOKENS) {
    await io.fs.remove(file);
    return null;
  }
  const told = await io.fs.exists(file);
  if (once && told) return null;
  // A count that is not known counts as no compaction.
  const count = (await io.session.compactions()) ?? 0;
  if (count < COMPACTIONS_BEFORE_HANDOFF) return null;
  if (told)
    return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. An earlier note in this context asked for a handoff note. If you did not write it, write it now. If you wrote it, update it only when a decision or the state changed, or when this request cannot finish before Claude Code compacts at about ${k(AUTO_COMPACT_TOKENS)} tokens. Continue the work, and at the next natural stop ask the user to run \`/clear\`.</context_use>`;
  await io.fs.write(file, "");
  return `<context_use source="dotclaude">The main context is ${k(used)} tokens after ${count} compactions. Each compaction summarizes the previous summary again, so the earliest facts degrade. Claude Code compacts again at about ${k(AUTO_COMPACT_TOKENS)} tokens, and a step can take longer than that. Thus write a handoff note now with the \`handoff\` skill, before you finish the current step. If you wrote one after the last compaction, update it only when the state changed. This note does not stop the work. After the handoff, continue the current step and the user's requests, and add each new request to the handoff note. At the next natural stop, ask the user to run \`/clear\`.</context_use>`;
}
