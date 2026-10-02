// The verdict log and the per-session ask memory of the PreToolUse guards.
//
// Each deny and ask goes to `verdicts.jsonl` in the plugin data directory, so
// a rule that fires too often is visible. An ask that the user approved (the
// tool then ran, so PostToolUse fired) is not asked again in that session for
// the same target. A deny is never remembered.

import { preToolOutput, stateDir, verdict } from "./_core.mjs";
import { pathFor } from "./_path.mjs";
import { sha1 } from "./_sha1.mjs";

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

// The log and the ask memory are secondary. A failed write must not stop the
// guard decision, so this function ignores the error.
async function quietly(write) {
  try {
    await write();
  } catch {
    // the write failed
  }
}

const byteSize = (text) => new TextEncoder().encode(text).length;

async function rotate(io, file) {
  let size = 0;
  try {
    size = (await io.fs.stat(file)).size;
  } catch {
    return; // no log yet
  }
  if (size <= LOG_MAX_BYTES) return;
  // The engine io has no rename, so the rotation copies the log to the
  // `.1.jsonl` file and then starts the main file again.
  let text;
  try {
    text = await io.fs.read(file);
  } catch {
    // A log past the read limit cannot be copied. Start it again without a
    // backup, or it never rotates.
    if (await io.fs.exists(file)) await io.fs.write(file, "");
    return;
  }
  // Another caller can rotate the log after the stat. Then the text is
  // short, and a copy of it must not replace the backup.
  if (byteSize(text) <= LOG_MAX_BYTES) return;
  await io.fs.write(file.replace(/\.jsonl$/, ".1.jsonl"), text);
  await io.fs.write(file, "");
}

/** Adds one verdict to the log. A failed write is ignored. */
export async function logVerdict(io, data, level, reason, extra = {}) {
  const path = pathFor(io.platform);
  const file = path.join(path.dirname(stateDir(io)), "verdicts.jsonl");
  await quietly(async () => {
    await rotate(io, file);
    const entry = {
      time: new Date().toISOString(),
      session: data.session_id ?? null,
      agent: data.agent_id ?? null,
      tool: data.tool_name ?? null,
      level,
      reason: clip(reason),
      target: clip(target(data)),
      ...extra,
    };
    await io.fs.append(file, `${JSON.stringify(entry)}\n`);
  });
}

function memoryFile(io, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
  return pathFor(io.platform).join(stateDir(io), `asks-${safe}.json`);
}

async function loadMemory(io, sessionId) {
  try {
    return {
      pending: {},
      approved: [],
      ...JSON.parse(await io.fs.read(memoryFile(io, sessionId))),
    };
  } catch {
    return { pending: {}, approved: [] };
  }
}

async function saveMemory(io, sessionId, memory) {
  await io.fs.write(memoryFile(io, sessionId), JSON.stringify(memory));
}

/**
 * The guard decision for `findings` as a PreToolUse output object, or null.
 * Logs the decision, and gives null for an ask that the user already approved
 * in this session for the same target and reason.
 */
export async function guardDecision(io, findings, data, label) {
  const v = verdict(findings, data, label, io.env);
  if (!v) return null;
  const [decision, reason] = v;
  const sid = data.session_id;
  // An edit is keyed on its whole input: one approved removal in a test file
  // must not approve a different one in the same file. The memory keeps the
  // SHA-1 of the key, because a `Write` input holds the whole file.
  const subject =
    data.tool_name === "Bash"
      ? target(data)
      : JSON.stringify(data.tool_input ?? {});
  const key = sha1(`${data.tool_name ?? ""}\0${subject}\0${reason}`);
  if (decision === "ask" && sid) {
    const memory = await loadMemory(io, sid);
    if (memory.approved.includes(key)) {
      await logVerdict(io, data, "remembered", reason);
      return null;
    }
    if (data.tool_use_id) {
      memory.pending[data.tool_use_id] = key;
      const ids = Object.keys(memory.pending);
      for (const id of ids.slice(0, -PENDING_MAX)) delete memory.pending[id];
      await quietly(() => saveMemory(io, sid, memory));
    }
  }
  await logVerdict(io, data, decision, reason);
  return preToolOutput(decision, reason);
}

/** PostToolUse: the tool ran, so the user approved its pending ask. */
export async function approveAsk(io, data) {
  const sid = data.session_id;
  const id = data.tool_use_id;
  if (!sid || !id || data.hook_event_name !== "PostToolUse") return;
  const memory = await loadMemory(io, sid);
  const key = memory.pending[id];
  if (!key) return;
  delete memory.pending[id];
  memory.approved = [...memory.approved.filter((k) => k !== key), key].slice(
    -APPROVED_MAX,
  );
  await saveMemory(io, sid, memory);
}
