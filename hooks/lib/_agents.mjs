// dotclaude agent definitions and the turns kept for an agent's report.

import { pathFor } from "./_path.mjs";

/** The file name of a dotclaude agent, such as `debugger.md`, or "". */
export function agentFile(agentType) {
  return /^dotclaude:[a-z0-9-]+$/.test(agentType)
    ? `${agentType.slice(10)}.md`
    : "";
}

/** `maxTurns`, `model`, and `effort` from the text of an agent file. */
export function parseDefinition(text) {
  const head = text.split(/^---\s*$/m)[1] ?? "";
  const n = Number(/^maxTurns:\s*(\d+)\s*$/m.exec(head)?.[1]);
  return {
    maxTurns: n > 0 ? n : null,
    model: /^model:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
    effort: /^effort:\s*(\S+)\s*$/m.exec(head)?.[1] ?? "",
    readOnly: /^disallowedTools:.*\bEdit\b/m.test(head),
  };
}

/**
 * `maxTurns`, `model`, `effort`, and `readOnly` (no `Edit`) from a dotclaude
 * agent's definition, or undefined.
 */
export async function definition(io, agentType) {
  const name = agentFile(agentType);
  if (!name) return undefined;
  try {
    const file = pathFor(io.platform).join(io.pluginRoot, "agents", name);
    return parseDefinition(await io.fs.read(file));
  } catch {
    return undefined;
  }
}

/** Turns kept for the report: tool calls are refused once this many remain. */
export function reserve(limit) {
  return Math.max(3, Math.round(limit / 20));
}
