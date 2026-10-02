// The hooks-module io of `_io.mjs`, over the engine's `$`, for
// `hooks/register.mjs`. The engine has no Node and no Bun, so this file is a
// closure file: it reaches the host only through `$`.
//
// What the engine cannot do, and what this io does in its place:
//
// - `$.fs` has no delete. `remove` writes an empty file.
// - `$.fs` has no append. `append` reads the file and writes all of it again,
//   so two calls at the same time can lose a line.
// - `create` is not atomic: another writer can make the file between the
//   check and the write.
// - `$.fs.read` rejects a file over 4 MiB, also for `head`.
// - `$.process.run` reads the whole output before it resolves. `run` checks
//   `maxBytes` then, and cannot stop the command early.

import {
  LAST_PROMPT_CHARS,
  promptsFromText,
  stoppedAtLimitInText,
  turnsFromText,
} from "./_transcript-parse.mjs";

const RUN_MAX_BYTES = 64 * 1024 * 1024;
const RUN_TIMEOUT_MS = 30_000;

/**
 * The environment names that the guard closure reads. `$.env.get` takes only
 * a literal name, so each name is spelled here once.
 */
const ENV_READS = {
  AI_AGENT: ($) => $.env.get("AI_AGENT"),
  ANTHROPIC_API_KEY: ($) => $.env.get("ANTHROPIC_API_KEY"),
  ANTHROPIC_DEFAULT_FABLE_MODEL: ($) =>
    $.env.get("ANTHROPIC_DEFAULT_FABLE_MODEL"),
  ANTHROPIC_DEFAULT_HAIKU_MODEL: ($) =>
    $.env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
  ANTHROPIC_DEFAULT_MYTHOS_MODEL: ($) =>
    $.env.get("ANTHROPIC_DEFAULT_MYTHOS_MODEL"),
  ANTHROPIC_DEFAULT_OPUS_MODEL: ($) =>
    $.env.get("ANTHROPIC_DEFAULT_OPUS_MODEL"),
  ANTHROPIC_DEFAULT_SONNET_MODEL: ($) =>
    $.env.get("ANTHROPIC_DEFAULT_SONNET_MODEL"),
  AppData: ($) => $.env.get("AppData"),
  CLAUDE_CODE_DISABLE_FAST_MODE: ($) =>
    $.env.get("CLAUDE_CODE_DISABLE_FAST_MODE"),
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: ($) =>
    $.env.get("CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS"),
  CLAUDE_CODE_EFFORT_LEVEL: ($) => $.env.get("CLAUDE_CODE_EFFORT_LEVEL"),
  CLAUDE_CODE_ENTRYPOINT: ($) => $.env.get("CLAUDE_CODE_ENTRYPOINT"),
  CLAUDE_CODE_EXECPATH: ($) => $.env.get("CLAUDE_CODE_EXECPATH"),
  CLAUDE_CODE_FORK_SUBAGENT: ($) => $.env.get("CLAUDE_CODE_FORK_SUBAGENT"),
  CLAUDE_CODE_TASK_LIST_ID: ($) => $.env.get("CLAUDE_CODE_TASK_LIST_ID"),
  CLAUDE_CODE_TMPDIR: ($) => $.env.get("CLAUDE_CODE_TMPDIR"),
  CLAUDE_CODE_USE_BEDROCK: ($) => $.env.get("CLAUDE_CODE_USE_BEDROCK"),
  CLAUDE_CODE_USE_FOUNDRY: ($) => $.env.get("CLAUDE_CODE_USE_FOUNDRY"),
  CLAUDE_CODE_USE_VERTEX: ($) => $.env.get("CLAUDE_CODE_USE_VERTEX"),
  CLAUDE_CONFIG_DIR: ($) => $.env.get("CLAUDE_CONFIG_DIR"),
  CLAUDE_PLUGIN_DATA: ($) => $.env.get("CLAUDE_PLUGIN_DATA"),
  CLAUDE_PROJECT_DIR: ($) => $.env.get("CLAUDE_PROJECT_DIR"),
  DOTCLAUDE_DEBUG: ($) => $.env.get("DOTCLAUDE_DEBUG"),
  DOTCLAUDE_OFFLINE: ($) => $.env.get("DOTCLAUDE_OFFLINE"),
  GH_CONFIG_DIR: ($) => $.env.get("GH_CONFIG_DIR"),
  HOME: ($) => $.env.get("HOME"),
  SystemRoot: ($) => $.env.get("SystemRoot"),
  TEMP: ($) => $.env.get("TEMP"),
  TMP: ($) => $.env.get("TMP"),
  TMPDIR: ($) => $.env.get("TMPDIR"),
  USERPROFILE: ($) => $.env.get("USERPROFILE"),
  XDG_CONFIG_HOME: ($) => $.env.get("XDG_CONFIG_HOME"),
};

/**
 * The value of a plugin option as Claude Code gives it to a command hook. A
 * list becomes JSON, which `optionList` reads.
 */
const optionText = (value) =>
  Array.isArray(value) ? JSON.stringify(value) : String(value);

async function readEnv($, options) {
  const env = {};
  const names = Object.keys(ENV_READS);
  const values = await Promise.all(
    names.map((name) =>
      Promise.resolve()
        .then(() => ENV_READS[name]($))
        .catch(() => undefined),
    ),
  );
  names.forEach((name, i) => {
    if (typeof values[i] === "string") env[name] = values[i];
  });
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value === undefined || value === null) continue;
    env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = optionText(value);
  }
  return env;
}

/**
 * The engine has no platform member. A Windows path starts with a drive
 * letter or with `\\`, so the plugin root tells the path flavor.
 */
export const platformOf = (root) =>
  /^(?:[A-Za-z]:[\\/]|\\\\)/.test(String(root)) ? "win32" : "posix";

/** The temp folder as `os.tmpdir()` finds it. */
function tmpOf(platform, env) {
  if (platform === "win32") {
    const dir =
      env.TEMP || env.TMP || `${env.SystemRoot || "C:\\Windows"}\\temp`;
    return dir.length > 3 ? dir.replace(/\\+$/, "") : dir;
  }
  const dir = env.TMPDIR || "/tmp";
  return dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
}

const bytesOfBase64 = (base64) => {
  const text = atob(base64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
};

const utf8Length = (text) => new TextEncoder().encode(text).length;

const statOf = (s) => {
  const out = {
    kind: s.kind,
    size: s.kind === "file" ? s.size : 0,
    mtimeMs: s.mtimeMs,
    isLink: s.isLink,
  };
  if (typeof s.realPath === "string") out.realPath = s.realPath;
  return out;
};

const entryOf = (e) => ({
  name: e.name,
  kind: e.kind,
  size: e.kind === "file" ? e.size : 0,
  mtimeMs: e.mtimeMs,
  isLink: e.isLink,
});

/** The `IoFs` of `_io.mjs`. */
function modFs($) {
  const exists = (file) => $.fs.exists(file);
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
      const before = (await exists(file)) ? await $.fs.read(file) : "";
      await write(file, before + text);
    },
    create: async (file, text) => {
      if (await exists(file)) return false;
      await write(file, text);
      return true;
    },
    // The engine cannot delete a file. An empty file is the nearest state.
    remove: async (file) => {
      if (await exists(file)) await write(file, "");
    },
    exists,
    stat: async (file, options = {}) =>
      statOf(await $.fs.stat(file, { resolve: Boolean(options.resolve) })),
    list: async (dir) => (await $.fs.list(dir)).map(entryOf),
  };
}

function modRun($) {
  return async (argv, init = {}) => {
    const request = { timeoutMs: init.timeoutMs ?? RUN_TIMEOUT_MS };
    if (init.cwd !== undefined) request.cwd = init.cwd;
    if (init.env !== undefined) request.env = init.env;
    if (init.stdin !== undefined) request.stdin = init.stdin;
    const result = await $.process.run(argv, request);
    const maxBytes = init.maxBytes ?? RUN_MAX_BYTES;
    // The engine keeps 4 MiB of each stream. A cut output is not whole, so
    // it counts as past the cap.
    if (
      result.isStdoutTruncated ||
      result.isStderrTruncated ||
      utf8Length(result.stdout) + utf8Length(result.stderr) > maxBytes
    )
      throw new Error(`${argv[0]}: output passed ${maxBytes} bytes`);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

/**
 * A session fact that resolves `unknown` when it throws, for example when
 * the engine refuses a call.
 */
const known =
  (unknown, fact) =>
  async (...args) => {
    try {
      return await fact(...args);
    } catch {
      return unknown;
    }
  };

const isPrompt = (row) => row.role === "user" && !row.toolResults?.length;

/**
 * Engine rows as transcript lines, so that the parsers of
 * `_transcript-parse.mjs` read them. A row has no message id, so each
 * assistant row gets its index. A row has no meta flag, so each user row
 * counts as typed.
 */
const linesOf = (rows) =>
  rows
    .map((row, i) =>
      JSON.stringify(
        row.role === "assistant"
          ? { type: "assistant", message: { id: `row-${i}` } }
          : {
              type: "user",
              message: {
                content: isPrompt(row) ? row.text : [{ type: "tool_result" }],
              },
            },
      ),
    )
    .join("\n");

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
      if (!rows) return "";
      const prompts = rows.filter(isPrompt);
      return (
        promptsFromText(linesOf(prompts), 1, LAST_PROMPT_CHARS).at(-1) ?? ""
      );
    }),
    agentTranscriptPath: known("", () => ""),
    agentTurns: known(null, async () => {
      if (typeof data.agent_id !== "string" || !data.agent_id) return null;
      const rows = await $.session.messages({ agentId: data.agent_id });
      // A refusal is `{ deny }`, not a list.
      return Array.isArray(rows) ? turnsFromText(linesOf(rows)) : null;
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
      if (!rows) return null;
      const text = rows.map((row) => row.text ?? "").join("\n");
      return stoppedAtLimitInText(text, String(id));
    }),
  };
}

/**
 * The hooks-module io for one hook event. `options` holds the plugin options
 * that `register(on, options)` got. `data` is the hook input in the shape of
 * a classic hook's stdin JSON. It is async because the engine gives the
 * environment and the working directory only through promises.
 * It resolves the `Io` of `_io.mjs`. The source has no `import` call in\n * a type, because the engine does not load a module that holds one.
 */
export async function modIo($, options = {}, data = {}) {
  const platform = platformOf($.plugin.root);
  const [env, cwd] = await Promise.all([readEnv($, options), $.session.cwd()]);
  return {
    platform,
    env,
    home: (platform === "win32" ? env.USERPROFILE : env.HOME) ?? "",
    tmp: tmpOf(platform, env),
    cwd,
    pluginRoot: $.plugin.root,
    fs: modFs($),
    run: modRun($),
    session: modSession($, data),
  };
}
