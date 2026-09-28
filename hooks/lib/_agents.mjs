// dotclaude agent definitions and their turn and context budgets.

import fs from "node:fs";
import path from "node:path";

/** `maxTurns` and `model` from a dotclaude agent's definition, or undefined. */
export function definition(agentType) {
  if (!/^dotclaude:[a-z0-9-]+$/.test(agentType)) return undefined;
  try {
    const file = path.join(
      import.meta.dir,
      "..",
      "..",
      "agents",
      `${agentType.slice(10)}.md`,
    );
    const head = fs.readFileSync(file, "utf8").split(/^---\s*$/m)[1] ?? "";
    const n = Number(/^maxTurns:\s*(\d+)\s*$/m.exec(head)?.[1]);
    return {
      maxTurns: n > 0 ? n : null,
      model: /^model:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
    };
  } catch {
    return undefined;
  }
}

/** Turns kept for the report: tool calls are refused once this many remain. */
export function reserve(limit) {
  return Math.max(3, Math.round(limit / 20));
}

/**
 * API calls in a subagent transcript since its latest prompt, resume message,
 * or background-task wake-up. Claude Code starts the `maxTurns` count again at
 * each of those, so earlier calls do not count.
 */
export function turnsUsed(transcript) {
  let text;
  try {
    text = fs.readFileSync(transcript, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  const ids = new Set();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "assistant" && entry.message?.id)
      ids.add(entry.message.id);
    if (entry.type === "user") {
      const content = entry.message?.content;
      const toolResult =
        Array.isArray(content) && content.some((b) => b.type === "tool_result");
      // Wake-ups and SendMessage resumes are meta entries with an origin;
      // meta reminders without one do not restart the count.
      const kind = entry.origin?.kind;
      const restart =
        !entry.isMeta || kind === "task-notification" || kind === "coordinator";
      if (!toolResult && restart) break;
    }
  }
  return ids.size;
}

/**
 * Context tokens of the first and latest API calls in a subagent transcript
 * (input plus cache reads and writes), or null without a readable call.
 */
export function contextUsed(transcript) {
  let text;
  try {
    text = fs.readFileSync(transcript, "utf8");
  } catch {
    return null;
  }
  let first = null;
  let last = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const u = entry.type === "assistant" ? entry.message?.usage : null;
    if (!u) continue;
    last =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    first ??= last;
  }
  return last === null ? null : { first, last };
}
