// The Node io of `_io.mjs`, for `hooks/dispatch.mjs`, the classic hooks, and
// the tests. No file of the guard closure imports this file.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    session: { data },
  };
}
