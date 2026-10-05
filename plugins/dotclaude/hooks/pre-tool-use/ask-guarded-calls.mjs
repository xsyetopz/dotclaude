// PreToolUse: asks before a Bash command or an edit that a guard finds. In
// auto mode, the auto-mode classifier decides an ask of the module
// (`tool.check`), and it can allow the call. An ask of a classic PreToolUse
// hook stays an ask, so the user sees a prompt (measured, Claude Code 2.1.289).

import fs from "node:fs";
import os from "node:os";
import { askFor } from "../../lib/guards/bash.mjs";
import { editReasons } from "../../lib/guards/edit.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** A plugin option is on unless the user turned it off. */
const on = (value) => value !== "false";

/** The reason to ask about the tool call in `data`, or undefined. */
export function askReason(data, env = process.env) {
  const input = data.tool_input ?? {};
  if (data.tool_name === "Bash" && on(env.CLAUDE_PLUGIN_OPTION_GUARD_BASH)) {
    const project = env.CLAUDE_PROJECT_DIR || data.cwd || "";
    const found = askFor(String(input.command ?? ""), {
      cwd: data.cwd || project,
      project,
      home: env.HOME || os.homedir(),
    });
    return found.length
      ? found.map((f) => `\`${f.part}\`: ${f.reason}`).join(" ")
      : undefined;
  }
  if (
    EDIT_TOOLS.has(data.tool_name) &&
    on(env.CLAUDE_PLUGIN_OPTION_GUARD_EDIT)
  ) {
    let existing = null;
    if (data.tool_name === "Write" && input.file_path)
      try {
        existing = fs.readFileSync(input.file_path, "utf8");
      } catch {
        // A new or unreadable file has no old text.
      }
    return editReasons(data.tool_name, input, existing).join(" ") || undefined;
  }
  return undefined;
}

if (import.meta.main) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    // No input: no decision.
  }
  const reason = askReason(data);
  if (reason)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: reason,
        },
      }),
    );
}
