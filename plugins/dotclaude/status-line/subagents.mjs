// subagentStatusLine: one JSON line per running agent: name, model and effort,
// context against the subagent budget, run time, and the description.

import fs from "node:fs";
import path from "node:path";
import { renderTask } from "./render.mjs";

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

try {
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  const columns = Number(data.columns) || Number(process.env.COLUMNS) || 100;
  for (const task of Array.isArray(data.tasks) ? data.tasks : [])
    if (task?.id) {
      const type = agentTypeOf(data.transcript_path, task.id);
      const content = renderTask(task, type, { columns });
      console.log(JSON.stringify({ id: task.id, content }));
    }
} catch {
  // Rows keep Claude Code's default rendering.
}
