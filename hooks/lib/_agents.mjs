// dotclaude agent definitions and the turns kept for an agent's report.

import fs from "node:fs";
import path from "node:path";

/**
 * `maxTurns`, `model`, and `effort` from a dotclaude agent's definition, or
 * undefined.
 */
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
      effort: /^effort:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
    };
  } catch {
    return undefined;
  }
}

/** Turns kept for the report: tool calls are refused once this many remain. */
export function reserve(limit) {
  return Math.max(3, Math.round(limit / 20));
}
