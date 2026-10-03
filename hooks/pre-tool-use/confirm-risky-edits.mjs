// PreToolUse hook for Edit/Write/NotebookEdit: ask before edits that weaken
// tests or touch generated files; deny settings edits that re-enable fast mode.

import { option, projectRoot } from "../lib/_core.mjs";
import { check } from "../lib/_edit-rules.mjs";
import { oracleFor } from "../lib/_loop.mjs";
import { planAllowlist } from "../lib/_plans.mjs";
import { guardDecision } from "../lib/_verdicts.mjs";

export default async function (io, data) {
  const editGuard = option(io.env, "guard_edit");
  const modelLock = option(io.env, "model_lock");
  if (!editGuard && !modelLock) return;
  const findings = await check(data.tool_name ?? "", data.tool_input ?? {}, {
    io,
    allowedModels: (await planAllowlist(io)).list,
    env: io.env,
    editGuard,
    modelLock,
    oracle: await oracleFor(io, data, projectRoot(io, data)),
  });
  return guardDecision(io, findings, data, "edit");
}
