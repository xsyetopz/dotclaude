// Helpers that the groups share: platform checks, WSL path mapping, subprocesses, output.
// A port of `um/common.py` from universal-modder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** An error that the CLI prints as `um: <message>` and exits with `code`. */
export class UmError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function die(message, code = 1) {
  throw new UmError(message, code);
}

/** The style text that `fal` and `comfy` add to each sprite prompt. */
export const SPRITE_STYLE =
  "a single game sprite, the whole subject in frame and centered, clean readable silhouette, no text, no watermark, no ground shadow, no background scenery";

/** A number option. `undefined` gives `def`, and an empty value is not 0. */
export const num = (v, def) =>
  v === undefined
    ? def
    : Number.isNaN(Number(v)) || !String(v).trim()
      ? die(`not a number: ${v}`)
      : Number(v);

/** The first five words of `s` as a file name stem, or `fallback` when it has none. */
export const slug = (s, fallback) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("_") || fallback;

export const isWindows = () => process.platform === "win32";
export const isMac = () => process.platform === "darwin";

export function isWsl() {
  if (process.platform !== "linux") return false;
  return (
    os.release().toLowerCase().includes("microsoft") ||
    fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")
  );
}

/** Windows PowerShell, by its full path when PATH lacks System32\WindowsPowerShell\v1.0. */
export function psExe() {
  const name = isWsl() ? "powershell.exe" : "powershell";
  if (Bun.which(name)) return Bun.which(name);
  const full = isWsl()
    ? "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    : path.win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
  return fs.existsSync(full) ? full : name;
}

/** /mnt/c/Games/x -> C:\Games\x under WSL. A Windows path passes through. */
export function toWin(p) {
  p = String(p);
  if (p[1] === ":") return p;
  const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(p);
  if (m)
    return `${m[1].toUpperCase()}:\\${(m[2] ?? "").slice(1).replaceAll("/", "\\")}`;
  if (isWsl() && Bun.which("wslpath"))
    return run(["wslpath", "-w", p]).stdout.trim();
  return p;
}

/** C:\Games\x -> /mnt/c/Games/x under WSL. Unchanged elsewhere. */
export function toPosix(p) {
  p = String(p);
  if (isWsl() && p[1] === ":")
    return `/mnt/${p[0].toLowerCase()}${p.slice(2).replaceAll("\\", "/")}`;
  return p;
}

/** Per-user state (backups, downloaded tools). `UM_HOME` overrides it. */
export function dataDir() {
  const d = process.env.UM_HOME || path.join(os.homedir(), ".universal-modder");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Runs `cmd` and returns `{ status, stdout, stderr }`. With `check`, a non-zero exit is an error. */
export function run(cmd, { check = true, timeout, cwd, env, input } = {}) {
  let res;
  try {
    res = Bun.spawnSync(cmd.map(String), {
      cwd,
      env,
      stdin: input === undefined ? "ignore" : Buffer.from(input),
      timeout: timeout && timeout * 1000,
    });
  } catch {
    die(`not found: ${cmd[0]}`);
  }
  const out = {
    status: res.exitCode,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  };
  if (check && out.status !== 0)
    die(
      `${cmd.slice(0, 3).join(" ")}... failed (${out.status}):\n${(out.stderr || out.stdout).trim().slice(-2000)}`,
    );
  return out;
}

export function emit(obj, asJson = false) {
  console.log(
    asJson || typeof obj !== "string" ? JSON.stringify(obj, null, 2) : obj,
  );
}

/** '64x26' -> [64, 26]; '128' -> [128, 128]. */
export function parseSize(s) {
  const [w, h = w] = String(s).toLowerCase().split("x", 2);
  const size = [Number.parseInt(w, 10), Number.parseInt(h, 10)];
  if (size.some(Number.isNaN)) die(`not a size: ${s}`);
  return size;
}
