// Read the user's recent prompts from the session transcript (JSONL).
// The transcript layout is not a documented contract, so this is best-effort:
// anything unrecognized is skipped, and a missing file yields [].

import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 8_000_000;

function isHuman(entry) {
  const kind = entry.origin?.kind;
  return kind === undefined ? !entry.isMeta : kind === "human";
}

function promptOf(entry) {
  if (
    entry.type === "user" &&
    typeof entry.message?.content === "string" &&
    !entry.isMeta &&
    !entry.isSidechain &&
    isHuman(entry)
  ) {
    return entry.message.content;
  }
  const att = entry.type === "attachment" ? entry.attachment : null;
  if (
    att?.type === "queued_command" &&
    typeof att.prompt === "string" &&
    (att.humanTurn || att.origin?.kind === "human")
  ) {
    return att.prompt;
  }
  return undefined;
}

/** The last `maxBytes` of a file as text, or null when it cannot be read. */
export function tail(file, maxBytes = MAX_BYTES) {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    const start = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The time (ms) and context tokens (input plus cache reads and writes) of the
 * latest main-conversation API call, or null without one.
 */
export function lastMainCall(transcriptPath) {
  const text = tail(transcriptPath, 2_000_000);
  if (!text) return null;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const u = entry.type === "assistant" ? entry.message?.usage : null;
    const at = Date.parse(entry.timestamp);
    if (!u || entry.isSidechain || Number.isNaN(at)) continue;
    return {
      at,
      context:
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0),
    };
  }
  return null;
}

export function recentPrompts(transcriptPath, limit = 5, maxChars = 600) {
  const text = tail(transcriptPath);
  if (text === null) return [];
  const prompts = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const prompt = promptOf(entry)?.trim();
    if (!prompt || prompt.startsWith("<") || prompt.startsWith("Caveat:"))
      continue;
    prompts.push(
      prompt.length > maxChars ? `${prompt.slice(0, maxChars)} [...]` : prompt,
    );
  }
  return prompts.slice(-limit);
}

/**
 * A subagent's transcript: Claude Code keeps it in
 * `<session>/subagents/agent-<id>.jsonl` next to the session's transcript.
 */
export function subagentTranscript(transcriptPath, sessionId, agentId) {
  const id = String(agentId).replace(/^agent-/, "");
  return path.join(
    path.dirname(transcriptPath),
    String(sessionId),
    "subagents",
    `agent-${id}.jsonl`,
  );
}
