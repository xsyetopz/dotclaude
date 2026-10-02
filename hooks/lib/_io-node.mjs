// The Node io of `_io.mjs`, for `hooks/dispatch.mjs`, the classic hooks, and
// the tests. No file of the guard closure imports this file.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir } from "./_core.mjs";
import { subagentTranscript, tail } from "./_transcript.mjs";
import {
  compactionsFromText,
  contextFromText,
  LAST_PROMPT_CHARS,
  mainContextFromText,
  nestedFromText,
  promptsFromText,
  stoppedAtLimitInText,
  turnsFromText,
} from "./_transcript-parse.mjs";

const kindOf = (stat) =>
  stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other";

async function stat(file, options = {}) {
  const link = await fs.promises.lstat(file);
  let target = link;
  if (link.isSymbolicLink())
    target = await fs.promises.stat(file).catch(() => link);
  const out = {
    kind: target === link && link.isSymbolicLink() ? "other" : kindOf(target),
    size: target.isFile() ? target.size : 0,
    mtimeMs: target.mtimeMs,
    isLink: link.isSymbolicLink(),
  };
  if (options.resolve) {
    const real = await fs.promises.realpath(file).catch(() => undefined);
    if (real !== undefined) out.realPath = real;
  }
  return out;
}

async function list(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return Promise.all(
    entries.map(async (e) => {
      const isLink = e.isSymbolicLink();
      const kind = isLink
        ? "other"
        : e.isFile()
          ? "file"
          : e.isDirectory()
            ? "dir"
            : "other";
      let size = 0;
      let mtimeMs = 0;
      if (kind === "file") {
        const s = await fs.promises
          .stat(path.join(dir, e.name))
          .catch(() => null);
        size = s?.size ?? 0;
        mtimeMs = s?.mtimeMs ?? 0;
      }
      return { name: e.name, kind, size, mtimeMs, isLink };
    }),
  );
}

const MAX_READ = 4 * 1024 * 1024;

async function read(file) {
  const s = await fs.promises.stat(file);
  if (s.size > MAX_READ) throw new Error(`${file}: larger than 4 MiB`);
  return fs.promises.readFile(file, "utf8");
}

async function head(file, bytes) {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = new Uint8Array(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

let tmpCount = 0;

async function write(file, text) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpCount++}.tmp`;
  await fs.promises.writeFile(tmp, text);
  await fs.promises.rename(tmp, file);
}

async function append(file, text) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, text);
}

async function create(file, text) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.promises.writeFile(file, text, { flag: "wx" });
    return true;
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  }
}

const RUN_MAX_BYTES = 64 * 1024 * 1024;
const KILL_GRACE_MS = 1000;

function run(argv, init = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: init.cwd,
      env: init.env ? { ...process.env, ...init.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const maxBytes = init.maxBytes ?? RUN_MAX_BYTES;
    const out = [];
    const err = [];
    let bytes = 0;
    let settled = false;
    let killTimer;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    // Stops the child. A child that ignores SIGTERM gets SIGKILL after a
    // short grace time, so it cannot keep the hook process alive.
    const stop = (reason) => {
      settle(reject, new Error(`${argv[0]}: ${reason}`));
      child.kill();
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => stop("timed out"), init.timeoutMs ?? 30_000);
    const collect = (chunks) => (d) => {
      if (settled) return;
      bytes += d.length;
      if (bytes > maxBytes) stop(`output passed ${maxBytes} bytes`);
      else chunks.push(d);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    child.on("error", (e) => {
      clearTimeout(killTimer);
      settle(reject, e);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      settle(resolve, {
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(init.stdin ?? "");
  });
}

/**
 * Compactions recorded in a transcript, or null when it cannot be read.
 *
 * The status line calls this on each refresh, and a long transcript is tens
 * of MB. A cache file keeps the count and the byte offset after the last
 * complete line, so each call reads only the lines appended since. A
 * different inode, a shorter file, or no newline before the offset means
 * that the transcript was replaced, and the count starts again from 0.
 */
export function compactionCount(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, "r");
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    const cacheFile = path.join(
      stateDir(nodeIo()),
      `compactions-${createHash("sha256").update(String(transcriptPath)).digest("hex").slice(0, 16)}.json`,
    );
    let { ino, offset, count } = { ino: stat.ino, offset: 0, count: 0 };
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const before = Buffer.alloc(1);
      if (
        cached.ino === stat.ino &&
        cached.offset > 0 &&
        cached.offset <= stat.size &&
        fs.readSync(fd, before, 0, 1, cached.offset - 1) === 1 &&
        before[0] === 0x0a
      )
        ({ offset, count } = cached);
    } catch {
      // No cache yet, or another call is replacing it: count from 0.
    }
    if (stat.size === offset) return count;
    const bytes = Buffer.alloc(stat.size - offset);
    const read = fs.readSync(fd, bytes, 0, bytes.length, offset);
    // Stop after the last complete line, so that a line that Claude Code is
    // still writing is read whole next time.
    const end = bytes.subarray(0, read).lastIndexOf(0x0a) + 1;
    count += compactionsFromText(bytes.subarray(0, end).toString("utf8"));
    if (end > 0) {
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(
          tmp,
          JSON.stringify({ ino, offset: offset + end, count }),
        );
        fs.renameSync(tmp, cacheFile);
      } catch {
        // The count is right. Only the next call reads more.
        fs.rmSync(tmp, { force: true });
      }
    }
    return count;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A session fact that resolves `unknown` when it throws, for example on a
 * hook input with fields of an unexpected type.
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

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * The session facts for one hook input, from the transcript files. The main
 * transcript can be tens of MB, so most facts about it read only its end.
 * @returns {import("./_io.mjs").IoSession}
 */
function nodeSession(data) {
  const transcript =
    typeof data.transcript_path === "string" ? data.transcript_path : "";
  const agentPath = () =>
    transcript && data.session_id && data.agent_id
      ? subagentTranscript(transcript, data.session_id, data.agent_id)
      : "";
  const agentText = () => {
    const file = agentPath();
    return file ? readText(file) : null;
  };
  const mainTail = (bytes) => (transcript ? tail(transcript, bytes) : null);
  return {
    lastPrompt: known(
      "",
      () =>
        promptsFromText(mainTail() ?? "", 1, LAST_PROMPT_CHARS).at(-1) ?? "",
    ),
    agentTranscriptPath: known("", agentPath),
    agentTurns: known(null, () => {
      const text = agentText();
      return text === null ? null : turnsFromText(text);
    }),
    agentContext: known(null, () => {
      const text = agentText();
      return text === null ? null : contextFromText(text);
    }),
    loadedNested: known(null, () => {
      const text = mainTail();
      return text === null ? null : nestedFromText(text);
    }),
    mainContextTokens: known(null, () => {
      const text = mainTail(1_000_000);
      return text ? mainContextFromText(text) : null;
    }),
    compactions: known(null, () =>
      transcript ? compactionCount(transcript) : null,
    ),
    agentStoppedAtLimit: known(null, (id) => {
      // A task notification can be anywhere in the transcript, so this fact
      // reads all of it.
      const text = transcript ? readText(transcript) : null;
      return text === null ? null : stoppedAtLimitInText(text, String(id));
    }),
  };
}

/**
 * The Node io for one hook input. `data` is the hook's stdin JSON, from which
 * the session facts come.
 * @returns {import("./_io.mjs").Io}
 */
export function nodeIo(data = {}) {
  return {
    platform: process.platform === "win32" ? "win32" : "posix",
    env: process.env,
    home: os.homedir(),
    tmp: os.tmpdir(),
    cwd: process.cwd(),
    pluginRoot:
      process.env.CLAUDE_PLUGIN_ROOT || path.join(import.meta.dir, "..", ".."),
    fs: {
      read,
      head,
      write,
      append,
      create,
      remove: (file) => fs.promises.rm(file, { force: true }),
      exists: (file) =>
        fs.promises.stat(file).then(
          () => true,
          () => false,
        ),
      stat,
      list,
    },
    run,
    session: nodeSession(data),
  };
}
