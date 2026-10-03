// The model, agent, and attribution helpers read the host only through the
// `io` or `env` object that the caller gives.

import { expect, test } from "bun:test";
import { definition } from "../../hooks/lib/_agents.mjs";
import {
  attributionNote,
  claudeTrailerOff,
  preCommitNote,
} from "../../hooks/lib/_attribution.mjs";
import { allowed, effortLevels, family } from "../../hooks/lib/_models.mjs";

/** An io over an in-memory file map. */
const io = (files = {}, env = {}) => ({
  platform: "posix",
  env,
  home: "/home/u",
  tmp: "/tmp",
  cwd: "/work",
  pluginRoot: "/plugin",
  fs: {
    read: async (p) => {
      if (!(p in files)) throw new Error("missing");
      return files[p];
    },
    exists: async (p) => p in files,
  },
});

test("an alias mapped in the given env is checked as the model it maps to", () => {
  const list = ["claude-sonnet-5-5"];
  const env = { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-sonnet-5-5" };
  expect(allowed("opus", list, {})).toBe(false);
  expect(allowed("opus", list, env)).toBe(true);
  expect(allowed("sonnet", list, {})).toBe(true);
  expect(family("opus", env)).toBe("sonnet");
  expect(family("opus", {})).toBe("opus");
  expect(effortLevels("sonnet", {})).toStrictEqual(["low", "medium", "high"]);
  expect(allowed("opusplan", ["opus", "sonnet"], {})).toBe(true);
});

test("definition reads the agent file under io.pluginRoot", async () => {
  const text =
    "---\nname: x\nmodel: claude-sonnet-5-5\neffort: high\nmaxTurns: 40\n---\nBody\n";
  const host = io({ "/plugin/agents/x.md": text });
  expect(await definition(host, "dotclaude:x")).toStrictEqual({
    maxTurns: 40,
    model: "claude-sonnet-5-5",
    effort: "high",
    readOnly: false,
  });
  expect(await definition(host, "dotclaude:none")).toBe(undefined);
  expect(await definition(host, "other:x")).toBe(undefined);
});

test("attribution settings come from CLAUDE_CONFIG_DIR or the home folder", async () => {
  const set = (s) => ({ "/home/u/.claude/settings.json": JSON.stringify(s) });
  expect(await claudeTrailerOff(io(), "/p")).toBe(false);
  expect(
    await claudeTrailerOff(io(set({ includeCoAuthoredBy: false })), "/p"),
  ).toBe(true);
  const files = { "/cfg/settings.json": '{"attribution":{"commit":""}}' };
  expect(
    await claudeTrailerOff(io(files, { CLAUDE_CONFIG_DIR: "/cfg" }), "/p"),
  ).toBe(true);
  expect(await claudeTrailerOff(io(files), "/p")).toBe(false);
});

test("the git notes follow the env and the skills that exist", async () => {
  const files = {
    "/home/u/.claude/settings.json": '{"includeGitInstructions":false}',
    "/p/.claude/skills/verify/SKILL.md": "",
  };
  expect(await attributionNote(io(files), "claude-opus-5-5", "/p")).toContain(
    "Co-Authored-By: Claude Opus 5.5",
  );
  expect(await preCommitNote(io(files), "/p")).toContain("`/verify`");
  const off = { CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "0" };
  expect(await attributionNote(io(files, off), "claude-opus-5-5", "/p")).toBe(
    null,
  );
  expect(await preCommitNote(io(files, off), "/p")).toBe(null);
});
