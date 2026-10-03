// Notification (permission_prompt): the payload in, the sender argv out.
// A fake `io.run` stands in for the sender, so no notification shows.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ACTIONS, matches } from "../../hooks/lib/_actions.mjs";
import { remind } from "../../hooks/lib/_remind-child.mjs";
import {
  clearNotice,
  markQuestion,
  noticeFile,
} from "../../hooks/lib/_reminder.mjs";
import { notifyPermission as send } from "../../hooks/notification/notify-permission.mjs";

const payload = {
  session_id: "abcdef123456",
  cwd: "/home/u/proj",
  hook_event_name: "Notification",
  notification_type: "permission_prompt",
  message: "Allow Bash command: npm test",
};

/** An io whose `run` records each argv and exits with `exit(argv)`. */
function fakeIo(env = {}, exit = () => 0) {
  const ran = [];
  const files = new Map();
  return {
    ran,
    files,
    platform: "posix",
    tmp: "/tmp",
    env,
    fs: {
      read: async (f) => {
        if (!files.has(f)) throw new Error("ENOENT");
        return files.get(f);
      },
      write: async (f, t) => void files.set(f, t),
      exists: async (f) => files.has(f),
      remove: async (f) => void files.delete(f),
    },
    session: { recentPrompts: async () => ["fix the build\nplease"] },
    run: async (argv) => {
      ran.push(argv);
      const code = exit(argv);
      if (code === null) throw new Error("ENOENT");
      return { exitCode: code };
    },
  };
}

test("a permission prompt notifies with the text of the turn notices", async () => {
  const io = fakeIo();
  await send(io, payload, () => {});
  expect(io.ran).toStrictEqual([
    [
      "terminal-notifier",
      "-title",
      "Claude Code needs a permission",
      "-message",
      "fix the build | abcdef12 | proj",
    ],
  ]);
});

test("the sender falls back to osascript, and no sender is silent", async () => {
  const io = fakeIo({}, (argv) => (argv[0] === "osascript" ? 0 : null));
  await send(io, payload, () => {});
  expect(io.ran.map((a) => a[0])).toStrictEqual([
    "terminal-notifier",
    "osascript",
  ]);
  const none = fakeIo({}, () => null);
  await expect(send(none, payload, () => {})).resolves.toBeUndefined();
  expect(none.ran).toHaveLength(2);
});

test("other types, an open question, and the option off notify nothing", async () => {
  const cases = [
    [{}, { ...payload, notification_type: "idle_prompt" }],
    [{}, payload, true],
    [{ CLAUDE_PLUGIN_OPTION_NOTIFY_DESKTOP: "false" }, payload],
  ];
  for (const [env, data, question] of cases) {
    const io = fakeIo(env);
    // The CLI sends the same message for a question dialog.
    if (question) await markQuestion(io, data.session_id, true);
    await send(io, data, () => {});
    expect(io.ran).toHaveLength(0);
  }
});

test("a closed question flag, also an empty file, does not stop the notice", async () => {
  const io = fakeIo();
  await markQuestion(io, payload.session_id, true);
  await markQuestion(io, payload.session_id, false);
  await send(io, payload, () => {});
  expect(io.ran).toHaveLength(1);
  const file = noticeFile(io, payload.session_id).replace(
    /permission-notice$/,
    "question",
  );
  io.files.set(file, "");
  await send(io, payload, () => {});
  expect(io.ran).toHaveLength(2);
});

test("the dispatcher runs the action for a permission prompt only", () => {
  const [matcher] = ACTIONS.Notification[0];
  expect(matches(matcher, "permission_prompt")).toBe(true);
  expect(matches(matcher, "idle_prompt")).toBe(false);
});

test("the manifest turns the notifications and the handoff on by default", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../../.claude-plugin/plugin.json"),
      "utf8",
    ),
  );
  for (const key of ["notify_desktop", "context_compaction_handoff"])
    expect(manifest.userConfig[key].default).toBe(true);
});

/** The reminder of the notice that `send` made, after `ms`. */
async function noticed(io, ms) {
  const started = [];
  await send(io, payload, (notice) => started.push(notice));
  expect(started).toHaveLength(1);
  return { notice: started[0], done: remind(io, started[0], ms) };
}

test("an unanswered permission notice gets exactly one reminder", async () => {
  const io = fakeIo();
  const { notice, done } = await noticed(io, 10);
  expect(notice).toStrictEqual({
    sessionId: "abcdef123456",
    seq: JSON.parse(io.files.get(noticeFile(io, "abcdef123456"))).seq,
  });
  expect(JSON.stringify(notice)).not.toContain("fix the build");
  expect(await done).toBe(true);
  expect(io.ran).toHaveLength(2);
  expect(io.ran[1][2]).toBe("Reminder: Claude Code needs a permission");
  expect(await remind(io, notice, 5)).toBe(false);
  expect(io.ran).toHaveLength(2);
});

test("an answer or a newer notice cancels the reminder", async () => {
  const io = fakeIo();
  const first = await noticed(io, 10);
  await clearNotice(io, payload.session_id);
  expect(await first.done).toBe(false);
  const old = await noticed(io, 10);
  const newer = await noticed(io, 10);
  expect(await old.done).toBe(false);
  expect(await newer.done).toBe(true);
  expect(io.ran).toHaveLength(4);
});

test("no sender means no marker and no reminder", async () => {
  const io = fakeIo({}, () => null);
  const started = [];
  await send(io, payload, (n) => started.push(n));
  expect(started).toHaveLength(0);
  expect(io.files.size).toBe(0);
});

test("the marker exists before the send, so an answer during it cancels", async () => {
  const io = fakeIo();
  const run = io.run;
  io.run = async (argv) => {
    expect(io.files.size).toBe(1);
    await clearNotice(io, payload.session_id);
    return run(argv);
  };
  const started = [];
  await send(io, payload, (n) => started.push(n));
  expect(started).toHaveLength(0);
  expect(io.files.size).toBe(0);
});

test("the child process exits quietly when no notice is pending", () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      path.resolve(import.meta.dirname, "../../hooks/lib/_remind-child.mjs"),
      JSON.stringify({
        notice: { sessionId: "none", seq: "x", title: "t", text: "t" },
        delayMs: 20,
      }),
    ],
    { env: { ...process.env, CLAUDE_PLUGIN_DATA: "/nonexistent/dotclaude" } },
  );
  expect(child.exitCode).toBe(0);
  expect(child.stderr.toString()).toBe("");
});
