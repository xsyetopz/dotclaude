// SubagentStart: gives each subagent the subagent rules of the dotclaude operating spec, and its progress file.
// A subagent does not see the SessionStart context.
// A subagent that stops at its turn limit delivers no report,
// so it adds its progress to a file that the main agent can read.

import fs from "node:fs";
import { PROGRESS_DIR, progressFile } from "../../lib/notes/progress.mjs";
import { rules, SECTIONS, SPEC, section } from "../../lib/terms.mjs";

const ID = "subagent-progress";
const withoutFile = SECTIONS.find((s) => s.id === ID)
  .rules.map((r) => r.id)
  .filter((id) => id !== "progress-write");
const context = (text) => `${SPEC}\n\n${section(ID, text)}`;

export const SUBAGENT_CONTEXT = context(rules(ID, { only: withoutFile }));

/** The context for the SubagentStart input `data`. */
export function contextFor(data) {
  const file = progressFile(data?.agent_id);
  if (!file) return SUBAGENT_CONTEXT;
  try {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  } catch {
    return SUBAGENT_CONTEXT;
  }
  return context(rules(ID).replace("<progress file>", file));
}

if (import.meta.main) {
  let data = {};
  try {
    data = JSON.parse(await Bun.stdin.text());
  } catch {}
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: contextFor(data),
      },
    }),
  );
}
