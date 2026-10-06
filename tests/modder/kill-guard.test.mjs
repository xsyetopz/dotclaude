// dotclaude-modder: the hooks module denies a kill by process name or pattern,
// and passes a kill by PID and other commands.

import { expect, test } from "bun:test";
import {
  KILL_REASON,
  register,
} from "../../plugins/dotclaude-modder/hooks/module/index.mjs";

/** Runs the module on `e`, and returns its result or the event that it passed on. */
async function call(e) {
  let handler;
  register((event, fn) => {
    if (event === "tool.call") handler = fn;
  });
  return handler({}, e, async (passed) => ({ passed }));
}

test("a kill by name or pattern is denied", async () => {
  for (const command of [
    "pkill -f game.exe",
    "cd x && killall Steam",
    "taskkill /F /IM game.exe",
    "taskkill.exe /im game*",
    "powershell -c Stop-Process -Name game",
    "Stop-Process -n game -Force",
    "kill -9 $(pgrep -f game)",
    "pgrep game | xargs kill",
    'bash -c "pkill game"',
    "sh -c 'killall x'",
    "sudo pkill -f game",
    "kill `pgrep game`",
    "kill $(pidof game)",
    "pgrep game | xargs -r kill",
    "ps aux | grep game | awk '{print $2}' | xargs kill -9",
    "Get-Process game | Stop-Process",
    "Stop-Process -Na game",
    'taskkill /FI "IMAGENAME eq game.exe"',
  ])
    expect(await call({ tool: "Bash", command })).toEqual({
      deny: KILL_REASON,
    });
});

test("a kill by PID and other commands pass", async () => {
  for (const command of [
    "kill 1234",
    "taskkill /PID 1234 /F",
    "Stop-Process -Id 1234",
    "um win kill 1234",
    "pgrep -l game",
    "echo skillall",
    "grep pkill notes.md",
    "echo killall",
    "Stop-Process -Id 1234 -Force",
  ]) {
    const e = { tool: "Bash", command };
    expect(await call(e)).toEqual({ passed: e });
  }
  const read = { tool: "Read", file_path: "pkill.md" };
  expect(await call(read)).toEqual({ passed: read });
});
