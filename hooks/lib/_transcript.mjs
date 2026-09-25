// Read the user's recent prompts from the session transcript (JSONL).
// The transcript layout is not a documented contract, so this is best-effort:
// anything unrecognized is skipped, and a missing file yields [].

import fs from "node:fs";

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
  return null;
}

export function recentPrompts(transcriptPath, limit = 5, maxChars = 600) {
  let text;
  try {
    const stat = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, "r");
    const start = Math.max(0, stat.size - MAX_BYTES);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return [];
  }
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
