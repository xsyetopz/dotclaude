#!/usr/bin/env bun

// PreToolUse hook for Edit/Write/NotebookEdit: ask before edits that weaken
// tests or touch generated files; deny settings edits that re-enable fast mode.

import { run } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { ASKS_TEST_REMOVAL, check } from "../lib/_edit-rules.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { oracleFor } from "../lib/_loop.mjs";
import { planAllowlist } from "../lib/_plans.mjs";
import { guardDecision } from "../lib/_verdicts.mjs";

const REMOVES_ASSERTIONS = /assertion\(s\) from a test file/;

run(async (data) => {
  const editGuard = option(process.env, "guard_edit");
  const modelLock = option(process.env, "model_lock");
  if (!editGuard && !modelLock) return;
  let findings = check(data.tool_name ?? "", data.tool_input ?? {}, {
    allowedModels: planAllowlist().list,
    editGuard,
    modelLock,
    oracle: await oracleFor(
      nodeIo(data),
      data,
      projectRoot(nodeIo(data), data),
    ),
  });
  // Read the transcript only when the edit removes assertions: parsing it
  // costs about 25 ms on a long session.
  if (
    findings.some(([, reason]) => REMOVES_ASSERTIONS.test(reason)) &&
    ASKS_TEST_REMOVAL.test(await nodeIo(data).session.lastPrompt())
  )
    findings = findings.filter(
      ([, reason]) => !REMOVES_ASSERTIONS.test(reason),
    );
  guardDecision(findings, data, "edit");
});
