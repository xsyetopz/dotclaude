#!/usr/bin/env bun
// statusLine: dotclaude's main status line. Reads Claude Code's status JSON on
// stdin and prints rows that wrap at $COLUMNS. See hooks/lib/_status-line.mjs.

import { readInput } from "../lib/_common.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { loopProgress } from "../lib/_loop.mjs";
import { gitState, renderMain } from "../lib/_status-line.mjs";
import { readUsage } from "../lib/_usage.mjs";

try {
  const data = readInput();
  const dir = data.workspace?.current_dir || data.cwd || process.cwd();
  const columns = Number(process.env.COLUMNS) || 120;
  const root = data.workspace?.project_dir || dir;
  console.log(
    renderMain(data, {
      columns: columns - 4,
      git: gitState(dir),
      loop: loopProgress(root),
      // Read Claude Code's cached `/usage` copy only while a window is missing.
      usage:
        data.rate_limits?.five_hour && data.rate_limits?.seven_day
          ? null
          : await readUsage(nodeIo(data)),
    }),
  );
} catch {
  console.log("");
}
