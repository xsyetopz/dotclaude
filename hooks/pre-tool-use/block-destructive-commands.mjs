#!/usr/bin/env bun
// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on).

import path from "node:path";
import { check } from "../lib/_bash-rules.mjs";
import {
  option,
  optionList,
  preToolDecision,
  projectRoot,
  run,
} from "../lib/_common.mjs";
import { DEFAULT_ALLOWED } from "../lib/_models.mjs";

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
    allowedModels: optionList("allowed_models", DEFAULT_ALLOWED),
    modelLock,
    commitHygiene: option("commit_hygiene"),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  if (!findings.length) return;
  const denied = findings
    .filter(([level]) => level === "deny")
    .map(([, reason]) => reason);
  if (denied.length) {
    preToolDecision(
      "deny",
      `dotclaude blocked this command: ${denied.join("; ")}. If the user wants it run, they can run it themselves with \`! <command>\`.`,
    );
  } else {
    preToolDecision(
      "ask",
      `dotclaude: ${findings.map(([, reason]) => reason).join("; ")}`,
    );
  }
});
