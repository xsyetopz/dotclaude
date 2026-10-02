// PostToolUse(*): replace secrets in a tool's output before the model sees
// it. Betterleaks scans every string in the output, and each secret it finds
// becomes `[REDACTED:<rule>]`; the rest of the output and its shape stay.
// Claude Code applies `updatedToolOutput` to every tool (2.1.283). Without
// betterleaks on PATH, output passes through and session start says so.

import { option } from "../lib/_core.mjs";
import { redact, scan, strings } from "../lib/_secrets.mjs";

export default async function (io, data) {
  if (!option(io.env, "guard_secrets")) return;
  const output = data.tool_response;
  if (output === undefined || output === null) return;
  const findings = await scan(io, strings(output).join("\n"));
  if (!findings?.length) return;
  const { value, count } = redact(output, findings);
  if (!count) return;
  const rules = [...new Set(findings.map((f) => `\`${f.rule}\``))].join(", ");
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: value,
      additionalContext: `This hook redacted ${count} secret${count === 1 ? "" : "s"} (${rules}) from this output to keep them private. Do not look for them. Refer to each by its variable or file name.`,
    },
  };
}
