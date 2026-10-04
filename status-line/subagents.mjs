// subagentStatusLine: one JSON line per running agent, with its name, model,
// and context against the subagent budget.

import fs from "node:fs";
import path from "node:path";
import {
  C,
  contextPart,
  REVIEWER_CONTEXT_TOKENS,
  SEP,
  SUBAGENT_CONTEXT_TOKENS,
  shortModel,
} from "./shared.mjs";

/**
 * An agent's type without its plugin prefix. Claude Code's row input has no
 * type, but `agent-<id>.meta.json` next to the session transcript has it.
 */
function agentTypeOf(transcriptPath, id) {
  if (!transcriptPath || !/^[\w-]+$/.test(String(id))) return null;
  const meta = path.join(
    transcriptPath.replace(/\.jsonl$/, ""),
    "subagents",
    `agent-${id}.meta.json`,
  );
  try {
    const type = JSON.parse(fs.readFileSync(meta, "utf8")).agentType;
    return typeof type === "string" ? type.replace(/^[^:]+:/, "") : null;
  } catch {
    return null;
  }
}

export function renderTask(task, agentType) {
  const parts = [C.bold(task.name || agentType || "agent")];
  if (task.model) parts.push(C.dim(shortModel(task.model)));
  if (task.tokenCount > 0) {
    const limit =
      agentType === "reviewer"
        ? REVIEWER_CONTEXT_TOKENS
        : SUBAGENT_CONTEXT_TOKENS;
    parts.push(contextPart(task.tokenCount, limit));
  }
  return parts.join(SEP);
}

try {
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  for (const task of Array.isArray(data.tasks) ? data.tasks : [])
    if (task?.id) {
      const type = agentTypeOf(data.transcript_path, task.id);
      console.log(
        JSON.stringify({ id: task.id, content: renderTask(task, type) }),
      );
    }
} catch {
  // Rows keep Claude Code's default rendering.
}
