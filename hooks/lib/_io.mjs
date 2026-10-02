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
 * @typedef {object} IoEntry
 * @property {string} name
 * @property {"file" | "dir" | "other"} kind A symbolic link is `other`.
 * @property {number} size
 * @property {number} mtimeMs
 * @property {boolean} isLink
 */

/**
 * @typedef {object} IoFs
 * @property {(path: string) => Promise<string>} read UTF-8 text. Rejects
 *   when the file is missing or larger than 4 MiB.
 * @property {(path: string, bytes: number) => Promise<Uint8Array>} head The
 *   first `bytes` bytes, fewer for a short file. Rejects when missing.
 * @property {(path: string, text: string) => Promise<void>} write Replaces
 *   the whole file and creates its folders. The Node io writes a temp file
 *   and renames it, so a reader never sees half a file.
 * @property {(path: string, text: string) => Promise<void>} append Adds to
 *   the end and creates the file and its folders.
 * @property {(path: string, text: string) => Promise<boolean>} create
 *   Writes a new file and resolves true, or resolves false when the path
 *   exists. Atomic in the Node io only.
 * @property {(path: string) => Promise<void>} remove Deletes a file. No error
 *   when it is missing.
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
 * @typedef {object} Io
 * @property {"posix" | "win32"} platform The path flavor of the host.
 * @property {Record<string, string | undefined>} env The host environment.
 *   The hooks module fills it from a fixed list of names and from the
 *   plugin options as `CLAUDE_PLUGIN_OPTION_<KEY>`.
 * @property {string} home The user's home folder.
 * @property {string} tmp The host's temp folder.
 * @property {string} cwd The session's working directory.
 * @property {IoFs} fs
 * @property {(argv: string[], init?: { cwd?: string, stdin?: string,
 *   timeoutMs?: number, maxBytes?: number, env?: Record<string, string> }) =>
 *   Promise<IoRunResult>}
 *   run Runs a command with no shell. Resolves for every exit code. Rejects
 *   when the command cannot start, passes the timeout (30 s by default), or
 *   writes more than `maxBytes` to stdout and stderr together (64 MiB by
 *   default). Then it stops the command, with SIGKILL after 1 s if needed.
 * @property {object} session Facts about the running session. The Node io
 *   reads them from the transcript, the hooks module from the engine. The
 *   slice that ports `_transcript.mjs`, `_usage.mjs`, and `_agents.mjs`
 *   defines the members.
 */

export {};
