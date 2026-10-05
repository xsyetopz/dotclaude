// The progress file of each subagent.
// Claude Code delivers nothing from an agent that it stops at its turn limit,
// and in one week five capped agents lost all of their work.
// Each subagent adds its progress to a file named by its agent ID,
// and the main agent reads the file when the cap notice names that ID.

import os from "node:os";
import path from "node:path";
import { clause } from "../terms.mjs";

export const PROGRESS_DIR = path.join(os.tmpdir(), "dotclaude-progress");

/** The progress file of the agent `agentId`, or null for a bad ID. */
export function progressFile(agentId) {
  const id = String(agentId ?? "");
  return /^[\w-]+$/.test(id) ? path.join(PROGRESS_DIR, `${id}.md`) : null;
}

/** The clause for the main agent. */
export const MAIN_PROGRESS = clause(
  "subagent-progress",
  `<subagent_progress>
Each subagent adds its progress to \`${PROGRESS_DIR}/<agent ID>.md\`, because Claude Code delivers no report from an agent that stops at its turn limit.
When an agent stops at its turn limit, read its progress file.
Then send the next step to the agent with \`SendMessage\` to its task ID, because a new agent or your own run does the done steps again.
Give each agent a task that fits in its turn limit, because each tool call uses a turn.
Give one subject (a language, a tool, or a product) to each research agent, and send the agents in one message, so that they run at the same time.
</subagent_progress>`,
);

/** The clause for the subagent whose progress file is `file`. */
export const subagentProgress = (file) =>
  clause(
    "subagent-progress",
    `<subagent_progress>
Your progress file is \`${file}\`.
After each step, add one line to it with \`Bash\`, for example \`echo 'done: <step> | next: <step>' >> ${file}\`.
Claude Code delivers no report from an agent that stops at its turn limit, and the agent that sent you then reads this file to continue the work.
Add the line in the same \`Bash\` call as a step when you can, because each tool call uses a turn.
Do not write secrets in the file.
</subagent_progress>`,
  );
