// The pure helpers of the hooks-module io, which `hooks/register.mjs` builds
// over the engine's `$`. `claude plugin validate` follows `$` only into a
// function of the same file, so every function that touches `$` is in
// `register.mjs`. The functions here take plain values and never `$`.
//
// What the engine cannot do, and what the io does in its place:
//
// - `$.fs` has no delete. `remove` writes an empty file.
// - `$.fs` has no append. `append` reads the file and writes all of it again,
//   so two calls at the same time can lose a line.
// - `create` is not atomic: another writer can make the file between the
//   check and the write.
// - `$.fs.read` rejects a file over 4 MiB, also for `head`.
// - `$.process.run` reads the whole output before it resolves. `run` checks
//   `maxBytes` then, and cannot stop the command early.
// - `$.process.run` keeps 4 MiB of each stream. `run` rejects a cut output.
// - `$.env` is the environment of Claude Code itself. It has no
//   `CLAUDE_PROJECT_DIR` and no `CLAUDE_PLUGIN_DATA`, because Claude Code
//   sets them only for a command hook. The io makes them as Claude Code does.

import { stateDir } from "./_core.mjs";
import { pathFor } from "./_path.mjs";
import {
  LAST_PROMPT_CHARS,
  promptsFromText,
  stoppedAtLimitInText,
  turnsFromText,
} from "./_transcript-parse.mjs";

export const RUN_MAX_BYTES = 64 * 1024 * 1024;
export const RUN_TIMEOUT_MS = 30_000;
/** The longest timeout that `$.process.run` takes. */
export const RUN_TIMEOUT_MAX_MS = 600_000;

/**
 * The key of a plugin option in its environment name, as Claude Code makes
 * it for a command hook.
 */
export const optionKey = (key) =>
  key.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();

/**
 * The value of a plugin option as Claude Code gives it to a command hook. A
 * list becomes JSON, which `optionList` reads.
 */
const optionText = (value) =>
  Array.isArray(value) ? JSON.stringify(value) : String(value);

/**
 * The io environment from the values that `$.env.get` gave, by name, and
 * from the plugin options as `CLAUDE_PLUGIN_OPTION_<KEY>`. A value that is
 * not a string is not set.
 */
export function envOf(values, options) {
  const env = {};
  for (const [name, value] of Object.entries(values ?? {}))
    if (typeof value === "string") env[name] = value;
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value === undefined || value === null) continue;
    env[`CLAUDE_PLUGIN_OPTION_${optionKey(key)}`] = optionText(value);
  }
  return env;
}

/**
 * The engine has no platform member. A Windows path starts with a drive
 * letter or with `\\`, so the plugin root tells the path flavor.
 */
export const platformOf = (root) =>
  /^(?:[A-Za-z]:[\\/]|\\\\)/.test(String(root)) ? "win32" : "posix";

/** The home folder as `os.homedir()` finds it. */
export const homeOf = (platform, env) =>
  (platform === "win32" ? env.USERPROFILE : env.HOME) ?? "";

/** The temp folder as `os.tmpdir()` finds it. */
export function tmpOf(platform, env) {
  if (platform === "win32") {
    const dir =
      env.TEMP || env.TMP || `${env.SystemRoot || "C:\\Windows"}\\temp`;
    return dir.length > 3 ? dir.replace(/\\+$/, "") : dir;
  }
  const dir = env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  return dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
}

/**
 * The project folder of a hook input. In a subagent with `isolation:
 * "worktree"`, `$.session.cwd()` gives the worktree, and `$.session.root()`
 * gives the main checkout `root`. The subagent edits and tests the worktree,
 * so the worktree is its project. `start` is the cwd of the first tool call
 * of the subagent, before a `cd` can move it. The worktree is
 * `<root>/.claude/worktrees/<name>`, or the folder outside `root` where a
 * `WorktreeCreate` hook put it. Other inputs get `root`.
 */
export function projectDirOf(platform, root, cwd, agentId, start = cwd) {
  if (!agentId || !start) return root;
  const path = pathFor(platform);
  const rel = path.relative(root, start);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    return start;
  const tree = /^\.claude\/worktrees\/[^/]+/.exec(
    rel.split(path.sep).join("/"),
  )?.[0];
  return tree ? path.join(root, tree) : root;
}

/**
 * The `CLAUDE_PLUGIN_DATA` folder that Claude Code gives the command hooks
 * of the plugin at `root`: `<plugins>/data/<id>`, with each character of the
 * id that is not a letter, a digit, `-`, or `_` changed to `-`.
 *
 * An installed plugin is at `<plugins>/cache/<marketplace>/<name>/<version>`,
 * and its id is `<name>@<marketplace>`. A plugin from `--plugin-dir` has the
 * id `<name>@inline`, and `<plugins>` is `CLAUDE_CODE_PLUGIN_CACHE_DIR`, or
 * `plugins` in `CLAUDE_CONFIG_DIR` or in `<home>/.claude`.
 * It gives "" when it cannot find the folder.
 */
export function pluginDataDir({ platform, root, name, env, home }) {
  const path = pathFor(platform);
  const up = (p, n) => (n === 0 ? p : up(path.dirname(p), n - 1));
  let plugins;
  let id;
  if (path.basename(up(root, 3)) === "cache") {
    plugins = up(root, 4);
    id = `${path.basename(up(root, 1))}@${path.basename(up(root, 2))}`;
  } else {
    const config =
      env.CLAUDE_CONFIG_DIR || (home && path.join(home, ".claude"));
    plugins =
      env.CLAUDE_CODE_PLUGIN_CACHE_DIR ||
      (config && path.join(config, "plugins"));
    id = `${name}@inline`;
  }
  if (!plugins) return "";
  return path.join(plugins, "data", id.replace(/[^a-zA-Z0-9\-_]/g, "-"));
}

export const bytesOfBase64 = (base64) => {
  const text = atob(base64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
};

const utf8Length = (text) => new TextEncoder().encode(text).length;

export const statOf = (s) => {
  const out = {
    kind: s.kind,
    size: s.kind === "file" ? s.size : 0,
    mtimeMs: s.mtimeMs,
    isLink: s.isLink,
  };
  if (typeof s.realPath === "string") out.realPath = s.realPath;
  return out;
};

export const entryOf = (e) => ({
  name: e.name,
  kind: e.kind,
  isLink: e.isLink,
});

/**
 * The `$.process.run` request for the `init` of `io.run`. The timeout stays
 * in the engine's limit, and stdin is empty when `init` has none.
 */
export function runRequest(init = {}) {
  const request = {
    timeoutMs: Math.min(init.timeoutMs ?? RUN_TIMEOUT_MS, RUN_TIMEOUT_MAX_MS),
    stdin: init.stdin ?? "",
  };
  if (init.cwd !== undefined) request.cwd = init.cwd;
  if (init.env !== undefined) request.env = init.env;
  return request;
}

/**
 * The `io.run` result for a `$.process.run` result. It throws when the
 * engine cut a stream, because a cut output is not whole, and when the
 * output passes `maxBytes`.
 */
export function runResult(argv, result, maxBytes = RUN_MAX_BYTES) {
  if (result.isStdoutTruncated || result.isStderrTruncated)
    throw new Error(
      `${argv[0]}: output passed the 4 MiB limit of the hooks engine for one stream`,
    );
  if (utf8Length(result.stdout) + utf8Length(result.stderr) > maxBytes)
    throw new Error(`${argv[0]}: output passed ${maxBytes} bytes`);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * A session fact that resolves `unknown` when it throws, for example when
 * the engine refuses a call.
 */
export const known =
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
 * The summary that a compaction puts in the conversation. It is a user row
 * with no meta flag, but the user did not type it.
 */
const isSummary = (row) =>
  String(row.text ?? "")
    .trimStart()
    .startsWith("This session is being continued from");

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
 * The last `limit` typed prompts in the rows of `$.session.messages()`,
 * oldest first, each cut at `maxChars`.
 */
export function recentPromptsOf(rows, limit = 5, maxChars = 600) {
  const prompts = rows.filter((row) => isPrompt(row) && !isSummary(row));
  return promptsFromText(linesOf(prompts), limit, maxChars);
}

/** The last typed prompt in the rows of `$.session.messages()`, or "". */
export const lastPromptOf = (rows) =>
  recentPromptsOf(rows, 1, LAST_PROMPT_CHARS).at(-1) ?? "";

/** The assistant turns since the last prompt in the rows of an agent. */
export const turnsOf = (rows) => turnsFromText(linesOf(rows));

/**
 * True when the rows hold a task notification that the agent `id` stopped
 * at its turn limit. Else null, not false: `$.session.messages()` drops meta
 * rows, and a task notification can be one, so no tag is no evidence.
 */
export function stoppedAtLimitOf(rows, id) {
  const text = rows.map((row) => row.text ?? "").join("\n");
  return stoppedAtLimitInText(text, String(id)) ? true : null;
}

/** An id as a part of a file name. */
const safeId = (id) => String(id).replace(/[^\w-]/g, "_");

/**
 * The file that keeps the context tokens of the first and latest steps of
 * one subagent. The engine gives no subagent transcript file, so the
 * `turn.step` hook writes this file.
 */
export const agentContextFile = (io, sessionId, agentId) =>
  pathFor(io.platform).join(
    stateDir(io),
    `${safeId(sessionId)}.${safeId(agentId)}.context.json`,
  );

/** The file that keeps the count of compactions of the main conversation. */
export const compactionsFile = (io, sessionId) =>
  pathFor(io.platform).join(stateDir(io), `${safeId(sessionId)}.compactions`);

/** The `{ first, last }` of an agent context file, or null when it is bad. */
export function contextOf(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const { first, last } = value ?? {};
  return Number.isFinite(first) && Number.isFinite(last)
    ? { first, last }
    : null;
}

/** The count in a compactions file, or null when it is bad. */
export function countOf(text) {
  const trimmed = String(text).trim();
  const n = Number(trimmed);
  return trimmed && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The context tokens of one step: input plus cache reads and writes, as
 * `tokensOf` in `_transcript-parse.mjs`. Null without a usage.
 */
export const contextTokensOf = (usage) =>
  usage && typeof usage === "object"
    ? (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
    : null;
