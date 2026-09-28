#!/usr/bin/env bun
// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on, recursive searches that walk
// gitignored build output). Recoverable deletes ask only outside
// auto mode.

import path from "node:path";
import { claudeTrailerOff } from "../lib/_attribution.mjs";
import { check } from "../lib/_bash-rules.mjs";
import { decide, option, projectRoot, run } from "../lib/_common.mjs";
import { planAllowlist } from "../lib/_plans.mjs";

const LOCK_ONLY = /fast mode|allowed models/;

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
    commitHygiene: option("commit_hygiene"),
    claudeTrailerOff: claudeTrailerOff(root),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  decide(findings, data, "command");
});
