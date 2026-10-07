// PreToolUse: asks before a Bash command or an edit that a guard finds,
// and before each `PublishPlugin` call.
// In auto mode, the auto-mode classifier decides an ask of the module
// (`tool.check`), and it can allow the call. An ask of a classic PreToolUse
// hook stays an ask, so the user sees a prompt (measured, Claude Code 2.1.289).
// It also asks before the first call of a session that reaches a project of
// another owner with an AI policy file: a fetch from a GitHub repository, or
// a path in a local clone outside the project.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POLICY_FETCH_TIMEOUT_MS } from "../../lib/budget.mjs";
import {
  LOGIN_ARGV,
  linesOf,
  ORGS_ARGV,
  ownRepo,
} from "../../lib/guards/attribution.mjs";
import { askFor } from "../../lib/guards/bash.mjs";
import { editReasons, PUBLISH_PLUGIN_REASON } from "../../lib/guards/edit.mjs";
import {
  fetchedRepos,
  outsidePaths,
  POLICY_FILES,
  policyCommand,
  policyReason,
  policySection,
  within,
} from "../../lib/guards/policy.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** A plugin option is on unless the user turned it off. */
const on = (value) => value !== "false";

/** The reason to ask about the tool call in `data`, or undefined. */
export function askReason(data, env = process.env) {
  const input = data.tool_input ?? {};
  if (data.tool_name === "Bash" && on(env.CLAUDE_PLUGIN_OPTION_GUARD_BASH)) {
    const project = env.CLAUDE_PROJECT_DIR || data.cwd || "";
    const found = askFor(String(input.command ?? ""), {
      cwd: data.cwd || project,
      project,
      home: env.HOME || os.homedir(),
    });
    return found.length
      ? found.map((f) => `\`${f.part}\`: ${f.reason}`).join(" ")
      : undefined;
  }
  if (
    EDIT_TOOLS.has(data.tool_name) &&
    on(env.CLAUDE_PLUGIN_OPTION_GUARD_EDIT)
  ) {
    let existing = null;
    if (data.tool_name === "Write" && input.file_path)
      try {
        existing = fs.readFileSync(input.file_path, "utf8");
      } catch {
        // A new or unreadable file has no old text.
      }
    return editReasons(data.tool_name, input, existing).join(" ") || undefined;
  }
  if (data.tool_name === "PublishPlugin") return PUBLISH_PLUGIN_REASON;
  return undefined;
}

/** The output of `argv` in `cwd`, or null when it fails. */
const run = (argv, cwd) =>
  new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { cwd, encoding: "utf8", timeout: POLICY_FETCH_TIMEOUT_MS },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

/** The file of the repositories and folders that the session checked. */
const seenFile = (env, id) =>
  path.join(env.CLAUDE_PLUGIN_DATA || os.tmpdir(), `policy-seen-${id}.json`);

/** The nearest folder of `p` that exists. */
function existingDir(p) {
  let dir = p;
  while (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const up = path.dirname(dir);
    if (up === dir) return dir;
    dir = up;
  }
  return dir;
}

const readOr = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * The reason to ask before the first call of the session that reaches a
 * project of another owner with an AI policy file, or undefined. Each
 * repository and folder is checked once for each session. `exec` runs a
 * command and gives its output or null, so that tests can give a fake.
 */
export async function policyAsk(data, env = process.env, exec = run) {
  if (!on(env.CLAUDE_PLUGIN_OPTION_GUARD_POLICY)) return undefined;
  const input = data.tool_input ?? {};
  const project = env.CLAUDE_PROJECT_DIR || data.cwd || "";
  const file = data.session_id ? seenFile(env, data.session_id) : null;
  let seen = [];
  try {
    seen = JSON.parse(readOr(file) ?? "[]");
  } catch {}
  const fresh = (key) => !seen.includes(key) && seen.push(key);
  let owners;
  const isOwn = async (remotes) => {
    if (!owners) {
      owners = linesOf(await exec(LOGIN_ARGV, project));
      if (owners.length)
        owners.push(...linesOf(await exec(ORGS_ARGV, project)));
    }
    return ownRepo(remotes, owners);
  };
  const reasons = [];
  for (const repo of fetchedRepos(data.tool_name, input).filter(fresh)) {
    if (await isOwn(`origin https://github.com/${repo}`)) continue;
    const texts = await Promise.all(
      POLICY_FILES.map((name) => exec(policyCommand(repo, name), project)),
    );
    reasons.push(policyReason(repo, texts));
  }
  const home = env.HOME || os.homedir();
  for (const p of outsidePaths(data.tool_name, input, project, home)) {
    const dir = existingDir(p);
    if (!fresh(dir)) continue;
    const top = await exec(["git", "rev-parse", "--show-toplevel"], dir);
    // On Windows, git prints the root with `/`.
    const root = top?.trim();
    if (!root || within(root, project) || !fresh(root)) continue;
    const texts = POLICY_FILES.map((name) => readOr(path.join(root, name)));
    if (!texts.some(Boolean)) continue;
    // A clone with no remote is a local project of the user.
    const remotes = (await exec(["git", "remote", "-v"], root))?.trim();
    if (!remotes || (await isOwn(remotes))) continue;
    reasons.push(policyReason(root, texts));
  }
  if (file)
    try {
      fs.writeFileSync(file, JSON.stringify(seen));
    } catch {}
  return reasons.filter(Boolean).join("\n\n") || undefined;
}

if (import.meta.main) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    // No input: no decision.
  }
  const policy = await policyAsk(data).catch(() => undefined);
  const reason =
    [askReason(data), policy].filter(Boolean).join(" ") || undefined;
  // Only the user sees an ask reason, so Claude gets the policy as context.
  if (reason)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: reason,
          ...(policy && {
            additionalContext: `${policySection()}\n\n${policy}`,
          }),
        },
      }),
    );
}
