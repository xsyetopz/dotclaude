#!/usr/bin/env bun
// PostToolUse / PostToolUseFailure hook: record edits and check runs in the
// session ledger. Prints nothing.

import path from "node:path";
import { option, projectRoot, run } from "../lib/_common.mjs";
import {
  isCheckCommand,
  load,
  outputShowsFailure,
  save,
} from "../lib/_ledger.mjs";

const NON_CODE =
  /\.(md|mdx|markdown|txt|rst|adoc|org|csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf)$/i;

/** Path of a code edit relative to the project, or null when it doesn't count. */
function codeEdit(data) {
  if (data.hook_event_name === "PostToolUseFailure") return null;
  const input = data.tool_input ?? {};
  const file = input.file_path || input.notebook_path || "";
  const rel = path.relative(projectRoot(data), file);
  const outside = rel.startsWith("..") || path.isAbsolute(rel);
  if (!file || NON_CODE.test(file) || outside || rel.startsWith(".claude/"))
    return null;
  return rel;
}

/** Result of a finished test/build/lint command, or null when it doesn't count. */
function checkRun(data) {
  const input = data.tool_input ?? {};
  const command = input.command;
  if (typeof command !== "string" || !isCheckCommand(command)) return null;
  if (input.run_in_background) return null; // result arrives later
  const recorded = command.slice(0, 200);
  if (data.hook_event_name === "PostToolUseFailure") {
    if (data.is_interrupt) return null;
    const code = /^Exit code (\d+)/.exec(data.error ?? "")?.[1];
    return { command: recorded, ok: false, code: code ? Number(code) : null };
  }
  const response = data.tool_response ?? {};
  if (response.interrupted) return null;
  const output = `${response.stdout ?? ""}\n${response.stderr ?? ""}`.slice(
    -20000,
  );
  return { command: recorded, ok: !outputShowsFailure(output), code: 0 };
}

run((data) => {
  if (!option("stop_gate") && !option("compact_carryover")) return;
  const state = load(data.session_id, data.agent_id);
  state.seq += 1;
  switch (data.tool_name) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit": {
      const rel = codeEdit(data);
      if (!rel) return;
      state.lastEdit = { seq: state.seq, path: rel };
      break;
    }
    case "Bash": {
      const result = checkRun(data);
      if (!result) return;
      state.lastCheck = { seq: state.seq, ...result };
      break;
    }
    default:
      return;
  }
  save(data.session_id, data.agent_id, state);
});
