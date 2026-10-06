// The hooks module of dotclaude. It runs in Claude Code with no Node and no
// Bun, and reaches the host only through the engine's `$`.
//
// `claude plugin validate` follows `$` only into a function of this file and
// refuses `$` as a value. Thus each function that touches `$` is here, and
// each `$.env.get` call has its name as a literal. The rules are pure
// functions in `lib/`.

import {
  CODEGRAPH_INDEX_TIMEOUT_MS,
  CODEGRAPH_SYNC_TIMEOUT_MS,
  CODEGRAPH_TIMEOUT_MS,
  HANDOFF_FORK_TIMEOUT_MS,
  HANDOFF_SESSIONS_MAX,
  POLICY_FETCH_TIMEOUT_MS,
  SECRET_SCAN_MAX_BYTES,
  SECRET_SCAN_TIMEOUT_MS,
  SEMBR_TIMEOUT_MS,
} from "../../lib/budget.mjs";
import {
  parseDefinition,
  pinnedModel,
  spawnDenial,
} from "../../lib/guards/agents.mjs";
import {
  CLAUDE_TRAILER,
  hasClaudeAttribution,
  LOGIN_ARGV,
  linesOf,
  mergeSettings,
  ORGS_ARGV,
  OTHER_OWNER_REASON,
  ownRepo,
  settingsPaths,
  TRAILER_OFF_REASON,
  trailerOff,
} from "../../lib/guards/attribution.mjs";
import {
  askFor,
  autoModeText,
  isCommit,
  writeFor,
} from "../../lib/guards/bash.mjs";
import { editReasons, PUBLISH_PLUGIN_REASON } from "../../lib/guards/edit.mjs";
import {
  fetchedRepos,
  POLICY_FILES,
  policyCommand,
  policyNote,
} from "../../lib/guards/policy.mjs";
import {
  findingsOf,
  redact,
  redactionNote,
  SCAN_ARGS,
  strings,
} from "../../lib/guards/secrets.mjs";
import { idleNote } from "../../lib/notes/cache.mjs";
import {
  definitionOf,
  graphCommands,
  graphNote,
  INDEX_COMMAND,
  indexState,
  queryCommand,
  STATUS_COMMAND,
  SYNC_COMMAND,
  searchSymbol,
} from "../../lib/notes/codegraph.mjs";
import {
  COMPACT_TEXT,
  HANDOFF_PROMPT,
  handoffFile,
  handoffPath,
  handoffRow,
  supersede,
} from "../../lib/notes/compact.mjs";
import {
  COMMAND_NOTE,
  GH_MESSAGE,
  lineBreakFixes,
  lineBreakNote,
  proseKind,
  rewrapCommand,
} from "../../lib/notes/sembr.mjs";
import {
  accountFrom,
  cacheTtlMs,
  claudeJsonPath,
  detectPlan,
} from "../../lib/plan.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

let plan;
/** The plan of the user, read once for each session. */
async function sessionPlan($) {
  if (plan) return plan;
  // Each name is a literal, so that `claude plugin validate` lists it.
  const [HOME, CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY, BEDROCK, VERTEX, FOUNDRY] =
    await Promise.all([
      $.env.get("HOME"),
      $.env.get("CLAUDE_CONFIG_DIR"),
      $.env.get("ANTHROPIC_API_KEY"),
      $.env.get("CLAUDE_CODE_USE_BEDROCK"),
      $.env.get("CLAUDE_CODE_USE_VERTEX"),
      $.env.get("CLAUDE_CODE_USE_FOUNDRY"),
    ]);
  const env = {
    HOME,
    CLAUDE_CONFIG_DIR,
    ANTHROPIC_API_KEY,
    CLAUDE_CODE_USE_BEDROCK: BEDROCK,
    CLAUDE_CODE_USE_VERTEX: VERTEX,
    CLAUDE_CODE_USE_FOUNDRY: FOUNDRY,
  };
  const text = await $.fs.read(claudeJsonPath(env)).catch(() => "");
  plan = detectPlan(env, accountFrom(text));
  return plan;
}

/** A plugin option is on unless the user turned it off. */
const enabled = (options, name) =>
  options?.[name] !== false && options?.[name] !== "false";

/** The folders that the Bash guard reads: `cwd`, `project`, `home`, and `tmp`. */
async function bashContext($) {
  const [cwd, project, home, tmp] = await Promise.all([
    $.session.cwd().catch(() => ""),
    $.session.root().catch(() => ""),
    $.env.get("HOME"),
    $.env.get("TMPDIR"),
  ]);
  return { cwd: cwd || project, project, home, tmp };
}

const findingText = (found) =>
  found.length
    ? found.map((f) => `\`${f.part}\`: ${f.reason}`).join(" ")
    : undefined;

/** The reason to deny a Bash call that writes a project file, or undefined. */
async function writeDenial($, e, options) {
  if (e.tool !== "Bash" || !enabled(options, "guard_bash")) return undefined;
  return findingText(writeFor(String(e.command ?? ""), await bashContext($)));
}

/** The reason to ask about a tool call, or undefined. */
async function askReason($, e, options) {
  if (e.tool === "Bash" && enabled(options, "guard_bash"))
    return findingText(askFor(String(e.command ?? ""), await bashContext($)));
  if (EDIT_TOOLS.has(e.tool) && enabled(options, "guard_edit")) {
    const existing =
      e.tool === "Write" && e.file_path
        ? await $.fs.read(e.file_path).catch(() => null)
        : null;
    return editReasons(e.tool, e, existing).join(" ") || undefined;
  }
  if (e.tool === "PublishPlugin") return PUBLISH_PLUGIN_REASON;
  return undefined;
}

/** The output of `argv` in `cwd`, or null when it fails. */
async function output($, argv, cwd) {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 3000 });
    return r.exitCode === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

/**
 * The verdict for a `git commit` with a Claude attribution line, or
 * undefined. It asks in a repository of another owner, and it denies a
 * Claude trailer in a repository of the user when the settings leave it out.
 */
async function trailerVerdict($, e, options) {
  const command = String(e.command ?? "");
  if (e.tool !== "Bash" || !enabled(options, "guard_bash")) return undefined;
  if (!hasClaudeAttribution(command) || !isCommit(command)) return undefined;
  const [cwd, root] = await Promise.all([
    $.session.cwd().catch(() => ""),
    $.session.root().catch(() => ""),
  ]);
  const dir = cwd || root;
  const remotes = await output($, ["git", "remote", "-v"], dir);
  if (remotes === null) return undefined;
  const owners = linesOf(await output($, LOGIN_ARGV, dir));
  if (remotes && !ownRepo(remotes, owners) && owners.length)
    owners.push(...linesOf(await output($, ORGS_ARGV, dir)));
  if (remotes && !ownRepo(remotes, owners))
    return { decision: "ask", reason: OTHER_OWNER_REASON };
  const [config, home] = await Promise.all([
    $.env.get("CLAUDE_CONFIG_DIR"),
    $.env.get("HOME"),
  ]);
  const texts = await Promise.all(
    settingsPaths(config || `${home}/.claude`, root || dir).map((file) =>
      $.fs.read(file).catch(() => ""),
    ),
  );
  return trailerOff(mergeSettings(texts)) && CLAUDE_TRAILER.test(command)
    ? { decision: "deny", reason: TRAILER_OFF_REASON }
    : undefined;
}

/** `run(argv, stdin)` for `sembr`, in the temporary folder. */
const sembrRun = ($) => async (argv, stdin) =>
  $.process.run(argv, {
    cwd: (await $.env.get("TMPDIR")) || "/tmp",
    stdin,
    timeoutMs: SEMBR_TIMEOUT_MS,
  });

/**
 * The command of a commit or a `gh` message with semantic line breaks, or
 * undefined when it stays the same.
 */
async function messageCommand($, e, options) {
  if (e.tool !== "Bash" || !enabled(options, "sembr")) return undefined;
  const command = String(e.command ?? "");
  const commit = isCommit(command);
  if (!commit && !GH_MESSAGE.test(command)) return undefined;
  const out = await rewrapCommand(sembrRun($), command, commit);
  return out === command ? undefined : out;
}

/** The new text of an edit, or undefined for another tool. */
function editText(e) {
  switch (e.tool) {
    case "Edit":
      return e.new_string;
    case "MultiEdit":
      return Array.isArray(e.edits)
        ? e.edits.map((x) => x.new_string ?? "").join("\n\n")
        : undefined;
    case "Write":
      return e.content;
    default:
      return undefined;
  }
}

/** The note about prose that an edit wrote with column breaks, or undefined. */
async function lineBreaks($, e, options) {
  if (!enabled(options, "sembr")) return undefined;
  const text = editText(e);
  const file = String(e.file_path ?? "");
  const kind = proseKind(file);
  if (typeof text !== "string" || !kind) return undefined;
  const fixes = await lineBreakFixes(sembrRun($), text, kind);
  return fixes?.length
    ? lineBreakNote(file.split("/").pop(), fixes)
    : undefined;
}

/**
 * The secrets that Betterleaks finds in `text`, or null when it is missing,
 * fails, or gives a report that is not valid.
 */
async function scan($, text) {
  if (!text) return null;
  const tmp = (await $.env.get("TMPDIR")) || "/tmp";
  try {
    const result = await $.process.run(SCAN_ARGS, {
      cwd: tmp,
      stdin: text,
      timeoutMs: SECRET_SCAN_TIMEOUT_MS,
    });
    if (result.exitCode !== 0 || result.isStdoutTruncated) return null;
    if (result.stdout.length > SECRET_SCAN_MAX_BYTES) return null;
    return findingsOf(result.stdout);
  } catch {
    // Betterleaks is missing, or it passed the timeout.
    return null;
  }
}

/**
 * The state of the index at `root`, after a `codegraph index` when the index
 * has an old format, or a `codegraph sync` when files changed since the last
 * index. The user approved both for an index that exists, but the hook never
 * builds a new one. After a failed run, the session does not try again, so a
 * slow run does not delay each search.
 */
async function currentIndex(run, root, graph) {
  const status = await run(STATUS_COMMAND).catch(() => null);
  const index = indexState(status?.stdout);
  if (!(index.reindex || index.pending) || graph.failed.has(root)) return index;
  const update = await (index.reindex
    ? run(INDEX_COMMAND, CODEGRAPH_INDEX_TIMEOUT_MS)
    : run(SYNC_COMMAND, CODEGRAPH_SYNC_TIMEOUT_MS)
  ).catch(() => null);
  if (update?.exitCode === 0) return { state: "ok" };
  graph.failed.add(root);
  return index;
}

/**
 * The CodeGraph notes for a search of one symbol name: the callers and
 * callees once for each symbol in each context, and a note once for each
 * project when the index stays stale. A project with no index or no
 * `codegraph` gets nothing. `graph` holds the state of the session, and
 * `graph.syncs` lets parallel searches share one sync.
 */
async function graphNotes($, e, graph) {
  const symbol = searchSymbol(e);
  if (!symbol) return [];
  const root = await $.session.root();
  const key = `${root}\n${e.agentId ?? "main"}\n${symbol}`;
  if (graph.seen.has(key)) return [];
  const run = (argv, timeoutMs = CODEGRAPH_TIMEOUT_MS) =>
    $.process.run(argv, { cwd: root, timeoutMs });
  let pending = graph.syncs.get(root);
  if (!pending) {
    pending = currentIndex(run, root, graph).finally(() =>
      graph.syncs.delete(root),
    );
    graph.syncs.set(root, pending);
  }
  const index = await pending;
  if (index.state === "none") return [];
  graph.seen.add(key);
  const notes = [];
  if (index.note && !graph.warned.has(root)) {
    graph.warned.add(root);
    notes.push(index.note);
  }
  const query = await run(queryCommand(symbol)).catch(() => null);
  const definition = definitionOf(query?.stdout, symbol);
  if (!definition) return notes;
  const [callers, callees] = await Promise.all(
    graphCommands(symbol).map((argv) => run(argv).catch(() => null)),
  );
  const note = graphNote(definition, callers?.stdout, callees?.stdout);
  return note ? [...notes, note] : notes;
}

/**
 * The AI policy notes after a call fetched from a GitHub repository: once
 * for each repository in each context. A repository with no policy file, or
 * a failed `gh`, gives nothing.
 */
async function policyNotes($, e, seen) {
  const input = { command: e.command, url: e.url };
  const repos = fetchedRepos(e.tool, input).filter((repo) => {
    const key = `${e.agentId ?? "main"}\n${repo}`;
    return !seen.has(key) && seen.add(key);
  });
  if (!repos.length) return [];
  const root = await $.session.root();
  const read = (argv) =>
    $.process
      .run(argv, { cwd: root, timeoutMs: POLICY_FETCH_TIMEOUT_MS })
      .then((r) => (r.exitCode === 0 ? r.stdout : null))
      .catch(() => null);
  const notes = await Promise.all(
    repos.map(async (repo) =>
      policyNote(
        repo,
        await Promise.all(
          POLICY_FILES.map((name) => read(policyCommand(repo, name))),
        ),
      ),
    ),
  );
  return notes.filter(Boolean);
}

/** The agent file of a `dotclaude:` agent, parsed, or undefined. */
async function agentDefinition($, subagentType) {
  const name = /^dotclaude:([a-z0-9-]+)$/.exec(String(subagentType))?.[1];
  if (!name) return undefined;
  const text = await $.fs.read(`${$.plugin.root}/agents/${name}.md`);
  return parseDefinition(text);
}

/**
 * The handoff note of the main conversation, from a fork that sees the whole
 * conversation. It saves the note under `.claude/handoffs/` and gives
 * `{ text, path }`, or null when the fork fails, times out, or gives no text.
 */
async function forkHandoff($) {
  let timer;
  try {
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, HANDOFF_FORK_TIMEOUT_MS);
    });
    const fork = await Promise.race([
      $.model.fork({ prompt: HANDOFF_PROMPT }),
      late,
    ]);
    if (!fork?.isAnswered || !fork.text?.trim()) return null;
    const at = new Date();
    const path = handoffPath(await $.session.root(), at);
    // The note is in memory, so a failed write loses only the file.
    await $.fs.write(path, handoffFile(fork.text, at)).catch(() => {});
    await supersedeEarlier($, path).catch(() => {});
    return { text: fork.text, path };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mark the earlier compaction note of this session as superseded, because the new note carries its open items.
 * Without this, each compaction left one more `in-progress` note.
 * The store keeps the newest note path of the last `HANDOFF_SESSIONS_MAX` sessions.
 */
async function supersedeEarlier($, path) {
  const id = await $.session.id();
  const notes = { ...((await $.store.get("handoff-notes")) ?? {}) };
  const earlier = notes[id];
  if (earlier && earlier !== path) {
    const text = await $.fs.read(earlier);
    const next = supersede(text);
    if (next !== text) await $.fs.write(earlier, next);
  }
  delete notes[id];
  notes[id] = path;
  const kept = Object.entries(notes).slice(-HANDOFF_SESSIONS_MAX);
  await $.store.set("handoff-notes", Object.fromEntries(kept));
}

/**
 * Register the guards. A tool call that needs approval stays in `asks` until
 * the call ends, because `tool.check` runs inside the `next` of `tool.call`.
 * Each guard fails open: a throw gives no verdict, and a throw in the module
 * would make the engine skip all of dotclaude for the event.
 */
export function register(on, options) {
  const asks = new Map();
  const graph = {
    syncs: new Map(),
    seen: new Set(),
    failed: new Set(),
    warned: new Set(),
  };
  const policySeen = new Set();

  on("tool.call", async ($, e, next) => {
    const deny = await writeDenial($, e, options).catch(() => undefined);
    if (deny) return { deny };
    const id = e.tool_use_id;
    const [reason, trailer, command] = await Promise.all([
      askReason($, e, options).catch(() => undefined),
      trailerVerdict($, e, options).catch(() => undefined),
      messageCommand($, e, options).catch(() => undefined),
    ]);
    // A deny wins, and the reasons of two asks are joined.
    const verdict =
      trailer?.decision === "deny"
        ? trailer
        : reason || trailer
          ? {
              decision: "ask",
              reason: [reason, trailer?.reason].filter(Boolean).join(" "),
            }
          : undefined;
    const keep = verdict !== undefined && id !== undefined;
    if (keep) asks.set(id, verdict);
    let r;
    try {
      r = await next(command ? { ...e, command } : e);
    } finally {
      if (keep) asks.delete(id);
    }
    if (!r || "deny" in r || r.isError) return r;
    let out = r;
    if (enabled(options, "guard_secrets")) {
      const findings = await scan($, strings(r.result).join("\n"));
      const { value, count } = findings?.length
        ? redact(r.result, findings)
        : { count: 0 };
      // Core uses its own messages (`ref`, `text`) when they stay, so a
      // changed result is a new object without them.
      if (count)
        out = {
          result: value,
          context: [...(r.context ?? []), redactionNote(count, findings)],
        };
    }
    const notes = [
      command && COMMAND_NOTE,
      await lineBreaks($, e, options).catch(() => undefined),
      ...(enabled(options, "codegraph")
        ? await graphNotes($, e, graph).catch(() => [])
        : []),
      ...(enabled(options, "guard_policy")
        ? await policyNotes($, e, policySeen).catch(() => [])
        : []),
    ].filter(Boolean);
    return notes.length
      ? { ...out, context: [...(out.context ?? []), ...notes] }
      : out;
  });

  // The auto-mode reminder gets the edit rule in place of its `Bash` edit text,
  // so that it agrees with the Bash guard.
  on("prompt.attachment", async (_$, e, next) => {
    if (!enabled(options, "guard_bash") || typeof e.text !== "string")
      return next(e);
    const text = autoModeText(e.text);
    return next(text === e.text ? e : { ...e, text });
  });

  // The model and effort rules. The call keeps its `model`: a model that the
  // agent file does not fix is a denial with the reason, not a silent change.
  on("agent.spawn", async ($, e, next) => {
    if (!enabled(options, "guard_agents")) return next(e);
    let def;
    try {
      def = await agentDefinition($, e.subagentType);
    } catch {
      def = undefined;
    }
    const deny = spawnDenial({
      askedModel: e.fork ? undefined : e.model,
      parentModel: e.parentModel,
      pinned: pinnedModel(def),
      effort: e.effort ?? def?.effort,
    });
    return deny ? { deny } : next(e);
  });

  // The cold-cache note goes down with the prompt. Only a prompt between
  // turns gets it, because a prompt in a turn follows a recent response.
  on("prompt.submit", async ($, e, next) => {
    const last = Number(await $.store.get("last-turn-ms").catch(() => 0));
    const idle = Date.now() - last;
    if (
      e.turnId !== undefined ||
      !last ||
      idle <= cacheTtlMs(await sessionPlan($))
    )
      return next(e);
    return next({ ...e, context: [...(e.context ?? []), idleNote(idle)] });
  });

  on("turn.complete", async ($, e, next) => {
    if (!e.agentId)
      await $.store.set("last-turn-ms", Date.now()).catch(() => {});
    return next(e);
  });

  // The summary instruction, and a handoff note from a fork that runs before
  // `next`, so it sees the whole conversation. A `precompute` installs
  // nothing, and a subagent gets no note. The compaction always continues.
  on("session.compact", async ($, e, next) => {
    if (e.trigger === "precompute") return next(e);
    // A manual `/compact` is a choice to continue in this session.
    const handoff =
      !e.agentId &&
      e.trigger !== "manual" &&
      enabled(options, "compaction_handoff")
        ? await forkHandoff($)
        : null;
    const r = await next({
      ...e,
      instructions: [e.instructions, COMPACT_TEXT].filter(Boolean).join("\n\n"),
    });
    return handoff && r?.messages
      ? {
          ...r,
          messages: [...r.messages, handoffRow(handoff.path)],
        }
      : r;
  });

  // The engine's "deny" stays, so a rule of the user is not weakened.
  on("tool.check", async (_$, e, next) => {
    const verdict = await next(e);
    const kept = asks.get(e.tool_use_id);
    return kept && verdict?.decision !== "deny" ? kept : verdict;
  });
}
