// PreToolUse hook for Bash: ask before destructive or public commands, deny
// the few that are never intended (root/home deletes, decoded payloads piped
// to a shell, turning fast mode back on, recursive searches that walk
// gitignored build output). Recoverable deletes ask only outside
// auto mode.

import { claudeTrailerOff } from "../lib/_attribution.mjs";
import { check } from "../lib/_bash-rules.mjs";
import { option, projectRoot } from "../lib/_core.mjs";
import { oracleFor } from "../lib/_loop.mjs";
import { pathFor } from "../lib/_path.mjs";
import { planAllowlist } from "../lib/_plans.mjs";
import { guardDecision } from "../lib/_verdicts.mjs";

const LOCK_ONLY = /fast mode|allowed models/;

export default async function (io, data) {
  const command = data.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) return;
  const guard = option(io.env, "guard_bash");
  const modelLock = option(io.env, "model_lock");
  if (!guard && !modelLock) return;
  const root = projectRoot(io, data);
  let findings = await check(command, {
    io,
    root,
    cwd: pathFor(io.platform).resolve(io.cwd, data.cwd || root),
    allowedModels: (await planAllowlist(io)).list,
    env: io.env,
    modelLock,
    editGuard: option(io.env, "guard_edit"),
    commitHygiene: option(io.env, "git_commit_hygiene"),
    claudeTrailerOff: await claudeTrailerOff(io, root),
    background: Boolean(data.tool_input?.run_in_background),
    oracle: await oracleFor(io, data, root),
  });
  if (!guard)
    findings = findings.filter(([, reason]) => LOCK_ONLY.test(reason));
  return guardDecision(io, findings, data, "command");
}
