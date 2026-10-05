import { expect, test } from "bun:test";
import {
  checkCommands,
  lastTurn,
  verifyReason,
} from "../hooks/lib/_verify.mjs";

const line = (type, content, extra = {}) =>
  JSON.stringify({ type, message: { content }, ...extra });
const use = (name, input = {}) =>
  line("assistant", [{ type: "tool_use", name, input }]);
const prompt = line("user", "do it");
const result = line("user", [{ type: "tool_result", content: "ok" }]);

const COMMANDS = checkCommands({
  justfile:
    "default:\n  @just --list\n\ncheck: lint test\n\nsandbox *args:\n  x\n",
  packageJson: '{"scripts":{"lint":"biome","dev":"x"}}',
  makefile: "all: build\nbuild:\n\tcc\n",
});

test("check commands come from justfile, package.json, and Makefile", () => {
  expect(COMMANDS).toContain("just check");
  expect(COMMANDS).toContain("bun run lint");
  expect(COMMANDS).toContain("make build");
  expect(COMMANDS).toContain("cargo test");
  expect(COMMANDS).not.toContain("just sandbox");
  expect(COMMANDS).not.toContain("bun run dev");
});

const reasonFor = (...lines) =>
  verifyReason(lastTurn(lines.join("\n")), COMMANDS);

test("an edit with no later check sends Claude back and names the commands", () => {
  const reason = reasonFor(prompt, use("Edit"), result);
  expect(reason).toContain("`just check`");
});

test("a check after the last edit, or no edit, passes", () => {
  expect(
    reasonFor(prompt, use("Edit"), use("Bash", { command: "just check" })),
  ).toBeUndefined();
  expect(reasonFor(prompt, use("Bash", { command: "ls" }))).toBeUndefined();
});

test("a check before the last edit does not count", () => {
  expect(
    reasonFor(
      prompt,
      use("Bash", { command: "cd x && bun test" }),
      use("Write"),
    ),
  ).toBeDefined();
});

test("a word match does not accept a longer name", () => {
  expect(
    reasonFor(prompt, use("Edit"), use("Bash", { command: "just checkout" })),
  ).toBeDefined();
});

test("an edit outside the project root, such as a plan file, does not count", () => {
  const turn = (file) =>
    lastTurn([prompt, use("Write", { file_path: file })].join("\n"));
  expect(
    verifyReason(turn("/home/u/.claude/plans/p.md"), COMMANDS, "/repo"),
  ).toBeUndefined();
  expect(
    verifyReason(turn("/repo/src/a.mjs"), COMMANDS, "/repo"),
  ).toBeDefined();
  expect(
    verifyReason(turn("/repo-two/a.mjs"), COMMANDS, "/repo"),
  ).toBeUndefined();
});

test("a denied or failed edit does not count", () => {
  const edit = (id) =>
    line("assistant", [{ type: "tool_use", id, name: "Write", input: {} }]);
  const error = (id) =>
    line("user", [
      { type: "tool_result", tool_use_id: id, is_error: true, content: "x" },
    ]);
  expect(reasonFor(prompt, edit("t1"), error("t1"))).toBeUndefined();
  expect(
    reasonFor(prompt, edit("t1"), result, edit("t2"), error("t2")),
  ).toBeDefined();
});

test("only the last turn counts", () => {
  expect(
    reasonFor(prompt, use("Edit"), line("user", "next"), use("Read")),
  ).toBeUndefined();
});

test("the Stop hook blocks once, and not when stop_hook_active is set", () => {
  const dir = import.meta.dir;
  const file = `${require("node:os").tmpdir()}/verify-${process.pid}.jsonl`;
  require("node:fs").writeFileSync(file, [prompt, use("Edit")].join("\n"));
  const run = (extra) =>
    Bun.spawnSync(["bun", `${dir}/../hooks/stop/verify.mjs`], {
      stdin: new TextEncoder().encode(
        JSON.stringify({ transcript_path: file, cwd: `${dir}/..`, ...extra }),
      ),
      env: { ...process.env, CLAUDE_PROJECT_DIR: `${dir}/..` },
    }).stdout.toString();
  expect(JSON.parse(run({})).decision).toBe("block");
  expect(run({ stop_hook_active: true })).toBe("");
  require("node:fs").rmSync(file);
});
