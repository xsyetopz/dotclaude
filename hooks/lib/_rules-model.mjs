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

/** The `-p`/`--profile` name on a `codex` command line, or null. */
function codexProfile(args) {
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "-p" || args[i] === "--profile") && args[i + 1])
      return args[i + 1];
    if (args[i].startsWith("--profile=")) return args[i].slice(10);
  }
  return null;
}

/** Model a `codex` command line asks for (-m, --model, -c model=...), or null. */
function codexModel(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1] ?? "";
    if (a === "-m" || a === "--model") return next;
    if (a.startsWith("--model=")) return a.slice(8);
    const config =
      a === "-c" || a === "--config"
        ? next
        : a.startsWith("--config=")
          ? a.slice(9)
          : null;
    const m = config && /^model\s*=\s*["']?([^"']+)["']?$/.exec(config.trim());
    if (m) return m[1];
  }
  return null;
}

// Models too expensive for a plan's quota: Astra on Plus drains the 5-hour
// window in a few tasks, so Plus runs Luna only.
const PLAN_DENIED = { plus: ["gpt-6-astra"] };

// Codex flags and overrides that remove its sandbox or approvals, skip hook
// trust, or switch to the fast (priority) tier, which costs 2.5x credits.
const CODEX_BYPASS = /^--dangerously-bypass-/;
const CODEX_FAST =
  /^(service_tier\s*=\s*["']?(fast|priority)|features\.fast_mode\s*=\s*true)/;

function codexSafety(args) {
  const out = [];
  args.forEach((a, i) => {
    const value = args[i + 1] ?? "";
    if (CODEX_BYPASS.test(a))
      out.push([
        "deny",
        `\`codex ${a}\` turns off Codex's sandbox, approvals, or hook trust`,
      ]);
    const config =
      a === "-c" || a === "--config"
        ? value
        : a.startsWith("--config=")
          ? a.slice(9)
          : null;
    const enabled =
      a === "--enable" ? value : a.startsWith("--enable=") ? a.slice(9) : null;
    if ((config && CODEX_FAST.test(config.trim())) || enabled === "fast_mode")
      out.push([
        "deny",
        "Codex fast mode and the priority tier are off under dotclaude's model lock",
      ]);
  });
  return out;
}

/** OpenAI models the Codex agents may use; others are denied by name. */
export function codex(cmd, ctx) {
  if (!ctx.modelLock) return [];
  const safety = codexSafety(cmd.args);
  if (safety.length) return safety;
  const explicit = codexModel(cmd.args);
  const list = ctx.codexModels ?? [];
  const plan = ctx.codexPlan?.() ?? null;
  // Only an explicit model is checked against the allowlist; a model from the
  // profile or base config also counts for the plan check, since `-p` with an
  // Astra profile on Plus costs the same as `-m gpt-6-astra`.
  const configured = explicit
    ? null
    : (ctx.codexConfiguredModel?.(codexProfile(cmd.args)) ?? null);
  const resolved = (explicit ?? configured)?.trim().toLowerCase();
  if (!resolved) return [];
  const model = resolved;
  if (explicit && list.length && !list.includes(model))
    return [
      [
        "deny",
        `Codex model \`${model}\` is outside the allowed Codex models (${list.join(", ")})`,
      ],
    ];
  if (plan && PLAN_DENIED[plan]?.includes(model))
    return [
      [
        "deny",
        `Codex model \`${model}\` is not used on the ChatGPT ${plan} plan; use gpt-6-luna`,
      ],
    ];
  return [];
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
