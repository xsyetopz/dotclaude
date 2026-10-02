// Bash guard rules for the fast-mode and model lock.

import { positional } from "./_bash-args.mjs";
import { allowed, effortLevels } from "./_models.mjs";

// --- fast mode and model lock -----------------------------------------------

const FAST_ON = /["']?fastMode["']?\s*[:=]\s*true/i;
const FAST_DENY = "dotclaude's model lock disables fast mode";

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
      !allowed(value, ctx.allowedModels, ctx.env)
    ) {
      out.push([
        "deny",
        `model \`${value}\` is outside the allowed models (${ctx.allowedModels.map((m) => `\`${m}\``).join(", ")}). Use an allowed model`,
      ]);
    }
  });
  out.push(...cliEffort(cmd, ctx));
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

/** The value of `--name value` or `--name=value`, or "". */
function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1] ?? "";
  return (
    args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? ""
  );
}

/** A `claude` run whose model and effort are outside EFFORT_LEVELS. */
function cliEffort(cmd, ctx) {
  const model = flagValue(cmd.args, "--model");
  const levels = model ? effortLevels(model, ctx.env) : null;
  const effort =
    cmd.assigns.CLAUDE_CODE_EFFORT_LEVEL || flagValue(cmd.args, "--effort");
  if (!levels || !effort || levels.includes(effort)) return [];
  return [
    [
      "deny",
      `dotclaude supports \`${model}\` only at the effort levels ${levels.map((l) => `\`${l}\``).join(", ")}, not \`${effort}\`. Work that needs more effort than Sonnet 5.5 \`high\` needs judgment, so run it on Opus 5.5 at \`xhigh\` or lower`,
    ],
  ];
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
    if (value && !allowed(value, ctx.allowedModels, ctx.env))
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
    return [["deny", `${FAST_DENY} and blocks settings writes that enable it`]];
  }
  if (/disableAllHooks["']?\s*[:=]\s*true/.test(command))
    return [["ask", "the command disables all Claude Code hooks"]];
  return [];
}
