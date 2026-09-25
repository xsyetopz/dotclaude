#!/usr/bin/env bun

// PreToolUse hook for Edit/Write/NotebookEdit: ask before edits that weaken
// tests or touch generated files; deny settings edits that re-enable fast mode.

import { option, optionList, preToolDecision, run } from "../lib/_common.mjs";
import { check } from "../lib/_edit-rules.mjs";
import { DEFAULT_ALLOWED } from "../lib/_models.mjs";

run((data) => {
  const editGuard = option("edit_guard");
  const modelLock = option("model_lock");
  if (!editGuard && !modelLock) return;
  const findings = check(data.tool_name ?? "", data.tool_input ?? {}, {
    allowedModels: optionList("allowed_models", DEFAULT_ALLOWED),
    editGuard,
    modelLock,
  });
  if (!findings.length) return;
  const denied = findings
    .filter(([level]) => level === "deny")
    .map(([, reason]) => reason);
  if (denied.length) {
    preToolDecision(
      "deny",
      `dotclaude blocked this edit: ${denied.join("; ")}.`,
    );
  } else {
    preToolDecision(
      "ask",
      `dotclaude: ${findings.map(([, reason]) => reason).join("; ")}`,
    );
  }
});
