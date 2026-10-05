// The text and the note file of a compaction.

import { clause, clauseTag } from "../terms.mjs";

// The default summary text says to continue without asking. A model then
// acted on a plan that the user had not approved.
export const COMPACT_TEXT = `${clauseTag("compaction")}
<open_request>
If the last request of the user asked for a plan, asked a question, or asked for approval, write in the summary that this request is still open.
Also write that the next turn waits for the user.
The user did not approve a plan that the conversation only describes, so the next turn must not carry it out.
</open_request>
</dotclaude_terms>`;

export const HANDOFF_PROMPT = `<handoff_request>
Write a handoff note for a fresh session that continues this task.
The conversation is about to be compacted.
The user then runs \`/clear\`, and a fresh session starts from this note.
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

/**
 * The user row after the compaction: stop, and send the user to `/clear`.
 * Claude once wrote 21 notes in one day and continued in the compacted
 * context each time, so no note started a small context.
 */
export const handoffRow = (path) => {
  const name = path.split("/").pop();
  return {
    role: "user",
    text: clause(
      "handoff",
      `<compaction_handoff path="${path}">
The conversation was compacted, and a handoff note for this task is at \`.claude/handoffs/${name}\`.
Do not continue the task in this context, because each turn reads the whole compacted context again, and a fresh session after \`/clear\` starts small.
Do not use a tool.
Send one short reply to the user, then stop.
In the reply, tell the user that the note is at \`.claude/handoffs/${name}\`.
Tell the user to run \`/clear\` and then to send this prompt:
Continue from the handoff note at \`.claude/handoffs/${name}\`.
</compaction_handoff>`,
    ),
    toolUses: [],
  };
};
