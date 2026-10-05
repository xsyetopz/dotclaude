// The text and the note file of a compaction.

import { CLOSE_RULE } from "./_handoff.mjs";

// The default summary text says to continue without asking. A model then
// acted on a plan that the user had not approved.
export const COMPACT_TEXT = `<open_request>
If the last request of the user asked for a plan, asked a question, or asked for approval, write in the summary that this request is still open.
Also write that the next turn waits for the user.
The user did not approve a plan that the conversation only describes, so the next turn must not carry it out.
</open_request>`;

export const HANDOFF_PROMPT = `<handoff_request>
Write a handoff note for a fresh session that continues this task.
The conversation is about to be compacted, and the next part starts from this note.
Write only what you verified or what the user said.
Mark each item that you are not sure of as \`unverified\`.
Use these sections in this order:

## Goal
Quote each request and constraint of the user exactly.

## State
List what is done, with file paths, and if each part is verified.

## Decisions
List each choice and its reason, and each option that you rejected.

## Open
List the remaining steps in order, and each question that waits for the user.

## Details
List exact errors, commands, IDs, and \`file:line\` locations.
</handoff_request>`;

/** The note path: UTC `yyyy-mm-dd-HHMM`, as in `2026-10-04-0213-compaction.md`. */
export const handoffPath = (root, at) =>
  `${root.replace(/[\\/]+$/, "")}/.claude/handoffs/${at
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "")}-compaction.md`;

/** The note file: front matter that the SessionStart pointer reads, then the text. */
export const handoffFile = (text, at) =>
  `---\nstatus: in-progress\nwritten: ${at.toISOString()}\n---\n\n${text.trim()}\n`;

/**
 * The note with `status: superseded` in place of `status: in-progress`.
 * A newer note of the same session carries its open items,
 * so the SessionStart pointer and the agent read only the newest note.
 */
export const supersede = (text) =>
  text.replace(
    /^(---\r?\n(?:(?!---).*\r?\n)*?)status: in-progress(?=\r?\n)/,
    "$1status: superseded",
  );

/** The user row that carries the note into the compacted conversation. */
export const handoffRow = (text, path) => ({
  role: "user",
  text: `<compaction_handoff_note path="${path}">\n${text.trim()}\n</compaction_handoff_note>\n${CLOSE_RULE}`,
  toolUses: [],
});
