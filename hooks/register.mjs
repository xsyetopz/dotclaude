// The hooks module of dotclaude. It runs in Claude Code with no Node and no
// Bun, and reaches the host only through the engine's `$`.
//
// `claude plugin validate` follows `$` only into a function of this file and
// refuses `$` as a value. Thus each function that touches `$` is here, and
// each `$.env.get` call has its name as a literal. The pure helpers are in
// `lib/_io-mod.mjs`.
//
// A later slice (s21) adds the `register` function and the `modules` entry
// of `hooks.json`.

import {
  bytesOfBase64,
  entryOf,
  envOf,
  homeOf,
  known,
  lastPromptOf,
  platformOf,
  pluginDataDir,
  runRequest,
  runResult,
  statOf,
  stoppedAtLimitOf,
  tmpOf,
  turnsOf,
} from "./lib/_io-mod.mjs";

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
 * so some facts are not known.
 * It gives the `IoSession` of `_io.mjs`.
 */
function modSession($, data) {
  const mainRows = async () => {
    const rows = await $.session.messages();
    return Array.isArray(rows) ? rows : null;
  };
  return {
    lastPrompt: known("", async () => {
      const rows = await mainRows();
      return rows ? lastPromptOf(rows) : "";
    }),
    agentTranscriptPath: known("", () => ""),
    agentTurns: known(null, async () => {
      if (typeof data.agent_id !== "string" || !data.agent_id) return null;
      const rows = await $.session.messages({ agentId: data.agent_id });
      // A refusal is `{ deny }`, not a list.
      return Array.isArray(rows) ? turnsOf(rows) : null;
    }),
    agentContext: known(null, () => null),
    loadedNested: known(null, () => null),
    mainContextTokens: known(null, async () => {
      const tokens = (await $.session.usage())?.context?.tokens;
      return typeof tokens === "number" ? tokens : null;
    }),
    compactions: known(null, () => null),
    agentStoppedAtLimit: known(null, async (id) => {
      const rows = await mainRows();
      return rows ? stoppedAtLimitOf(rows, id) : null;
    }),
  };
}

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
  if (typeof projectDir === "string") env.CLAUDE_PROJECT_DIR = projectDir;
  const dataDir = pluginDataDir({
    platform,
    root,
    name: $.plugin.name,
    env,
    home,
  });
  if (dataDir) env.CLAUDE_PLUGIN_DATA = dataDir;
  return {
    platform,
    env,
    home,
    tmp: tmpOf(platform, env),
    cwd,
    pluginRoot: root,
    fs: modFs($),
    run: modRun($),
    session: modSession($, data),
  };
}
