// The hooks module of dotclaude: one `tool.check` guard,
// and one `prompt.section` hook that makes the `context_management` section of the system prompt true without compaction.
// Permission rules and the sandbox in the settings profile cover the other dangerous calls.
// This guard covers the two cases that a rule cannot express:
// a recursive `rm` outside the project folder,
// and the first call of a session that reaches a GitHub repository of another owner with an AI policy.
// In auto mode, the classifier decides an ask of `tool.check`,
// so `auto-mode-guard.mjs` gives the same ask from a classic hook in that mode.
//
// It only asks, and it keeps a deny of the engine, so it never weakens a rule of the user.
// The hook has no `.catch` on purpose.
// When it fails after `next` resolved, the verdict of the engine stands, so the guard fails open.
//
// `claude plugin validate` follows `$` only into a function of this file,
// and each `$.env.get` call needs a literal name.
// For this reason, each function that touches `$` is here, and the rules are in `lib/guard.mjs`.

import { POLICY_TIMEOUT_MS } from "../lib/budget.mjs";
import { askReason, LOGIN_ARGV, linesOf, ORGS_ARGV } from "../lib/guard.mjs";

/** The stdout of `argv`, or null when it fails. */
async function output($, argv) {
  try {
    const r = await $.process.run(argv, { timeoutMs: POLICY_TIMEOUT_MS });
    return r.exitCode === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

// The logins of the user and the organizations where the user is an admin, read once.
let owners;
async function ownersOf($) {
  if (!owners) {
    const login = linesOf(await output($, LOGIN_ARGV));
    owners = login.length
      ? [...login, ...linesOf(await output($, ORGS_ARGV))]
      : [];
  }
  return owners;
}

// The repositories that this process checked, for each session.
const checked = new Map();

/** The ask reason for the call of `e`, or undefined. */
async function guardAsk($, e) {
  const [cwd, root, home, tmp, session] = await Promise.all([
    $.session.cwd(),
    $.session.root(),
    $.env.get("HOME"),
    $.env.get("TMPDIR"),
    $.session.id(),
  ]);
  if (!checked.has(session)) checked.set(session, new Set());
  return askReason(e.tool, e.input, {
    cwd,
    root,
    home,
    tmp,
    seen: checked.get(session),
    run: (argv) => output($, argv),
    owners: () => ownersOf($),
  });
}

// The built-in `context_management` section says that the context is summarized when it grows long.
// With `DISABLE_COMPACT` that is false, and the model then spends less care on the size of the context.
// The text is the same for each call, so the cached answer keeps the prompt cache.
const CONTEXT_MANAGEMENT = `# Context management
Compaction is off in this session, so no message is summarized or removed.
When the context reaches its limit, the session stops, and the user starts a fresh session with \`/clear\`.
Each turn reads the whole context again, so keep long output, such as logs and file dumps, out of it, and delegate long reads to a subagent.
Keep the state of work that needs more than one session in the repository, in OpenSpec task checkboxes and commits, because a fresh session starts with only the repository.
Continue the task until it is done, because the user decides when to clear.`;

/** @type {import('claude-code').Register} */
export function register(on) {
  on("prompt.section", { name: "context_management" }, async ($, e, next) => {
    const off = await $.env.get("DISABLE_COMPACT");
    return off && off !== "0" && off !== "false"
      ? { text: CONTEXT_MANAGEMENT }
      : next(e);
  });
  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    if (verdict?.decision === "deny") return verdict;
    const reason = await guardAsk($, e);
    return reason ? { decision: "ask", reason } : verdict;
  });
}
