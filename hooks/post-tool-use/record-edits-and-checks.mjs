#!/usr/bin/env bun
// PostToolUse / PostToolUseFailure hook: record edits and check runs in the
// session ledger. Prints nothing.

import path from "node:path";
import { option, projectRoot, run } from "../lib/_common.mjs";
import {
  isCheckCommand,
  load,
  NON_CODE,
  outputShowsFailure,
  save,
  shellWrites,
} from "../lib/_ledger.mjs";

/** Path of a code edit relative to the project, or null when it doesn't count. */
/** Project-relative path an edit tool wrote, or null. */
function editedPath(data) {
  if (data.hook_event_name === "PostToolUseFailure") return null;
  const input = data.tool_input ?? {};
  const file = input.file_path || input.notebook_path || "";
  const rel = path.relative(projectRoot(data), file);
  if (!file || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

const codeFile = (rel) => !NON_CODE.test(rel) && !rel.startsWith(".claude/");

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

/** Every path this session (or subagent) wrote, so compaction can tell its
 * changes from the user's. Bounded to keep the ledger small. */
function recordEdited(state, rel) {
  const list = (state.edited ?? []).filter((p) => p !== rel);
  list.push(rel);
  state.edited = list.slice(-300);
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
      const rel = editedPath(data);
      if (!rel) return;
      recordEdited(state, rel);
      if (codeFile(rel)) state.lastEdit = { seq: state.seq, path: rel };
      break;
    }
    case "Bash": {
      const command = data.tool_input?.command;
      const written =
        data.hook_event_name === "PostToolUse" && typeof command === "string"
          ? shellWrites(
              command,
              projectRoot(data),
              data.cwd || projectRoot(data),
            )
          : [];
      if (written.length) {
        state.lastEdit = { seq: state.seq, path: written[0] };
        for (const rel of written) recordEdited(state, rel);
      }
      const result = checkRun(data);
      // A check in the same command runs after its writes (`... > f && make`).
      if (result) {
        if (written.length) state.seq += 1;
        state.lastCheck = { seq: state.seq, ...result };
      }
      if (!written.length && !result) return;
      break;
    }
    default:
      return;
  }
  save(data.session_id, data.agent_id, state);
});
