// The hooks module of dotclaude. It runs in Claude Code with no Node and no
// Bun, and reaches the host only through the engine's `$`.
//
// `claude plugin validate` follows `$` only into a function of this file and
// refuses `$` as a value. Thus each function that touches `$` is here, and
// each `$.env.get` call has its name as a literal. The pure helpers are in
// `lib/_io-mod.mjs`.
//
// The module cannot use `import()`, so it imports each action that it runs
// statically. The action table is in `lib/_actions.mjs`.

import { ACTIONS, MATCH_FIELD, matches, merge } from "./lib/_actions.mjs";
import { COMPACTIONS_BEFORE_HANDOFF } from "./lib/_budget.mjs";
import { option, TAG, tagOutput } from "./lib/_core.mjs";
import {
  agentContextFile,
  bytesOfBase64,
  compactionsFile,
  contextOf,
  contextTokensOf,
  countOf,
  entryOf,
  envOf,
  homeOf,
  known,
  platformOf,
  pluginDataDir,
  projectDirOf,
  recentPromptsOf,
  runRequest,
  runResult,
  skillStartedOf,
  statOf,
  stoppedAtLimitOf,
  tmpOf,
  turnsOf,
} from "./lib/_io-mod.mjs";
import { agentStarted } from "./lib/_ledger.mjs";
import checkLineBreaks from "./post-tool-use/check-line-breaks.mjs";
import excludeSessionFiles from "./post-tool-use/exclude-session-files.mjs";
import loadNestedInstructions from "./post-tool-use/load-nested-instructions.mjs";
import noteContextSize from "./post-tool-use/note-context-size.mjs";
import recordEditsAndChecks from "./post-tool-use/record-edits-and-checks.mjs";
import redactSecrets from "./post-tool-use/redact-secrets.mjs";
import showClosestLines from "./post-tool-use-failure/show-closest-lines.mjs";
import saveRecentPrompts from "./pre-compact/save-recent-prompts.mjs";
import blockDestructiveCommands from "./pre-tool-use/block-destructive-commands.mjs";
import confirmDesignUploads from "./pre-tool-use/confirm-design-uploads.mjs";
import confirmRiskyEdits from "./pre-tool-use/confirm-risky-edits.mjs";
import enforceAgentBudget from "./pre-tool-use/enforce-agent-budget.mjs";
import handOffCappedAgents from "./pre-tool-use/hand-off-capped-agents.mjs";
import preferDotclaudeAgents from "./pre-tool-use/prefer-dotclaude-agents.mjs";
import restrictSubagentModels from "./pre-tool-use/restrict-subagent-models.mjs";
import skipUnchangedRereads from "./pre-tool-use/skip-unchanged-rereads.mjs";
import countRunningAgents from "./subagent-start/count-running-agents.mjs";
import injectWorkingConventions from "./subagent-start/inject-working-conventions.mjs";
import clearAskApprovals from "./user-prompt-submit/clear-ask-approvals.mjs";
import noteUsageLimits from "./user-prompt-submit/note-usage-limits.mjs";

/** The ported actions that the module runs, by their path in `ACTIONS`. */
const RUNS = new Map([
  ["pre-tool-use/block-destructive-commands.mjs", blockDestructiveCommands],
  ["pre-tool-use/skip-unchanged-rereads.mjs", skipUnchangedRereads],
  ["pre-tool-use/confirm-risky-edits.mjs", confirmRiskyEdits],
  ["pre-tool-use/restrict-subagent-models.mjs", restrictSubagentModels],
  ["pre-tool-use/prefer-dotclaude-agents.mjs", preferDotclaudeAgents],
  ["pre-tool-use/hand-off-capped-agents.mjs", handOffCappedAgents],
  ["pre-tool-use/confirm-design-uploads.mjs", confirmDesignUploads],
  ["pre-tool-use/enforce-agent-budget.mjs", enforceAgentBudget],
  ["post-tool-use/record-edits-and-checks.mjs", recordEditsAndChecks],
  ["post-tool-use/load-nested-instructions.mjs", loadNestedInstructions],
  ["post-tool-use/note-context-size.mjs", noteContextSize],
  ["post-tool-use/exclude-session-files.mjs", excludeSessionFiles],
  ["post-tool-use/check-line-breaks.mjs", checkLineBreaks],
  ["post-tool-use/redact-secrets.mjs", redactSecrets],
  ["post-tool-use-failure/show-closest-lines.mjs", showClosestLines],
  ["subagent-start/inject-working-conventions.mjs", injectWorkingConventions],
  ["subagent-start/count-running-agents.mjs", countRunningAgents],
  ["user-prompt-submit/clear-ask-approvals.mjs", clearAskApprovals],
  ["user-prompt-submit/note-usage-limits.mjs", noteUsageLimits],
  ["pre-compact/save-recent-prompts.mjs", saveRecentPrompts],
]);

/**
 * The environment names that the guard closure reads, by name. A name that
 * the engine refuses or does not have is undefined.
 */
async function readEnv($) {
  const pairs = [
    ["AI_AGENT", $.env.get("AI_AGENT")],
    ["ANTHROPIC_API_KEY", $.env.get("ANTHROPIC_API_KEY")],
    [
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      $.env.get("ANTHROPIC_DEFAULT_FABLE_MODEL"),
    ],
    [
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      $.env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    ],
    [
      "ANTHROPIC_DEFAULT_MYTHOS_MODEL",
      $.env.get("ANTHROPIC_DEFAULT_MYTHOS_MODEL"),
    ],
    ["ANTHROPIC_DEFAULT_OPUS_MODEL", $.env.get("ANTHROPIC_DEFAULT_OPUS_MODEL")],
    [
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      $.env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"),
    ],
    ["AppData", $.env.get("AppData")],
    [
      "CLAUDE_CODE_DISABLE_FAST_MODE",
      $.env.get("CLAUDE_CODE_DISABLE_FAST_MODE"),
    ],
    [
      "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
      $.env.get("CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS"),
    ],
    ["CLAUDE_CODE_EFFORT_LEVEL", $.env.get("CLAUDE_CODE_EFFORT_LEVEL")],
    ["CLAUDE_CODE_ENTRYPOINT", $.env.get("CLAUDE_CODE_ENTRYPOINT")],
    ["CLAUDE_CODE_EXECPATH", $.env.get("CLAUDE_CODE_EXECPATH")],
    ["CLAUDE_CODE_FORK_SUBAGENT", $.env.get("CLAUDE_CODE_FORK_SUBAGENT")],
    ["CLAUDE_CODE_PLUGIN_CACHE_DIR", $.env.get("CLAUDE_CODE_PLUGIN_CACHE_DIR")],
    ["CLAUDE_CODE_TASK_LIST_ID", $.env.get("CLAUDE_CODE_TASK_LIST_ID")],
    ["CLAUDE_CODE_TMPDIR", $.env.get("CLAUDE_CODE_TMPDIR")],
    ["CLAUDE_CODE_USE_BEDROCK", $.env.get("CLAUDE_CODE_USE_BEDROCK")],
    ["CLAUDE_CODE_USE_FOUNDRY", $.env.get("CLAUDE_CODE_USE_FOUNDRY")],
    ["CLAUDE_CODE_USE_VERTEX", $.env.get("CLAUDE_CODE_USE_VERTEX")],
    ["CLAUDE_CONFIG_DIR", $.env.get("CLAUDE_CONFIG_DIR")],
    ["DOTCLAUDE_DEBUG", $.env.get("DOTCLAUDE_DEBUG")],
    ["DOTCLAUDE_OFFLINE", $.env.get("DOTCLAUDE_OFFLINE")],
    ["GH_CONFIG_DIR", $.env.get("GH_CONFIG_DIR")],
    ["HOME", $.env.get("HOME")],
    ["SystemRoot", $.env.get("SystemRoot")],
    ["TEMP", $.env.get("TEMP")],
    ["TMP", $.env.get("TMP")],
    ["TMPDIR", $.env.get("TMPDIR")],
    ["USERPROFILE", $.env.get("USERPROFILE")],
    ["XDG_CONFIG_HOME", $.env.get("XDG_CONFIG_HOME")],
  ];
  const values = await Promise.all(
    pairs.map((pair) => Promise.resolve(pair[1]).catch(() => undefined)),
  );
  return Object.fromEntries(pairs.map((pair, i) => [pair[0], values[i]]));
}

/** The `IoFs` of `_io.mjs`. */
function modFs($) {
  const write = (file, text) => $.fs.write(file, text);
  return {
    read: (file) => $.fs.read(file),
    head: async (file, bytes) => {
      const { base64 } = await $.fs.read(file, { as: "bytes" });
      return bytesOfBase64(base64).subarray(0, bytes);
    },
    // `$.fs.write` creates the folders, so no call here makes them.
    write,
    append: async (file, text) => {
      // Only a missing file counts as empty. Another read failure rejects,
      // so that the write does not replace a file that it did not read.
      const before = (await $.fs.exists(file)) ? await $.fs.read(file) : "";
      await write(file, before + text);
    },
    create: async (file, text) => {
      if (await $.fs.exists(file)) return false;
      await write(file, text);
      return true;
    },
    // The engine cannot delete a file. An empty file is the nearest state.
    remove: async (file) => {
      if (await $.fs.exists(file)) await write(file, "");
    },
    exists: (file) => $.fs.exists(file).catch(() => false),
    stat: async (file, options = {}) =>
      statOf(await $.fs.stat(file, { resolve: Boolean(options.resolve) })),
    list: async (dir) => (await $.fs.list(dir)).map(entryOf),
  };
}

function modRun($) {
  return async (argv, init = {}) =>
    runResult(argv, await $.process.run(argv, runRequest(init)), init.maxBytes);
}

/**
 * The session facts for one hook input, from `$.session`. The engine gives
 * parsed rows with no token usage, no attachments, and no transcript file,
 * so some facts are not known. The `turn.step` hook keeps the agent context,
 * and `session-start/restore-context-after-compact.mjs` keeps the count of
 * compactions, in state files.
 * `io` holds the platform and the environment of `modIo`, which give the
 * state folder.
 * It gives the `IoSession` of `_io.mjs`.
 */
function modSession($, data, io) {
  const mainRows = async () => {
    const rows = await $.session.messages();
    return Array.isArray(rows) ? rows : null;
  };
  return {
    recentPrompts: known([], async (limit, maxChars) => {
      const rows = await mainRows();
      return rows ? recentPromptsOf(rows, limit, maxChars) : [];
    }),
    agentTranscriptPath: known("", () => ""),
    agentTurns: known(null, async () => {
      if (typeof data.agent_id !== "string" || !data.agent_id) return null;
      const rows = await $.session.messages({ agentId: data.agent_id });
      // A refusal is `{ deny }`, not a list.
      return Array.isArray(rows) ? turnsOf(rows) : null;
    }),
    agentContext: known(null, async () => {
      if (!data.session_id || !data.agent_id) return null;
      const file = agentContextFile(io, data.session_id, data.agent_id);
      return contextOf(await $.fs.read(file));
    }),
    loadedNested: known(null, () => null),
    mainContextTokens: known(null, async () => {
      const tokens = (await $.session.usage())?.context?.tokens;
      return typeof tokens === "number" ? tokens : null;
    }),
    compactions: known(null, async () => {
      if (!data.session_id) return null;
      return countOf(await $.fs.read(compactionsFile(io, data.session_id)));
    }),
    agentStoppedAtLimit: known(null, async (id) => {
      const rows = await mainRows();
      return rows ? stoppedAtLimitOf(rows, id) : null;
    }),
    skillStarted: known(null, async (name) => {
      const rows = await mainRows();
      return rows ? skillStartedOf(rows, String(name)) : null;
    }),
  };
}

/**
 * The first cwd of each subagent that works in a worktree, by root and
 * agent id. A `cd` in the subagent moves `$.session.cwd()` later, but the
 * first cwd in the worktree stays its project. A cwd at the root records nothing, because
 * an event can come before the subagent enters its worktree.
 */
const agentStarts = new Map();

/**
 * The hooks-module io for one hook event. `options` holds the plugin options
 * that `register(on, options)` got. `data` is the hook input in the shape of
 * a classic hook's stdin JSON. It is async because the engine gives the
 * environment and the working directory only through promises.
 * It resolves the `Io` of `_io.mjs`. The source has no `import` call in a
 * type, because the engine does not load a module that holds one.
 */
export async function modIo($, options = {}, data = {}) {
  const root = $.plugin.root;
  const platform = platformOf(root);
  const [values, cwd, projectDir] = await Promise.all([
    readEnv($),
    $.session
      .cwd()
      .catch(() => $.session.root())
      .catch(() => data.cwd ?? ""),
    $.session.root().catch(() => undefined),
  ]);
  const env = envOf(values, options);
  const home = homeOf(platform, env);
  // Claude Code sets these two names only for a command hook, so the
  // module makes them. Then the module and the command hooks share a state
  // folder.
  const agentId = data.agent_id;
  if (typeof projectDir === "string") {
    const key = `${projectDir}\0${agentId}`;
    const here = projectDirOf(platform, projectDir, cwd, agentId);
    if (here !== projectDir && !agentStarts.has(key)) agentStarts.set(key, cwd);
    env.CLAUDE_PROJECT_DIR = projectDirOf(
      platform,
      projectDir,
      cwd,
      agentId,
      agentStarts.get(key) ?? cwd,
    );
  }
  const dataDir = pluginDataDir({
    platform,
    root,
    name: $.plugin.name,
    env,
    home,
  });
  if (dataDir) env.CLAUDE_PLUGIN_DATA = dataDir;
  const io = {
    platform,
    env,
    home,
    tmp: tmpOf(platform, env),
    cwd,
    pluginRoot: root,
    fs: modFs($),
    run: modRun($),
  };
  io.session = modSession($, data, io);
  return io;
}

/** The keys of a `tool.call` input that are not arguments of the tool. */
const RESERVED = new Set(["tool", "tool_use_id", "agentId", "consent"]);

/**
 * The error text of a failed `tool.call` result, as a classic
 * PostToolUseFailure input gives it in `error`: the text that the model
 * reads, without the `<tool_use_error>` tags.
 */
function errorOf(r) {
  const text =
    typeof r.text === "string"
      ? r.text
      : typeof r.result === "string"
        ? r.result
        : "";
  return text.replace(/^<tool_use_error>([\s\S]*)<\/tool_use_error>$/, "$1");
}

/** The `additionalContext` of a merged output, as context lines. */
const notesOf = (out) => {
  const text = out?.hookSpecificOutput?.additionalContext;
  return typeof text === "string" && text ? [text] : [];
};

/**
 * The `tool.call` input with the tool arguments replaced by `updated`. A
 * classic `updatedInput` replaces the whole tool input, so an argument that
 * it does not give is removed.
 */
function rewrite(e, updated) {
  const out = {};
  for (const [key, value] of Object.entries(e))
    if (RESERVED.has(key)) out[key] = value;
  return { ...updated, ...out };
}

/**
 * The classic PreToolUse input for one `tool.call` input. The engine gives
 * no `agent_type`, so it comes from the agent list. On the main thread the
 * input has no `agent_id` and no `agent_type`. `effort` is the effort level of
 * the latest step of the main thread, or undefined.
 */
async function classicInput($, e, effort) {
  const toolInput = {};
  for (const [key, value] of Object.entries(e))
    if (!RESERVED.has(key)) toolInput[key] = value;
  const data = {
    hook_event_name: "PreToolUse",
    session_id: await $.session.id().catch(() => ""),
    tool_name: e.tool,
    tool_input: toolInput,
    tool_use_id: e.tool_use_id,
  };
  if (effort) data.effort = { level: effort };
  if (typeof e.agentId === "string" && e.agentId) {
    data.agent_id = e.agentId;
    const agents = await $.agent.list().catch(() => []);
    const type = agents.find((agent) => agent.id === e.agentId)?.type;
    if (type) data.agent_type = type;
  }
  return data;
}

/**
 * Run the ported actions of `event` whose matcher fits `data`, at the same
 * time, and merge their tagged outputs in table order. With `only`, it runs
 * only that action. It makes the io only when an action runs. Each action
 * fails open: an action that throws gives no output, and the others still
 * count.
 */
async function runActions($, options, event, data, only) {
  const field = MATCH_FIELD[event];
  const rows = (ACTIONS[event] ?? []).filter(
    ([matcher, action]) =>
      RUNS.has(action) &&
      (only === undefined || action === only) &&
      matches(matcher, data[field]),
  );
  if (!rows.length) return undefined;
  let io;
  try {
    io = await modIo($, options, data);
  } catch {
    return undefined;
  }
  data.cwd = io.cwd;
  const outputs = await Promise.all(
    rows.map(async ([, action]) => {
      try {
        const out = await RUNS.get(action)(
          io,
          JSON.parse(JSON.stringify(data)),
        );
        return out ? tagOutput(out) : undefined;
      } catch (err) {
        // The module has no stderr.
        // A thrown hook makes the engine log "hook failed" and skip all of dotclaude for the event,
        // so only a debug run rethrows.
        if (io.env.DOTCLAUDE_DEBUG) throw err;
        return undefined;
      }
    }),
  );
  return merge(outputs.filter(Boolean));
}

/**
 * The session ID and the io of the current session, or null when the
 * session has no ID. The state folder does not change in a session, so
 * `places` keeps one io for each session, and a step does not make a new io.
 */
async function placeOf($, options, places) {
  const sessionId = await $.session.id();
  if (!sessionId) return null;
  if (!places.has(sessionId)) {
    const io = modIo($, options, {});
    io.catch(() => places.delete(sessionId));
    places.set(sessionId, io);
  }
  return { sessionId, io: await places.get(sessionId) };
}

/** Whether the dotclaude option `name` is on in the current session. */
async function optionOn($, options, places, name) {
  const place = await placeOf($, options, places);
  const io = place?.io ?? (await modIo($, options, {}));
  return option(io.env, name);
}

// The built-in agents that a dotclaude agent or skill replaces. `general-purpose`
// and `claude` have no turn limit and every tool. `Explore` and `Plan` run on
// the main model, and the settings profile removes them too (`explore-plan`).
// `dotclaude:setup` sets the status line. `claude-code-guide` stays, because
// no dotclaude agent answers questions about Claude Code.
const REPLACED_AGENTS = new Set([
  "general-purpose",
  "claude",
  "Explore",
  "Plan",
  "statusline-setup",
]);

// The engine reminders to use the task tools. The `gate_tasks` check at the
// end of a turn replaces them.
const TASK_REMINDERS = new Set(["task_reminder", "todo_reminder"]);

// The engine sends `silent_turn_reminder` after 5 API turns with no text. A
// server flag can make it ask for a few words on what Claude does, and 93 of
// 189 messages that only named the next step, from 2026-10-02 to 2026-10-03,
// came after it. This text asks only for news.
export const SILENT_TURN_TEXT =
  "If you found a fact, a failure, or a change of plan since your last message, tell the user in one sentence.\nIf not, continue with no message, because a message that only names the next step gives the user no information.";

// The text that each compaction adds to its instructions. From 2026-09-30 to
// 2026-10-03, each compaction kept 45% to 59% of the facts that the next part
// needed (`scripts/compaction-report.mjs`).
export const COMPACT_TEXT = `<compaction_priorities>
Keep the user's requests and constraints in the user's own words.
Keep the decisions and the rejected approaches, with their reasons.
Keep the current state and the open items.
Keep exact paths, commands, errors, and numbers.
The next part of the conversation acts on these details, and a paraphrase loses them.
</compaction_priorities>`;

// After COMPACTIONS_BEFORE_HANDOFF compactions, the context note asks for a
// handoff note, so the summary starts from it.
export const COMPACT_HANDOFF_TEXT = `<compaction_handoff>
Make the summary from the latest handoff note under \`.claude/handoffs/\`, if one exists.
Keep its open items and next steps in its own words, and give its path.
</compaction_handoff>`;

/**
 * The compaction instructions of `e` with dotclaude's text added. The main
 * conversation gets the handoff text after COMPACTIONS_BEFORE_HANDOFF
 * compactions.
 */
async function compactInstructions($, options, places, e) {
  const parts = [e.instructions, COMPACT_TEXT];
  const place = await placeOf($, options, places);
  if (!e.agentId && place) {
    const file = compactionsFile(place.io, place.sessionId);
    const count = countOf(await $.fs.read(file).catch(() => ""));
    if ((count ?? 0) >= COMPACTIONS_BEFORE_HANDOFF)
      parts.push(COMPACT_HANDOFF_TEXT);
  }
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Mark the subagent `agentId` as running again. The engine gives no
 * subagent transcript, so the marker time is the only activity time of the
 * agent. A resumed agent gets no `agent.spawn`, so its next step marks it.
 */
async function markRunning($, options, places, agentId) {
  const place = await placeOf($, options, places);
  if (place && option(place.io.env, "agent_guidance"))
    await agentStarted(place.io, place.sessionId, agentId);
}

/**
 * Keep the context tokens of the first and latest steps of the subagent
 * `agentId`, for `io.session.agentContext`. The first value of an existing
 * file stays.
 */
async function noteAgentContext($, options, places, agentId, usage) {
  const tokens = contextTokensOf(usage);
  if (tokens === null) return;
  const place = await placeOf($, options, places);
  if (!place) return;
  const file = agentContextFile(place.io, place.sessionId, agentId);
  const fs = modFs($);
  const before = contextOf(await fs.read(file).catch(() => ""));
  await fs.write(
    file,
    JSON.stringify({ first: before?.first ?? tokens, last: tokens }),
  );
}

/**
 * Register the hooks of dotclaude. `tool.call` runs the PreToolUse actions
 * before the call, and the PostToolUse or PostToolUseFailure actions after
 * it. An "ask" stays in
 * `verdicts` until the call ends, because `tool.check` runs inside the `next`
 * of `tool.call`. An "allow" is not kept, so the engine's rules decide, as
 * they do for a classic hook's "allow". `agent.spawn` runs the SubagentStart
 * actions. `prompt.submit` runs the UserPromptSubmit actions, and
 * `session.compact` runs the PreCompact actions. `agent.offer` and
 * `prompt.attachment` remove the built-in agents and reminders that dotclaude
 * replaces. `turn.step` keeps the context of each subagent, because the
 * engine does not give it.
 */
export function register(on, options) {
  const verdicts = new Map();
  const places = new Map();
  let effort;

  on("tool.call", async ($, e, next) => {
    const data = await classicInput($, e, effort);
    const pre = await runActions($, options, "PreToolUse", data);
    const h = pre?.hookSpecificOutput ?? {};
    // A deny does not call `next`, so nothing below this hook runs.
    if (h.permissionDecision === "deny")
      return { deny: h.permissionDecisionReason ?? TAG };
    const id = e.tool_use_id;
    const keep = id !== undefined && h.permissionDecision === "ask";
    if (keep) {
      const kept = { decision: "ask" };
      if (h.permissionDecisionReason !== undefined)
        kept.reason = h.permissionDecisionReason;
      verdicts.set(id, kept);
    }
    let r;
    try {
      r = await next(h.updatedInput ? rewrite(e, h.updatedInput) : e);
    } finally {
      if (keep) verdicts.delete(id);
    }
    if (!r || "deny" in r) return r;
    const post = r.isError
      ? await runActions($, options, "PostToolUseFailure", {
          ...data,
          hook_event_name: "PostToolUseFailure",
          error: errorOf(r),
        })
      : await runActions($, options, "PostToolUse", {
          ...data,
          hook_event_name: "PostToolUse",
          tool_response: r.result,
        });
    const context = [...(r.context ?? []), ...notesOf(pre), ...notesOf(post)];
    const redacted = post?.hookSpecificOutput?.updatedToolOutput;
    // Core uses its own messages (`ref`, `text`) when they stay, so a
    // changed result is a new object without them.
    if (!r.isError && redacted !== undefined)
      return { result: redacted, context };
    if (context.length === (r.context?.length ?? 0)) return r;
    if (!r.isError) return { result: r.result, context };
    return { ...r, context };
  });

  // The engine's "deny" stays, so a rule of the user is not weakened.
  on("tool.check", async (_$, e, next) => {
    const verdict = await next(e);
    const kept =
      e.tool_use_id === undefined ? undefined : verdicts.get(e.tool_use_id);
    return kept && verdict?.decision !== "deny" ? kept : verdict;
  });

  // The SubagentStart actions. The context goes before the prompt, because
  // the engine gives no other way to add context to a subagent. The engine
  // gives the agent id only after `next`, so the agent counts as running
  // only after it starts.
  on("agent.spawn", async ($, e, next) => {
    const data = {
      hook_event_name: "SubagentStart",
      session_id: await $.session.id().catch(() => ""),
      agent_type: e.subagentType,
      prompt: e.prompt,
    };
    const start = await runActions(
      $,
      options,
      "SubagentStart",
      { ...data },
      "subagent-start/inject-working-conventions.mjs",
    );
    const text = notesOf(start)[0];
    const r = await next(text ? { ...e, prompt: `${text}\n\n${e.prompt}` } : e);
    if (r && !("deny" in r) && r.agentId)
      await runActions(
        $,
        options,
        "SubagentStart",
        { ...data, agent_id: r.agentId },
        "subagent-start/count-running-agents.mjs",
      );
    return r;
  });

  // The UserPromptSubmit actions. Their context goes down with the prompt,
  // because context put on the result after `next` is not attached.
  on("prompt.submit", async ($, e, next) => {
    const out = await runActions($, options, "UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: await $.session.id().catch(() => ""),
      prompt: e.text,
    });
    const notes = notesOf(out);
    return next(
      notes.length ? { ...e, context: [...(e.context ?? []), ...notes] } : e,
    );
  });

  // The PreCompact actions. A `precompute` installs nothing, and the
  // compaction that uses its result fires this event again, so only that
  // one runs the actions and adds dotclaude's instructions. The compaction
  // always continues.
  on("session.compact", async ($, e, next) => {
    if (e.trigger !== "precompute") {
      const data = {
        hook_event_name: "PreCompact",
        session_id: await $.session.id().catch(() => ""),
        trigger: e.trigger,
        custom_instructions: e.instructions ?? null,
      };
      if (typeof e.agentId === "string" && e.agentId) data.agent_id = e.agentId;
      await runActions($, options, "PreCompact", data);
      if (await optionOn($, options, places, "context_compact_carryover"))
        return next({
          ...e,
          instructions: await compactInstructions($, options, places, e),
        });
    }
    return next(e);
  });

  // A built-in agent in REPLACED_AGENTS is not offered to the model, in its
  // listing or at dispatch. An agent of the user or a plugin with the same
  // name stays.
  on("agent.offer", async ($, e, next) => {
    if (
      e.source === "built-in" &&
      REPLACED_AGENTS.has(e.agent) &&
      (await optionOn($, options, places, "agent_guidance"))
    )
      return { isOffered: false };
    return next(e);
  });

  // The engine's task reminders are left out of the request, and its
  // silent-turn reminder gets dotclaude's text.
  on("prompt.attachment", async ($, e, next) => {
    if (
      e.origin?.kind === "engine" &&
      TASK_REMINDERS.has(e.type) &&
      (await optionOn($, options, places, "gate_tasks"))
    )
      return { text: null };
    if (e.origin?.kind === "engine" && e.type === "silent_turn_reminder")
      return next({ ...e, text: SILENT_TURN_TEXT });
    return next(e);
  });

  // The engine gives no subagent transcript, so each step of a subagent
  // keeps its context tokens. Each chunk passes unchanged, and a failure to
  // keep the tokens does not stop the step. A step of the main thread keeps
  // its effort level, because a `tool.call` input does not give it.
  on("turn.step", async function* ($, e, next) {
    if (!e.agentId)
      effort = typeof e.effort === "string" ? e.effort : undefined;
    else if (typeof e.agentId === "string")
      try {
        await markRunning($, options, places, e.agentId);
      } catch {
        // The agent then counts as running only until its marker is idle.
      }
    const r = yield* next(e);
    if (typeof e.agentId === "string" && e.agentId)
      try {
        await noteAgentContext($, options, places, e.agentId, r?.usage);
      } catch {
        // The agent context is then not known, and its guard does not act.
      }
    return r;
  });
}
