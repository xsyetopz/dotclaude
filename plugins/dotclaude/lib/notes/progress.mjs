// The progress file of each subagent.
// Claude Code delivers nothing from an agent that it stops at its turn limit,
// and in one week five capped agents lost all of their work.
// Each subagent adds its progress to a file named by its agent ID,
// and the main agent reads the file when the cap notice names that ID.

import os from "node:os";
import path from "node:path";

export const PROGRESS_DIR = path.join(os.tmpdir(), "dotclaude-progress");

/** The progress file of the agent `agentId`, or null for a bad ID. */
export function progressFile(agentId) {
  const id = String(agentId ?? "");
  return /^[\w-]+$/.test(id) ? path.join(PROGRESS_DIR, `${id}.md`) : null;
}
