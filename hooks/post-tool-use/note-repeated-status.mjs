#!/usr/bin/env bun
// PostToolUse hook for Bash: on the third identical command in a row with
// identical output in one agent, tell Claude to change the approach or wait
// with `Monitor`. A repeated status check that shows nothing new costs a turn,
// and each turn re-reads the whole context. The count is per agent and lives
// in its own state file, so it does not race the ledger writes of
// `record-edits-and-checks.mjs`.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emit, option, run, stateDir } from "../lib/_common.mjs";

const REPEATS_FOR_NOTE = 3;

function stateFile(sessionId, agentId) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(
    stateDir(),
    `${safe(sessionId)}.${safe(agentId ?? "main")}.repeat.json`,
  );
}

run((data) => {
  if (!option("usage_notes") || !data.session_id) return;
  if (data.hook_event_name !== "PostToolUse") return;
  const input = data.tool_input ?? {};
  const command = input.command;
  if (typeof command !== "string" || input.run_in_background) return;
  const response = data.tool_response ?? {};
  const key = createHash("sha256")
    .update(
      JSON.stringify([command, response.stdout ?? "", response.stderr ?? ""]),
    )
    .digest("hex");
  const file = stateFile(data.session_id, data.agent_id);
  let state = { key: null, count: 0 };
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First Bash call in this agent.
  }
  state =
    state.key === key ? { key, count: state.count + 1 } : { key, count: 1 };
  const note = state.count >= REPEATS_FOR_NOTE;
  if (note) state.count = 0;
  fs.writeFileSync(file, JSON.stringify(state));
  if (!note) return;
  const shown = command.length > 200 ? `${command.slice(0, 200)}...` : command;
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `You ran \`${shown}\` ${REPEATS_FOR_NOTE} times in a row, and the output did not change. Each run costs a turn that re-reads the whole context. Change the approach, or wait for the change with \`Monitor\` and an until-loop, or with a background command.`,
    },
  });
});
