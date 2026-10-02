// The Node io of `_io.mjs`, for `hooks/dispatch.mjs`, the classic hooks, and
// the tests. No file of the guard closure imports this file.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subagentTranscript, tail } from "./_transcript.mjs";
import {
  contextFromText,
  LAST_PROMPT_CHARS,
  mainContextFromText,
  nestedFromText,
  promptsFromText,
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

function run(argv, init = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: init.cwd,
      env: init.env ? { ...process.env, ...init.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${argv[0]}: timed out`));
    }, init.timeoutMs ?? 30_000);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
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
 * The session facts for one hook input, from the transcript files. The main
 * transcript can be tens of MB, so the facts about it read only its end.
 * @returns {import("./_io.mjs").IoSession}
 */
function nodeSession(data) {
  const transcript = data.transcript_path ?? "";
  const agentPath = () =>
    transcript && data.session_id && data.agent_id
      ? subagentTranscript(transcript, data.session_id, data.agent_id)
      : "";
  const agentText = () => {
    const file = agentPath();
    if (!file) return null;
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  return {
    lastPrompt: async () =>
      promptsFromText(tail(transcript) ?? "", 1, LAST_PROMPT_CHARS).at(-1) ??
      "",
    agentTranscriptPath: async () => agentPath(),
    agentTurns: async () => {
      const text = agentText();
      return text === null ? null : turnsFromText(text);
    },
    agentContext: async () => {
      const text = agentText();
      return text === null ? null : contextFromText(text);
    },
    loadedNested: async () => {
      const text = transcript ? tail(transcript) : null;
      return text ? nestedFromText(text) : new Set();
    },
    mainContextTokens: async () => {
      const text = transcript ? tail(transcript, 1_000_000) : null;
      return text ? mainContextFromText(text) : null;
    },
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
