// Small helpers for usage-report.mjs. The 0.19.1 hook libraries held them.

import fs from "node:fs";
import path from "node:path";

/** `maxTurns` of a dotclaude agent (`dotclaude:name`), or null. */
export function maxTurns(agentType) {
  if (!/^dotclaude:[a-z0-9-]+$/.test(agentType)) return null;
  try {
    const file = path.join(
      import.meta.dir,
      "..",
      "agents",
      `${agentType.slice(10)}.md`,
    );
    const head = fs.readFileSync(file, "utf8").split(/^---\s*$/m)[1] ?? "";
    const n = Number(/^maxTurns:\s*(\d+)\s*$/m.exec(head)?.[1]);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Turns before the limit at which an agent must report. */
export const reserve = (limit) => Math.max(3, Math.round(limit / 20));

/** Estimated tokens: the larger of chars / 4 and words / 0.75. */
export function tokens(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil([...text].length / 4), Math.ceil(words / 0.75));
}

function entryOf(line) {
  try {
    const entry = JSON.parse(line);
    return entry !== null && typeof entry === "object" ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Assistant messages since the last prompt that started a turn: tool results,
 * and meta entries without a wake-up origin, do not restart the count.
 */
export function turnsFromText(text) {
  const lines = text.split("\n");
  const ids = new Set();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const entry = lines[i] && entryOf(lines[i]);
    if (!entry) continue;
    if (entry.type === "assistant" && entry.message?.id)
      ids.add(entry.message.id);
    if (entry.type === "user") {
      const content = entry.message?.content;
      const toolResult =
        Array.isArray(content) &&
        content.some((b) => b?.type === "tool_result");
      const kind = entry.origin?.kind;
      const restart =
        !entry.isMeta || kind === "task-notification" || kind === "coordinator";
      if (!toolResult && restart) break;
    }
  }
  return ids.size;
}
