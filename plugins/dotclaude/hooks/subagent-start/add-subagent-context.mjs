// SubagentStart: gives each subagent the project AI policy clause and its progress file.
// A subagent does not see the SessionStart context,
// and a research subagent once fetched the code of a project whose policy forbids AI tools.
// A subagent that stops at its turn limit delivers no report,
// so it adds its progress to a file that the main agent can read.

import fs from "node:fs";
import { POLICY_CLAUSE } from "../../lib/guards/policy.mjs";
import { knownDefectsClause } from "../../lib/notes/defects.mjs";
import {
  PROGRESS_DIR,
  progressFile,
  subagentProgress,
} from "../../lib/notes/progress.mjs";
import { TERMS_OF_USE } from "../../lib/terms.mjs";

export const SUBAGENT_CONTEXT = `${TERMS_OF_USE}\n\n${POLICY_CLAUSE}\n\n${knownDefectsClause()}`;

/** The context for the SubagentStart input `data`. */
export function contextFor(data) {
  const file = progressFile(data?.agent_id);
  if (!file) return SUBAGENT_CONTEXT;
  try {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  } catch {
    return SUBAGENT_CONTEXT;
  }
  return `${SUBAGENT_CONTEXT}\n\n${subagentProgress(file)}`;
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
