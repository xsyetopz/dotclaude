// `um win`: Windows games from an agent (native Windows, or WSL).
// A port of `um/win.py` from universal-modder, with the SHA-256 check of the ffmpeg download from PR #111.
// It runs the PowerShell tools in `ps1/`.
// `data/win.json` has the help text, the messages, the command table and the ffmpeg arguments.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  die,
  isWindows,
  isWsl,
  psExe,
  run,
  toPosix,
  toWin,
} from "./common.mjs";
import data from "./data/win.json" with { type: "json" };

export const help = data.help.join("\n");

const URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const SUMS = `${path.posix.dirname(URL)}/checksums.sha256`;
const { quiet: Q, probe, tags } = data.ffmpeg;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const cmd = (head, flags, ...rest) => [head, ...flags.split(" "), ...rest];
const exeName = (e) => (/\.exe$/i.test(e) ? e : `${e}.exe`);
const quote = (s) => s.replaceAll("'", "''");
const winBin = (n) => (isWsl() ? `${n}.exe` : n);
const cwd = () => (isWsl() ? "/mnt/c" : undefined);
const show = (r) =>
  console.log((r.stdout || r.stderr).replaceAll("\r", "").trim());

/** Calls that tests replace. */
export const deps = {
  spawn: (...a) => Bun.spawn(...a),
  ffmpegWin: (required) => ffmpegWin(required),
  encoder: () => encoder(),
};

/** Runs a Windows program, from `/mnt/c` under WSL, and returns its result. */
const win = (c, opts) => run(c, { check: false, cwd: cwd(), ...opts });

/** Starts one of the PowerShell tools of `ps1/` with pipes. */
const spawnPs = (tool, rest, o) =>
  deps.spawn(cmd(psExe(), data.powershell, toolPath(tool), ...rest), {
    ...{ stdin: "pipe", stdout: "pipe", cwd: cwd(), ...o },
  });

function checkPlatform() {
  if (!(isWindows() || isWsl())) die(data.messages.platform);
}

function powershell(script) {
  checkPlatform();
  const flags = "-NoProfile -NonInteractive -Command";
  const r = win(cmd(psExe(), flags, script), { timeout: 60 });
  if (r.status) die(`powershell failed: ${r.stderr.trim().slice(-1500)}`);
  return r.stdout.replaceAll("\r", "");
}

/** %LOCALAPPDATA%\universal-modder (a posix path under WSL). */
function localAppdata() {
  const get = "[Environment]::GetFolderPath('LocalApplicationData')";
  const base = isWindows()
    ? process.env.LOCALAPPDATA
    : toPosix(powershell(get).trim());
  const d = path.join(base, "universal-modder");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Copies `ps1/<name>` to %LOCALAPPDATA%, because PowerShell does not run scripts from \\wsl$ reliably. Returns a Windows path. */
function toolPath(name) {
  const src = fs.readFileSync(path.join(import.meta.dir, "ps1", name));
  const dst = path.join(localAppdata(), "tools", name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!fs.existsSync(dst) || Buffer.compare(fs.readFileSync(dst), src))
    fs.writeFileSync(dst, src);
  return toWin(dst);
}

/** A Windows ffmpeg that has gfxcapture: $UM_FFMPEG_WIN, our download, or one on the Windows PATH. */
function ffmpegWin(required = true) {
  let own;
  try {
    own = path.join(localAppdata(), "ffmpeg", "bin", "ffmpeg.exe");
  } catch {}
  const found = [
    process.env.UM_FFMPEG_WIN,
    own,
    isWindows() && Bun.which("ffmpeg"),
  ]
    .map((c) => c && toPosix(c))
    .find((c) => c && fs.existsSync(c));
  if (!(found || !required)) die(data.messages.noFfmpeg);
  return found;
}

/**
 * Downloads the ffmpeg zip to `zip`, and keeps it only when its SHA-256 matches.
 * The sum is $UM_FFMPEG_SHA256 (a pin that you checked yourself), else the checksums.sha256 of the build.
 * The "latest" build changes each day, so a hash in this file would break within days.
 * The published sum catches a corrupt, cut, or swapped download, and the pin catches a compromised release.
 */
async function downloadFfmpeg(zip) {
  const get = async (url, what, signal) => {
    const res = await fetch(url, { signal });
    return res.ok ? res : die(`${what}: HTTP ${res.status}`);
  };
  const name = path.posix.basename(URL);
  let want = (process.env.UM_FFMPEG_SHA256 ?? "").trim().toLowerCase();
  if (!want) {
    const res = await get(
      SUMS,
      `cannot read ${SUMS}`,
      AbortSignal.timeout(60_000),
    );
    const row = (await res.text())
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .find(([, f]) => f?.replace(/^\*/, "") === name);
    want =
      row?.[0].toLowerCase() ??
      die(
        `${name} is not listed in ${SUMS}. Set UM_FFMPEG_SHA256, or point UM_FFMPEG_WIN at an ffmpeg you trust.`,
      );
  }
  console.log("downloading", URL);
  const bytes = new Uint8Array(
    await (await get(URL, "download failed")).arrayBuffer(),
  );
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want)
    die(
      `ffmpeg download failed its checksum (got ${got}, expected ${want}). The daily build can change during a download: run \`um win setup\` again. If it keeps failing, do not use this build.`,
    );
  fs.writeFileSync(zip, bytes);
  console.log("sha256 ok", want);
}

/** Extracts a zip with the `tar` of Windows (bsdtar reads zip, and GNU tar does not). Returns the top folder. */
function unzip(zip, dir) {
  const root = process.env.SystemRoot || "C:\\Windows";
  const tar = isWsl()
    ? "tar.exe"
    : path.win32.join(root, "System32", "tar.exe");
  const listing = win([tar, "-tf", toWin(zip)], { check: true }).stdout;
  win([tar, "-xf", toWin(zip), "-C", toWin(dir)], { check: true });
  return listing.trim().split(/\r?\n/)[0].split("/")[0];
}

async function setup({ force }) {
  checkPlatform();
  const d = localAppdata();
  for (const t of ["WinDrive.ps1", "ProcLoopback.ps1"])
    console.log("tool", toolPath(t));
  if (!deps.ffmpegWin(false) || force) {
    const zip = path.join(d, "ffmpeg.zip");
    await downloadFfmpeg(zip);
    const root = unzip(zip, d);
    fs.rmSync(path.join(d, "ffmpeg"), { recursive: true, force: true });
    fs.renameSync(path.join(d, root), path.join(d, "ffmpeg"));
    fs.rmSync(zip);
  }
  const ff = deps.ffmpegWin();
  const info = win(cmd(ff, "-hide_banner -h filter=gfxcapture")).stdout;
  const ok = info.includes("gfxcapture")
    ? "(gfxcapture ok)"
    : "(WARNING: no gfxcapture in this build)";
  console.log("ffmpeg", ff, ok);
  // The first encoder that takes a test frame: h264_nvenc, h264_amf, h264_qsv, else libx264.
  const encoder = Object.keys(data.codecs).find(
    (e) => win([...cmd(ff, probe, e), "-f", "null", "-"]).status === 0,
  );
  fs.writeFileSync(path.join(d, "config.json"), JSON.stringify({ encoder }));
  console.log("encoder", encoder);
}

function encoder() {
  try {
    const file = path.join(localAppdata(), "config.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).encoder;
  } catch {
    return "libx264";
  }
}

function processes(name) {
  const flt = name ? `-Name '${quote(name)}*'` : "";
  const out = powershell(
    `Get-Process ${flt} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id,ProcessName,MainWindowTitle,@{n='Hwnd';e={[int64]$_.MainWindowHandle}} | ConvertTo-Json -Compress`,
  );
  return out.trim() ? [JSON.parse(out)].flat() : [];
}

function pidOf(name) {
  const out = powershell(
    `(Get-Process -Name '${quote(name.replace(/\.exe$/i, ""))}' -ErrorAction SilentlyContinue | Select-Object -First 1).Id`,
  ).trim();
  return /^\d+$/.test(out) ? Number(out) : null;
}

function source({ exe, hwnd, title, crop }) {
  const sel =
    [
      hwnd && `hwnd=${hwnd}`,
      exe && `window_exe=${exeName(exe)}`,
      title && `window_title=${title}`,
    ].find(Boolean) ?? die("give --exe, --hwnd or --title");
  const cut = ["left", "top", "right", "bottom"]
    .map((n, i) => (crop ? `:crop_${n}=${crop[i]}` : ""))
    .join("");
  return `gfxcapture=${sel}:capture_cursor=0:max_framerate=60${cut},hwdownload,format=bgra`;
}

/** The HKCU UserGpuPreferences values: exe path (or DirectXUserGlobalSettings) -> "AppStatus=1;AutoHDREnable=2097;". */
export function gpuPrefs() {
  if (!(isWindows() || isWsl())) return {};
  const key = String.raw`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`;
  const out = win([winBin("reg"), "query", key], { timeout: 15 }).stdout;
  const pairs = out.split(/\r?\n/).map((l) => l.trim().split("    REG_SZ    "));
  return Object.fromEntries(pairs.filter((p) => p.length > 1));
}

/** Windows Auto HDR for this game (its own setting, else the global one). An odd AutoHDREnable is on (2097 on, 2096 off). */
export function autoHdrOn(exe, prefs = gpuPrefs()) {
  const flag = (s) => /(?:^|;)AutoHDREnable=(\d+)/.exec(s)?.[1];
  const name = exe && exeName(exe).toLowerCase();
  const own = Object.entries(prefs).find(
    ([p, d]) => path.win32.basename(p).toLowerCase() === name && flag(d),
  );
  return (
    Number(flag(own?.[1] ?? prefs.DirectXUserGlobalSettings ?? "")) % 2 === 1
  );
}

function warnAutoHdr(exe) {
  if (autoHdrOn(exe))
    console.error(data.messages.hdr.replace("{exe}", exe ? ` for ${exe}` : ""));
}

/** One frame of a game window as PNG. With `scale` it also writes `<out>_small.png`. Returns the path. */
function shot(out, sel, scale) {
  const ff = deps.ffmpegWin();
  warnAutoHdr(sel.exe);
  const dst = path.resolve(out);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const src = source(sel);
  const grab = cmd(ff, `${Q} -f lavfi -i`, src, "-frames:v", "1", toWin(dst));
  const r = run(grab, { check: false, timeout: 20 });
  if (r.status || !fs.existsSync(dst))
    die(
      `capture failed (is the window open and not minimized?): ${r.stderr.trim().slice(-800)}`,
    );
  if (scale) {
    const small = dst.replace(/(\.[^.\\/]*)?$/, "_small.png");
    const side = (n) => `'max(1,trunc(${n}*${scale}))'`;
    const vf = `scale=w=${side("iw")}:h=${side("ih")}:flags=lanczos`;
    run(cmd(ff, `${Q} -i`, toWin(dst), "-vf", vf, toWin(small)));
    console.log(small);
  }
  return dst;
}

/** Yields the lines of a process stdout stream, and the rest at the end. */
async function* lines(stream) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      yield buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
    }
  }
  yield buf;
}

/** Reads one line from `it` (a `lines` generator). */
const readLine = async (it) => ((await it.next()).value ?? "").trim();

/** Writes to the stdin of `proc`, and ignores a closed pipe. */
async function tell(proc, text) {
  try {
    proc.stdin.write(text);
    await proc.stdin.flush();
  } catch {}
}

/** Waits for `proc` to exit, and kills it after `seconds`. */
async function waitOrKill(proc, seconds, note) {
  const timer = setTimeout(() => {
    if (note) console.error(note);
    proc.kill();
  }, seconds * 1000);
  await proc.exited;
  clearTimeout(timer);
}

/**
 * Game window video (gfxcapture to .mkv), game-only audio (ProcLoopback to .audio.raw) and a timing .json.
 * Then: `um video mux take1.mkv take1.audio.raw take1.json take1.mp4`.
 */
export class Recorder {
  /** ffmpeg spawn, capture and encoder init before the first frame (measured 0.24 to 0.3 s). */
  static STARTUP = 0.3;

  constructor(opts = {}) {
    this.o = { out: "take", fps: 30, audio: true, ...opts };
    const out = this.o.out;
    this.base = isWsl() && out[1] !== ":" ? toWin(path.resolve(out)) : out;
  }

  async start() {
    const { exe, fps, audio, pid = audio && exe && pidOf(exe) } = this.o;
    const ff = deps.ffmpegWin();
    warnAutoHdr(exe);
    const enc = deps.encoder();
    // RGB to YUV with the BT.709 matrix, and tag it.
    // An untagged file gets BT.601 here, but browsers read it as BT.709.
    const vf = [
      `fps=${fps}`,
      enc === "h264_nvenc" && "scale='min(iw,4096)':-2",
      "crop=trunc(iw/2)*2:trunc(ih/2)*2",
      "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    ].filter(Boolean);
    this.tAudio = Date.now();
    if (audio && pid) {
      const a = ["-TargetPid", String(pid), "-Out", `${this.base}.audio.raw`];
      this.audio = spawnPs("ProcLoopback.ps1", a, { stderr: "ignore" });
      this.header = JSON.parse(
        (await readLine(lines(this.audio.stdout))) || "{}",
      );
      this.tAudio = Date.now();
    } else if (audio) console.error(data.messages.noPid);
    this.tVideo = Date.now();
    this.log = toPosix(`${this.base}.ffmpeg.log`);
    const src = source(this.o);
    const input = cmd(ff, `${Q} -f lavfi -i`, src, "-vf", vf.join(","));
    const codec = data.codecs[enc] ?? data.codecs.libx264;
    const args = [...input, ...codec.split(" "), ...tags.split(" ")];
    const stderr = fs.openSync(this.log, "w");
    this.video = deps.spawn([...args, `${this.base}.mkv`], {
      stdin: "pipe",
      stderr,
    });
    return this;
  }

  /** Sends `q` to ffmpeg, then waits. Never call it from a thread that the game needs: gfxcapture stalls when the window freezes. */
  async stop() {
    const mkv = `${this.base}.mkv`;
    if (this.video) {
      await tell(this.video, "q");
      await waitOrKill(this.video, 20, "ffmpeg ignored q. Killing it.");
    }
    const meta = { video: mkv };
    if (this.audio) {
      await tell(this.audio, "\n");
      await waitOrKill(this.audio, 10);
      const gap = this.tVideo - this.tAudio + Recorder.STARTUP * 1000;
      Object.assign(meta, this.header, {
        audio: `${this.base}.audio.raw`,
        audio_offset_s: Math.round(gap) / 1000,
      });
    }
    fs.writeFileSync(
      toPosix(`${this.base}.json`),
      JSON.stringify(meta, null, 1),
    );
    if (!fs.existsSync(toPosix(mkv)) || fs.statSync(toPosix(mkv)).size === 0) {
      const err = fs.existsSync(this.log)
        ? fs.readFileSync(this.log, "utf8").trim().slice(-600)
        : "";
      console.error(data.messages.noFrames + (err ? `\nffmpeg: ${err}` : ""));
    }
    console.log("recorded", mkv, this.audio ? "(+ audio)" : "");
    return meta;
  }
}

/** A parser of a numeric option: `undefined` stays, and a bad value is an error. */
const numeric = (kind, ok) => (v, name) => {
  if (v !== undefined && !ok(v)) die(`${name} must be ${kind}: ${v}`);
  return v === undefined ? v : Number(v);
};
const int = numeric("an integer", (v) => /^-?\d+$/.test(v));
const number = numeric("a number", (v) => Number.isFinite(Number(v)));

const handlers = {
  setup: (v) => setup(v),
  ps(_v, [name]) {
    for (const p of processes(name)) {
      const id = String(p.Id).padStart(7);
      console.log(`${id}  ${p.ProcessName.padEnd(28)} ${p.MainWindowTitle}`);
    }
  },
  kill(_v, [pid]) {
    const n = int(pid, "pid") ?? die("give a PID");
    show(win([winBin("taskkill"), "/PID", String(n), "/F"]));
  },
  launch(v, [target, ...rest]) {
    if (!target) die("give an exe path or a Steam app id");
    const url = rest.length
      ? `steam://run/${target}//${rest.join(" ")}/`
      : `steam://rungameid/${target}`;
    const what = v.steam ? [url] : [toWin(target), ...rest];
    win(cmd(winBin("cmd"), "/c start", "", ...what), { timeout: 30 });
  },
  shot(v, [out]) {
    if (!out) die("give an output path");
    const sel = { exe: v.exe, hwnd: int(v.hwnd, "hwnd"), title: v.title };
    console.log(shot(out, sel, number(v.scale, "scale")));
  },
  /** The JavaScript side of WinDrive: one command line in, one answer line out. */
  async drive(v, cmds) {
    if (!v.proc) die("give --proc");
    if (!cmds.length) die("give at least one command");
    checkPlatform();
    const p = spawnPs("WinDrive.ps1", ["-Proc", v.proc], { stderr: "inherit" });
    const it = lines(p.stdout);
    const send = async (line, retry = true) => {
      p.stdin.write(`${line}\n`);
      await p.stdin.flush();
      const out = await readLine(it);
      if (!out.startsWith("error")) return out;
      if (!(out.includes("foreground") && retry))
        throw new Error(`${line}: ${out}`);
      await send("focus", false); // nobody at the PC: the foreground drifts, so take it back once
      await sleep(0.3);
      return send(line, false);
    };
    console.log(await readLine(it));
    try {
      for (const line of cmds)
        console.log(line, "->", await send(line, !v["no-retry"]));
    } finally {
      try {
        p.stdin.end();
        await waitOrKill(p, 5);
      } catch {
        p.kill();
      }
    }
  },
  async record(v) {
    if (!v.out) die("give --out");
    const crop = v.crop?.split(":").map((n) => int(n, "crop"));
    if (crop && crop.length !== 4) die("--crop needs left:top:right:bottom");
    const seconds = number(v.seconds, "seconds");
    const rec = await new Recorder({
      ...v,
      hwnd: int(v.hwnd, "hwnd"),
      fps: int(v.fps, "fps") ?? 30,
      audio: !v["no-audio"],
      crop,
      pid: int(v.pid, "pid"),
    }).start();
    try {
      if (seconds) await sleep(seconds);
      else {
        process.stdout.write("recording - press Enter to stop ");
        for await (const _ of console) break;
      }
    } finally {
      console.log(JSON.stringify(await rec.stop(), null, 2));
    }
  },
  reg(v, [action, key, value, val]) {
    if (!["get", "set"].includes(action) || !key)
      die("usage: um win reg get|set KEY [VALUE] [DATA]");
    const reg = (...a) => win([winBin("reg"), ...a]);
    if (action === "get")
      return show(reg("query", key, ...(value ? ["/v", value] : [])));
    if (!value || val === undefined) die("`reg set` needs KEY VALUE DATA");
    const dir = path.join(localAppdata(), "reg-backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const name = `${key.replaceAll("\\", "_").replaceAll(":", "")}-${stamp}`;
    const bfile = path.join(dir, `${name}.reg`);
    reg("export", key, toWin(bfile), "/y");
    console.log("backup:", bfile);
    const type = v.type ?? "REG_DWORD";
    show(reg("add", key, "/v", value, "/t", type, "/d", val, "/f"));
  },
};

/** The command table: `data.commands` has the help, usage and options, and `handlers` has the code. */
for (const [name, c] of Object.entries(data.commands)) c.run = handlers[name];
export const commands = data.commands;
