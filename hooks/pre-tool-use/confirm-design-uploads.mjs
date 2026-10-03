// PreToolUse(DesignSync): a write to Claude Design outside the `/design-sync` skill asks the user.
// The tool description limits `DesignSync` to that skill, which the user starts.
// Claude Code can hide the skill and still offer the tool,
// and then Claude can upload project files that the user did not choose to send.
// The read methods are the ones that Claude Code itself treats as read-only.

import { option, preToolOutput } from "../lib/_core.mjs";

const SKILL = "design-sync";
const READS = new Set([
  "list_projects",
  "get_project",
  "list_files",
  "get_file",
  "report_validate",
]);

export default async function (io, data) {
  if (!option(io.env, "guard_bash")) return;
  const method = String(data.tool_input?.method ?? "");
  if (READS.has(method)) return;
  if (await io.session.skillStarted(SKILL)) return;
  // Claude Code shows an `ask` reason to the user, not to Claude.
  return preToolOutput(
    "ask",
    `\`DesignSync\` \`${method}\` changes a Claude Design project outside the \`/${SKILL}\` skill, which the tool description requires. Approve only if you asked for this upload.`,
  );
}
