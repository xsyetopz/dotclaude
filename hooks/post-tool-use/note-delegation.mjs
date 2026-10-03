// PostToolUse: when the main conversation does much reading itself, tell it
// once per prompt to give the rest to a subagent. An `Agent` call and a typed
// prompt (see user-prompt-submit/reset-delegation-count.mjs) reset the count.

import { DELEGATION_NOTE_READS } from "../lib/_budget.mjs";
import { option } from "../lib/_core.mjs";
import { isRead, readCount, setReads } from "../lib/_delegation.mjs";

export default async function (io, data) {
  if (!option(io.env, "usage_notes")) return;
  // A subagent's tool call: the note is about the main conversation.
  if (data.agent_id) return;
  if (data.tool_name === "Agent") {
    await setReads(io, data, 0);
    return;
  }
  if (!isRead(data)) return;
  const reads = (await readCount(io, data)) + 1;
  await setReads(io, data, reads);
  // The count passes the bound once, so the note comes once per prompt.
  if (reads !== DELEGATION_NOTE_READS) return;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `You made ${DELEGATION_NOTE_READS} read calls in the main conversation since the last prompt.\nEach tool result stays in this context, and each later call reads it again.\nGive the rest of the reading to \`dotclaude:investigator\`, and give edits to \`dotclaude:implementer\`.\nKeep decisions and small edits here.`,
    },
  };
}
