#!/usr/bin/env bun
// statusLine: dotclaude's main status line. Reads Claude Code's status JSON on
// stdin and prints rows that wrap at $COLUMNS. See hooks/lib/_status-line.mjs.

import { readInput } from "../lib/_common.mjs";
import { gitState, renderMain } from "../lib/_status-line.mjs";

try {
  const data = readInput();
  const dir = data.workspace?.current_dir || data.cwd || process.cwd();
  const columns = Number(process.env.COLUMNS) || 120;
  console.log(renderMain(data, { columns: columns - 4, git: gitState(dir) }));
} catch {
  console.log("");
}
