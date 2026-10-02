// The io contract of the guard closure. A guard action and every lib file it
// imports reach the host only through an `io` object of this shape, never
// through `node:*` or `Bun.*`, so the same code runs in two places:
//
// - `hooks/dispatch.mjs` (classic command hooks, tests) gives the Node io of
//   `_io-node.mjs`.
// - `hooks/register.mjs` (the hooks module) gives an io over the engine's
//   `$`, which has no Node and no Bun.
//
// A ported action exports `default async (io, data)` and returns a classic
// hook output object, or null for no output.
//
// This file holds only the contract and pure helpers. It imports nothing.

/**
 * @typedef {object} IoStat
 * @property {"file" | "dir" | "other"} kind What the path leads to.
 * @property {number} size Bytes of a file, 0 for other kinds.
 * @property {number} mtimeMs Last change time.
 * @property {boolean} isLink The path itself is a symbolic link.
 * @property {string} [realPath] With `{ resolve: true }`: the path with every
 *   link and `..` resolved. Absent when it leads nowhere.
 */

/**
 * An entry has no size or time, so a listing costs no `stat` for each file.
 * Use `stat` for them.
 * @typedef {object} IoEntry
 * @property {string} name
 * @property {"file" | "dir" | "other"} kind A symbolic link is `other`.
 * @property {boolean} isLink
 */

/**
 * @typedef {object} IoFs
 * @property {(path: string) => Promise<string>} read UTF-8 text. Rejects
 *   when the file is missing or larger than 4 MiB.
 * @property {(path: string, bytes: number) => Promise<Uint8Array>} head The
 *   first `bytes` bytes, fewer for a short file. Rejects when missing. The
 *   hooks-module io reads the whole file, so it also rejects a file larger
 *   than 4 MiB.
 * @property {(path: string, text: string) => Promise<void>} write Replaces
 *   the whole file and creates its folders. The Node io writes a temp file
 *   and renames it, so a reader never sees half a file.
 * @property {(path: string, text: string) => Promise<void>} append Adds to
 *   the end and creates the file and its folders.
 * @property {(path: string, text: string) => Promise<boolean>} create
 *   Writes a new file and resolves true, or resolves false when the path
 *   exists. Atomic in the Node io only.
 * @property {(path: string) => Promise<void>} remove Deletes a file. No error
 *   when it is missing. The engine has no delete, so the hooks-module io
 *   writes `""` to the file in its place.
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(path: string, options?: { resolve?: boolean }) => Promise<IoStat>}
 *   stat Rejects when missing.
 * @property {(path: string) => Promise<IoEntry[]>} list Rejects when the
 *   folder is missing.
 */

/**
 * @typedef {object} IoRunResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {object} IoSession Facts about the session of the hook input that
 *   made the io (`session_id`, `agent_id`, `transcript_path`). The Node io
 *   reads them from the transcript files, the hooks module from the engine.
 *   The io gives facts, not transcript text, because the engine gives only
 *   parsed messages. When the host cannot tell, a fact resolves to its "do
 *   not know" value and does not reject. Each member below gives that value
 *   and the side to which the caller errs with it.
 * @property {() => Promise<string>} lastPrompt The last prompt that the user
 *   typed. A longer prompt is cut to 4000 characters plus the ` [...]`
 *   suffix. `""` when not known. A guard that looks for consent in the
 *   prompt then finds none and keeps its ask, which is the safe side.
 * @property {() => Promise<string>} agentTranscriptPath The transcript file
 *   of the subagent. `""` when the input is not from a subagent or the host
 *   has no transcript file. The caller then reads no file.
 * @property {() => Promise<number | null>} agentTurns The subagent's API
 *   calls since its latest prompt, resume, or wake-up. Claude Code counts
 *   `maxTurns` from there. Null when not known. The turn budget then does
 *   not deny, which is fail-open.
 * @property {() => Promise<{ first: number, last: number } | null>}
 *   agentContext The context tokens of the subagent's first and latest API
 *   calls. Null when not known. The context budget then does not deny or
 *   warn, which is fail-open.
 * @property {() => Promise<Set<string> | null>} loadedNested The paths of the
 *   nested memory files that Claude Code loaded. Null when not known. An
 *   empty Set is a finding: no file loaded. A caller that keeps its own
 *   record of what it injected may treat null as empty. Then it injects each
 *   file at most once, and a file that Claude Code loaded can repeat once. A
 *   caller with no such record may not treat null as empty, because then it
 *   injects every file again.
 * @property {() => Promise<number | null>} mainContextTokens The context
 *   tokens of the main conversation: the input of its last response, or the
 *   size after a later compaction. Null when not known. The context note
 *   then does not show, which is fail-open.
 * @property {() => Promise<number | null>} compactions The compactions of
 *   the main conversation. Null when not known. The caller then gives no
 *   note that depends on the count, which is fail-open. It does not treat
 *   null as 0.
 * @property {(agentId: string) => Promise<boolean | null>} agentStoppedAtLimit
 *   True when a task notification shows that the agent `agentId` stopped at
 *   its turn limit. Null when not known. The caller then sends the message
 *   to the agent without a change, which is fail-open.
 */

/**
 * @typedef {object} Io
 * @property {"posix" | "win32"} platform The path flavor of the host.
 * @property {Record<string, string | undefined>} env The host environment.
 *   The hooks module fills it from a fixed list of names and from the
 *   plugin options as `CLAUDE_PLUGIN_OPTION_<KEY>`. It makes
 *   `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_DATA` as Claude Code makes them
 *   for a command hook, because the engine environment does not have them.
 * @property {string} home The user's home folder.
 * @property {string} tmp The host's temp folder.
 * @property {string} cwd The session's working directory.
 * @property {string} pluginRoot The plugin's root folder. It holds `agents/`.
 *   The Node io takes it from the place of its own file, and not from
 *   `CLAUDE_PLUGIN_ROOT`, which can name another install. The hooks module
 *   gives `$.plugin.root`.
 * @property {IoFs} fs
 * @property {(argv: string[], init?: { cwd?: string, stdin?: string,
 *   timeoutMs?: number, maxBytes?: number, env?: Record<string, string> }) =>
 *   Promise<IoRunResult>}
 *   run Runs a command with no shell. Resolves for every exit code. Rejects
 *   when the command cannot start, passes the timeout (30 s by default), or
 *   writes more than `maxBytes` to stdout and stderr together (64 MiB by
 *   default). Then it stops the command, with SIGKILL after 1 s if needed.
 *   In the hooks-module io, the timeout is 10 minutes at most, stdin is
 *   empty by default, and the command runs to its end before the
 *   `maxBytes` check. That io also rejects when the engine cuts stdout or
 *   stderr at its stream limit of 4 MiB.
 * @property {IoSession} session Facts about the running session.
 */

export {};
