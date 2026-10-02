#!/usr/bin/env bun

// PostToolUse(*): replace secrets in a tool's output before the model sees
// it. Betterleaks scans every string in the output, and each secret it finds
// becomes `[REDACTED:<rule>]`; the rest of the output and its shape stay.
// Claude Code applies `updatedToolOutput` to every tool (2.1.283). Without
// betterleaks on PATH, output passes through and session start says so.

import { emit, run } from "../lib/_common.mjs";
import { option } from "../lib/_core.mjs";
import { redact, scan, strings } from "../lib/_secrets.mjs";

run(async (data) => {
  if (!option(process.env, "guard_secrets")) return;
  const output = data.tool_response;
  if (output === undefined || output === null) return;
  const findings = await scan(strings(output).join("\n"));
  if (!findings?.length) return;
  const { value, count } = redact(output, findings);
  if (!count) return;
  const rules = [...new Set(findings.map((f) => `\`${f.rule}\``))].join(", ");
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: value,
      additionalContext: `This hook redacted ${count} secret${count === 1 ? "" : "s"} (${rules}) from this tool output. Do not try to recover the values. Refer to each secret by its variable or file name.`,
    },
  });
});
