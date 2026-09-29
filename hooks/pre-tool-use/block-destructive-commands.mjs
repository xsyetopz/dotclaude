#!/usr/bin/env bun
// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on, recursive searches that walk
// gitignored build output). Recoverable deletes ask only outside
// auto mode.

import path from "node:path";
import { claudeTrailerOff } from "../lib/_attribution.mjs";
import { check } from "../lib/_bash-rules.mjs";
import { option, projectRoot, run } from "../lib/_common.mjs";
import { ASKS_TEST_REMOVAL } from "../lib/_edit-rules.mjs";
import { planAllowlist } from "../lib/_plans.mjs";
import { recentPrompts } from "../lib/_transcript.mjs";
import { guardDecision } from "../lib/_verdicts.mjs";

const LOCK_ONLY = /fast mode|allowed models/;
const REMOVES_ASSERTIONS = /assertion\(s\) from a test file/;

run((data) => {
  const command = data.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return;
  const guard = option("bash_guard");
  const modelLock = option("model_lock");
  if (!guard && !modelLock) return;
  const root = projectRoot(data);
  let findings = check(command, {
    root,
    cwd: path.resolve(data.cwd || root),
    allowedModels: planAllowlist().list,
    modelLock,
    editGuard: option("edit_guard"),
    commitHygiene: option("commit_hygiene"),
    claudeTrailerOff: claudeTrailerOff(root),
    background: Boolean(data.tool_input?.run_in_background),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  // Read the transcript only when a Bash write removes assertions.
  if (
    findings.some(([, reason]) => REMOVES_ASSERTIONS.test(reason)) &&
    ASKS_TEST_REMOVAL.test(
      recentPrompts(data.transcript_path ?? "", 1, 4000).at(-1) ?? "",
    )
  )
    findings = findings.filter(
      ([, reason]) => !REMOVES_ASSERTIONS.test(reason),
    );
  guardDecision(findings, data, "command");
});
