// The verdict log and the per-session ask memory of the PreToolUse guards.
//
// Each deny and ask goes to `verdicts.jsonl` in the plugin data directory, so
// a rule that fires too often is visible. An ask that the user approved (the
// tool then ran, so PostToolUse fired) is not asked again in that session for
// the same target. A deny is never remembered.

import fs from "node:fs";
import path from "node:path";
import { preToolDecision, stateDir, verdict } from "./_common.mjs";

const TARGET_MAX = 200;
const LOG_MAX_BYTES = 1_000_000;
const PENDING_MAX = 50;
const APPROVED_MAX = 200;

const clip = (s) => String(s ?? "").slice(0, TARGET_MAX);

function target(data) {
  const input = data.tool_input ?? {};
  return String(input.command ?? input.file_path ?? input.notebook_path ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function logVerdict(data, level, reason) {
  const file = path.join(path.dirname(stateDir()), "verdicts.jsonl");
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES)
      fs.renameSync(file, file.replace(/\.jsonl$/, ".1.jsonl"));
  } catch {
    // no log yet
  }
  const entry = {
    time: new Date().toISOString(),
    session: data.session_id ?? null,
    agent: data.agent_id ?? null,
    tool: data.tool_name ?? null,
    level,
    reason: clip(reason),
    target: clip(target(data)),
  };
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function memoryFile(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir(), `asks-${safe}.json`);
}

function loadMemory(sessionId) {
  try {
    return {
      pending: {},
      approved: [],
      ...JSON.parse(fs.readFileSync(memoryFile(sessionId), "utf8")),
    };
  } catch {
    return { pending: {}, approved: [] };
  }
}

function saveMemory(sessionId, memory) {
  const file = memoryFile(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(memory));
  fs.renameSync(tmp, file);
}

/**
 * Emit the guard decision for `findings`, log it, and skip an ask that the
 * user already approved in this session for the same target and reason.
 */
export function guardDecision(findings, data, label) {
  const v = verdict(findings, data, label);
  if (!v) return;
  const [decision, reason] = v;
  const sid = data.session_id;
  // An edit is keyed on its whole input: one approved removal in a test file
  // must not approve a different one in the same file.
  const subject =
    data.tool_name === "Bash"
      ? target(data)
      : JSON.stringify(data.tool_input ?? {});
  const key = `${data.tool_name ?? ""}\0${subject}\0${reason}`;
  if (decision === "ask" && sid) {
    const memory = loadMemory(sid);
    if (memory.approved.includes(key)) {
      logVerdict(data, "remembered", reason);
      return;
    }
    if (data.tool_use_id) {
      memory.pending[data.tool_use_id] = key;
      const ids = Object.keys(memory.pending);
      for (const id of ids.slice(0, -PENDING_MAX)) delete memory.pending[id];
      saveMemory(sid, memory);
    }
  }
  logVerdict(data, decision, reason);
  preToolDecision(decision, reason);
}

/** PostToolUse: the tool ran, so the user approved its pending ask. */
export function approveAsk(data) {
  const sid = data.session_id;
  const id = data.tool_use_id;
  if (!sid || !id || data.hook_event_name !== "PostToolUse") return;
  const memory = loadMemory(sid);
  const key = memory.pending[id];
  if (!key) return;
  delete memory.pending[id];
  memory.approved = [...memory.approved.filter((k) => k !== key), key].slice(
    -APPROVED_MAX,
  );
  saveMemory(sid, memory);
}
