#!/usr/bin/env bun
// subagentStatusLine: one row body per subagent, with its context measured
// against the subagent budget. Prints one JSON line per row it overrides.

import { readInput } from "../lib/_common.mjs";
import { agentTypeOf, renderTask } from "../lib/_status-line.mjs";

try {
  const data = readInput();
  const columns = Number(data.columns) || Number(process.env.COLUMNS) || 100;
  for (const task of Array.isArray(data.tasks) ? data.tasks : [])
    if (task?.id) {
      const agentType = agentTypeOf(data.transcript_path, task.id);
      const content = renderTask({ ...task, agentType }, { columns });
      console.log(JSON.stringify({ id: task.id, content }));
    }
} catch {
  // Rows keep Claude Code's default rendering.
}
