#!/usr/bin/env bun

// PreToolUse hook for Edit/Write/NotebookEdit: ask before edits that weaken
// tests or touch generated files; deny settings edits that re-enable fast mode.

import { decide, option, optionList, run } from "../lib/_common.mjs";
import { ASKS_TEST_REMOVAL, check } from "../lib/_edit-rules.mjs";
import { DEFAULT_ALLOWED } from "../lib/_models.mjs";
import { recentPrompts } from "../lib/_transcript.mjs";

run((data) => {
  const editGuard = option("edit_guard");
  const modelLock = option("model_lock");
  if (!editGuard && !modelLock) return;
  const findings = check(data.tool_name ?? "", data.tool_input ?? {}, {
    allowedModels: optionList("allowed_models", DEFAULT_ALLOWED),
    editGuard,
    modelLock,
    testRemovalRequested:
      editGuard &&
      ASKS_TEST_REMOVAL.test(
        recentPrompts(data.transcript_path ?? "", 1, 4000).at(-1) ?? "",
      ),
  });
  decide(findings, data, "edit");
});
