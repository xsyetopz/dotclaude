// Bash guard rules for the fast-mode and model lock.

import { positional } from "./_bash-args.mjs";
import { allowed } from "./_models.mjs";

// --- fast mode and model lock -----------------------------------------------

const FAST_ON = /["']?fastMode["']?\s*[:=]\s*true/i;

const FAST_DENY = "fast mode is turned off by dotclaude's model lock";

export function claude(cmd, ctx) {
  if (!ctx.modelLock) return [];
  const args = cmd.args;
  const out = [];
  args.forEach((a, i) => {
    const value = args[i + 1] ?? "";
    if (
      (a === "--settings" && FAST_ON.test(value)) ||
      (a.startsWith("--settings=") && FAST_ON.test(a))
    )
      out.push(["deny", FAST_DENY]);
    if (
      (a === "--model" || a === "--fallback-model") &&
      value &&
      !allowed(value, ctx.allowedModels)
    ) {
      out.push([
        "deny",
        `model \`${value}\` is outside the allowed models (${ctx.allowedModels.join(", ")})`,
      ]);
    }
  });
  const pos = positional(args);
  if (
    pos[0] === "config" &&
    pos[1] === "set" &&
    /fastmode/i.test(pos[2] ?? "") &&
    (pos[3] ?? "").toLowerCase() !== "false"
  ) {
    out.push(["deny", FAST_DENY]);
  }
  return out;
}

export function modelEnv(cmd, ctx) {
  const out = [];
  const fast = cmd.assigns.CLAUDE_CODE_DISABLE_FAST_MODE;
  if (fast !== undefined && fast !== "1") out.push(["deny", FAST_DENY]);
  for (const key of [
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
  ]) {
    const value = cmd.assigns[key];
    if (value && !allowed(value, ctx.allowedModels))
      out.push(["deny", `\`${key}=${value}\` is outside the allowed models`]);
  }
  return out;
}

/** Shell writes (jq, sed, echo >) that turn fast mode on in a settings file. */
const WRITES_FILE =
  /(^|[^<&0-9])>|\btee\b|\b(sed|perl)\s+(-\w*\s+)*-i|\b(mv|cp|install|dd)\s|\b(python[0-9.]*|node|bun|deno|ruby)\s/;

export function rawSettingsWrite(command) {
  if (!command.includes("settings") || !WRITES_FILE.test(command)) return [];
  if (
    FAST_ON.test(command) ||
    /CLAUDE_CODE_DISABLE_FAST_MODE["']?\s*[:=]\s*["']?0/.test(command)
  ) {
    return [
      ["deny", `${FAST_DENY}; settings writes that enable it are blocked`],
    ];
  }
  if (/disableAllHooks["']?\s*[:=]\s*true/.test(command))
    return [["ask", "command disables all Claude Code hooks"]];
  return [];
}
