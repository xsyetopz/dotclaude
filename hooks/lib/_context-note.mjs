// The note that tells the main agent its context size after the allowed
// compactions. The size and the count come from `io.session`.

import {
  AUTO_COMPACT_TOKENS,
  COMPACTIONS_BEFORE_HANDOFF,
  CONTEXT_NOTE_TOKENS,
  k,
} from "./_budget.mjs";
import { option, stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";

/** The marker that a note was given in the current crossing of the bound. */
function markerFile(io, data) {
  const safe = String(data.session_id || "unknown").replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  );
  return pathFor(io.platform).join(stateDir(io), `${safe}.context-note`);
}

/**
 * Mark the note as given, so that `once` gives no note in this crossing. A
 * handoff note that Claude writes before the note comes has the same effect.
 */
export const markContextNote = (io, data) =>
  io.fs.write(markerFile(io, data), "1");

/**
 * Whether the module clears the context at the next typed prompt: the main
 * context is at CONTEXT_NOTE_TOKENS or more, and `context_auto_clear` is on.
 * The clear replaces automatic compaction, so it waits for no compaction.
 */
export async function autoClearDue(io) {
  if (!option(io.env, "context_auto_clear")) return false;
  const used = await io.session.mainContextTokens();
  return used !== null && used >= CONTEXT_NOTE_TOKENS;
}

/**
 * The `<context_use>` note when the main context is at CONTEXT_NOTE_TOKENS or
 * more after COMPACTIONS_BEFORE_HANDOFF compactions, else null. Before that,
 * automatic compaction runs. With `once`, the note comes only the first time
 * after the context was last under the bound, so a long run of tool calls
 * gets it once. Without `once`, a later note in the same crossing gives only
 * the size and refers to the first one, so Claude does not write the handoff
 * again for each prompt.
 * Each note marks the session, so a note after a prompt also counts.
 * With `context_auto_clear` on, no note comes, because the module writes the
 * handoff note and clears the context.
 */
export async function contextNote(io, data, once = false) {
  if (option(io.env, "context_auto_clear")) return null;
  const used = await io.session.mainContextTokens();
  if (used === null) return null;
  const file = markerFile(io, data);
  if (used < CONTEXT_NOTE_TOKENS) {
    await io.fs.remove(file);
    return null;
  }
  // The hooks module cannot delete a file, so an empty marker counts as
  // removed.
  const told = Boolean(await io.fs.read(file).catch(() => ""));
  if (once && told) return null;
  // A count that is not known counts as no compaction.
  const count = (await io.session.compactions()) ?? 0;
  if (count < COMPACTIONS_BEFORE_HANDOFF) return null;
  if (told)
    return `<context_use>\nThe main context is ${k(used)} tokens after ${count} compactions.\nAn earlier note in this context asked for a handoff note.\nUpdate it when a decision or the state changed, or when this request cannot finish before Claude Code compacts at about ${k(AUTO_COMPACT_TOKENS)} tokens.\nContinue the work.\nAt the next natural stop, ask the user to run \`/clear\`.\n</context_use>`;
  await io.fs.write(file, "1");
  return `<context_use>\nThe main context is ${k(used)} tokens after ${count} compactions.\nClaude Code compacts again at about ${k(AUTO_COMPACT_TOKENS)} tokens, and a step can take longer than that.\nSo write a handoff note now with the \`handoff\` skill, before you finish the current step.\nIf you wrote one after the last compaction, update it only when the state changed.\nThis note does not stop the work.\nAfter the handoff, continue the current step and the user's requests.\nAdd each new request to the handoff note.\nAt the next natural stop, ask the user to run \`/clear\`.\n</context_use>`;
}
