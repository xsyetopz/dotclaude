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
    // Claude Code stores the compaction summary as a user entry.
    !entry.isCompactSummary &&
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

// Tools that end a turn to wait for the user's answer.
const WAITS_FOR_USER = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * True when the last main-conversation assistant entry calls a tool that
 * waits for the user (`AskUserQuestion`, `ExitPlanMode`).
 */
export function waitsForUser(transcriptPath) {
  const text = transcriptPath ? tail(transcriptPath, 500_000) : null;
  if (!text) return false;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || entry.isSidechain) continue;
    const content = entry.message?.content;
    return (
      Array.isArray(content) &&
      content.some((c) => c.type === "tool_use" && WAITS_FOR_USER.has(c.name))
    );
  }
  return false;
}

export function recentPrompts(transcriptPath, limit = 5, maxChars = 600) {
  const text = tail(transcriptPath);
  if (text === null) return [];
  // Scan from the end and stop at `limit` prompts: parsing every line of an
  // 8 MB tail costs about 20 ms. With a `limit` that is not a positive
  // integer, the scan reads all lines, and `slice` gives the old result.
  const prompts = [];
  const lines = text.split("\n");
  for (
    let i = lines.length - 1;
    i >= 0 && !(limit > 0 && prompts.length === limit);
    i -= 1
  ) {
    const line = lines[i];
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
  return prompts.reverse().slice(-limit);
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

/**
 * True when a hook input comes from a subagent. Compaction hooks can fire for
 * a subagent with no agent fields (#91910), so the transcript path counts too.
 */
export function isSubagent(data) {
  return (
    Boolean(data.agent_id) ||
    /[\\/]subagents[\\/][^\\/]+$/.test(data.transcript_path ?? "")
  );
}
