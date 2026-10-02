#!/usr/bin/env bun
// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on, recursive searches that walk
// gitignored build output). Recoverable deletes ask only outside
// auto mode.

import path from "node:path";
import { claudeTrailerOff } from "../lib/_attribution.mjs";
import { check } from "../lib/_bash-rules.mjs";
import { emit, run } from "../lib/_common.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { ASKS_TEST_REMOVAL } from "../lib/_edit-rules.mjs";
import { nodeIo } from "../lib/_io-node.mjs";
import { oracleFor } from "../lib/_loop.mjs";
import { planAllowlist } from "../lib/_plans.mjs";
import { guardDecision } from "../lib/_verdicts.mjs";

const LOCK_ONLY = /fast mode|allowed models/;
const REMOVES_ASSERTIONS = /assertion\(s\) from a test file/;

run(async (data) => {
  const command = data.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return;
  const guard = option(process.env, "guard_bash");
  const modelLock = option(process.env, "model_lock");
  if (!guard && !modelLock) return;
  const io = nodeIo(data);
  const root = projectRoot(io, data);
  let findings = check(command, {
    root,
    cwd: path.resolve(data.cwd || root),
    allowedModels: (await planAllowlist(io)).list,
    env: io.env,
    modelLock,
    editGuard: option(process.env, "guard_edit"),
    commitHygiene: option(process.env, "git_commit_hygiene"),
    claudeTrailerOff: await claudeTrailerOff(io, root),
    background: Boolean(data.tool_input?.run_in_background),
    oracle: await oracleFor(nodeIo(data), data, root),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  // Read the transcript only when a Bash write removes assertions.
  if (
    findings.some(([, reason]) => REMOVES_ASSERTIONS.test(reason)) &&
    ASKS_TEST_REMOVAL.test(await io.session.lastPrompt())
  )
    findings = findings.filter(
      ([, reason]) => !REMOVES_ASSERTIONS.test(reason),
    );
  const out = await guardDecision(io, findings, data, "command");
  if (out) emit(out);
});
