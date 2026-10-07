// The classic PreToolUse hook of dotclaude, for auto mode only.
// In auto mode, the classifier decides an ask of the `tool.check` guard in `mod.mjs`,
// and it can approve the call with no prompt (measured on Claude Code 2.1.292).
// An ask of a classic hook "can't approve the call silently" in auto mode (hooks docs),
// so this script gives the same ask as `mod.mjs` from a classic hook in that mode.
// In each other mode it exits at once, because `mod.mjs` covers the call in-process.
//
// The `if` filters in `hooks.json` start this script only for the commands that the rules can match.
// It fails open: on an error, it prints nothing, and the permission flow of Claude Code decides.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY_TIMEOUT_MS } from "../lib/budget.mjs";
import { askReason, LOGIN_ARGV, linesOf, ORGS_ARGV } from "../lib/guard.mjs";

/** The stdout of `argv`, or null when it fails. */
function output(argv) {
  const r = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: POLICY_TIMEOUT_MS,
  });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The PreToolUse output for `payload`, or undefined.
 * `state` holds `seen` (the repositories that the session checked) and `owners` (null until read),
 * and the function changes it.
 */
export async function decide(payload, env, state, run = output) {
  if (payload?.permission_mode !== "auto") return undefined;
  const seen = new Set(state.seen);
  const reason = await askReason(payload.tool_name, payload.tool_input, {
    cwd: payload.cwd,
    root: env.CLAUDE_PROJECT_DIR || payload.cwd,
    home: env.HOME,
    tmp: env.TMPDIR,
    seen,
    run: async (argv) => run(argv),
    owners: async () => {
      if (!state.owners) {
        const login = linesOf(await run(LOGIN_ARGV));
        state.owners = login.length
          ? [...login, ...linesOf(await run(ORGS_ARGV))]
          : [];
      }
      return state.owners;
    },
  });
  state.seen = [...seen];
  if (!reason) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  };
}

if (import.meta.main) {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    if (payload.permission_mode === "auto") {
      const dir = join(
        process.env.CLAUDE_PLUGIN_DATA || tmpdir(),
        "auto-mode-guard",
      );
      const file = join(
        dir,
        `${String(payload.session_id).replace(/[^\w-]/g, "_")}.json`,
      );
      let state = { seen: [], owners: null };
      try {
        state = JSON.parse(readFileSync(file, "utf8"));
      } catch {}
      const out = await decide(payload, process.env, state);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(state));
      if (out) process.stdout.write(JSON.stringify(out));
    }
  } catch {}
}
