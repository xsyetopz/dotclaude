#!/usr/bin/env bun
// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on). Recoverable deletes ask only outside
// auto mode.

import path from "node:path";
import { check } from "../lib/_bash-rules.mjs";
import { codexPlan, configuredModel } from "../lib/_codex.mjs";
import {
  decide,
  option,
  optionList,
  projectRoot,
  run,
} from "../lib/_common.mjs";
import { DEFAULT_ALLOWED, DEFAULT_CODEX } from "../lib/_models.mjs";

const LOCK_ONLY =
  /fast mode|allowed models|allowed Codex models|ChatGPT \w+ plan|Codex's sandbox/;

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
    codexModels: optionList("allowed_codex_models", DEFAULT_CODEX).map((m) =>
      m.toLowerCase(),
    ),
    codexPlan,
    codexConfiguredModel: configuredModel,
    modelLock,
    commitHygiene: option("commit_hygiene"),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  decide(findings, data, "command");
});
