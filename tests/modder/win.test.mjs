import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { psExe } from "../../plugins/dotclaude-modder/um/common.mjs";
import {
  autoHdrOn,
  deps,
  Recorder,
} from "../../plugins/dotclaude-modder/um/win.mjs";

const saved = { ...deps };
const cwd = process.cwd();
const which = Bun.which;
const systemRoot = process.env.SystemRoot;
afterEach(() => {
  Object.assign(deps, saved);
  process.chdir(cwd);
  Bun.which = which;
  if (systemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = systemRoot;
});

test("record encodes with the BT.709 matrix and tags the file", async () => {
  // RGB to yuv420p uses BT.601 untagged, but browsers read HD video as BT.709 and shift the colours.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "um-win-"));
  let cmd;
  Object.assign(deps, {
    ffmpegWin: () => "ffmpeg",
    encoder: () => "libx264",
    spawn: (c) => {
      cmd = c;
      return {};
    },
  });
  await new Recorder({
    exe: "Game.exe",
    out: path.join(dir, "take"),
    audio: false,
  }).start();
  fs.rmSync(dir, { recursive: true, force: true });
  expect(cmd[cmd.indexOf("-vf") + 1]).toContain("out_color_matrix=bt709");
  expect(cmd[cmd.indexOf("-colorspace") + 1]).toBe("bt709");
  expect(cmd[cmd.indexOf("-color_range") + 1]).toBe("tv");
});

test("Auto HDR is read from the game setting, else the global one", () => {
  // Auto HDR on an HDR display washes out the capture of an SDR game, so `um win` warns.
  const prefs = {
    DirectXUserGlobalSettings: "AutoHDREnable=0;SwapEffectUpgradeEnable=1;",
    "E:\\Games\\Foo\\Foo.exe": "AppStatus=1;AutoHDREnable=2097;",
    "E:\\Games\\Bar\\Bar.exe": "AppStatus=1;AutoHDREnable=2096;",
  };
  expect(autoHdrOn("Foo.exe", prefs)).toBe(true);
  expect(autoHdrOn("foo", prefs)).toBe(true);
  expect(autoHdrOn("Bar.exe", prefs)).toBe(false);
  expect(autoHdrOn("Other.exe", prefs)).toBe(false);
  expect(autoHdrOn(undefined, prefs)).toBe(false);
  prefs.DirectXUserGlobalSettings = "AutoHDREnable=1;";
  expect(autoHdrOn("Other.exe", prefs)).toBe(true);
  expect(autoHdrOn("Bar.exe", prefs)).toBe(false);
});

test("psExe falls back to the full path when PATH lacks PowerShell", () => {
  // The PATH of an agent often lacks System32\WindowsPowerShell\v1.0, and a bare "powershell" then fails.
  // The relative SystemRoot makes a file name with backslashes on POSIX, so the test runs on each OS.
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "um-win-")));
  process.env.SystemRoot = "root";
  const exe = path.win32.join(
    "root",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "MZ");
  Bun.which = () => null;
  expect(psExe()).toBe(exe);
  Bun.which = (name) => `/on/path/${name}`;
  expect(psExe()).toBe("/on/path/powershell");
});
