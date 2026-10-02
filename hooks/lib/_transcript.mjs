// Read the session transcript (JSONL) with Node, for the classic hooks. The
// parsers are in `_transcript-parse.mjs`. The transcript layout is not a
// documented contract, so this is best-effort: anything unrecognized is
// skipped, and a missing file yields [].

import fs from "node:fs";
import path from "node:path";
import { promptsFromText, subagentTranscriptIn } from "./_transcript-parse.mjs";

const MAX_BYTES = 8_000_000;

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
  return promptsFromText(text, limit, maxChars);
}

/** A subagent's transcript path, with `node:path`. */
export function subagentTranscript(transcriptPath, sessionId, agentId) {
  return subagentTranscriptIn(path, transcriptPath, sessionId, agentId);
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
