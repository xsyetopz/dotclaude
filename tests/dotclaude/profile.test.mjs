// The settings profile, the output style, the agents, and the hooks of the core plugin
// hold the values of `lib/budget.mjs`, and the files that Claude Code reads have the documented shape.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  AGENTS,
  CONTEXT_WINDOW,
  STYLE_MAX_BYTES,
  SUBAGENT_EFFORTS,
} from "../../plugins/dotclaude/lib/budget.mjs";

const ROOT = path.join(import.meta.dirname, "../../plugins/dotclaude");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const frontMatter = (text) =>
  Object.fromEntries(
    text
      .split("\n---")[0]
      .split("\n")
      .slice(1)
      .map((line) => line.match(/^([\w-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^"|"$/g, "")]),
  );

for (const file of [
  "templates/settings.json",
  "templates/managed-settings.json",
]) {
  test(`${file} turns compaction and auto memory off, and sets the window`, () => {
    const s = json(file);
    expect(s.autoCompactEnabled).toBe(false);
    expect(s.autoMemoryEnabled).toBe(false);
    expect(s.env.DISABLE_COMPACT).toBe("1");
    expect(Number(s.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)).toBe(CONTEXT_WINDOW);
    expect(Number(s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)).toBe(CONTEXT_WINDOW);
    expect(s.permissions.disableBypassPermissionsMode).toBe("disable");
    expect(s.sandbox.enabled).toBe(true);
  });
}

test("the profile asks before destructive git and publish commands", () => {
  const { ask, deny } = json("templates/settings.json").permissions;
  for (const rule of [
    "Bash(git push *--force*)",
    "Bash(git reset --hard*)",
    "Bash(npm publish*)",
    "Bash(sudo *)",
  ])
    expect(ask).toContain(rule);
  expect(deny).toContain("Read(~/.ssh/**)");
});

test("the profile sets no effort level, so each model keeps its default", () => {
  const s = json("templates/settings.json");
  expect(s.effortLevel).toBeUndefined();
  expect(s.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
});

test("the profile removes the large tools that it does not use, and the advisor", () => {
  const s = json("templates/settings.json");
  expect(s.enableArtifact).toBe(false);
  expect(s.enableWorkflows).toBe(false);
  for (const tool of ["ScheduleWakeup", "ReportFindings"])
    expect(s.permissions.deny).toContain(tool);
  expect(s.advisorModel).toBeUndefined();
});

test("the output style replaces the coding instructions and fits its bound", () => {
  const text = read("output-styles/dotclaude.md");
  const fm = frontMatter(text);
  expect(fm["force-for-plugin"]).toBe("true");
  expect(fm["keep-coding-instructions"]).toBe("false");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(STYLE_MAX_BYTES);
});

test("the agents are the agents of the budget, with its model, effort, and turns", () => {
  const files = fs.readdirSync(path.join(ROOT, "agents")).sort();
  expect(files).toEqual(
    Object.keys(AGENTS)
      .map((a) => `${a}.md`)
      .sort(),
  );
  for (const [name, [model, effort, turns]] of Object.entries(AGENTS)) {
    const fm = frontMatter(read(`agents/${name}.md`));
    expect(fm.name).toBe(name);
    expect(fm.model).toBe(model);
    expect(fm.effort).toBe(effort ?? undefined);
    expect(Number(fm.maxTurns)).toBe(turns);
    const efforts = SUBAGENT_EFFORTS[model.replace(/^claude-/, "")];
    if (effort) expect(efforts).toContain(effort);
  }
});

test("the hooks are one module, and command hooks only for the auto-mode guard", () => {
  const hooks = json("hooks/hooks.json");
  expect(hooks.modules).toEqual(["./mod.mjs"]);
  expect(Object.keys(hooks.hooks)).toEqual(["PreToolUse"]);
  for (const { matcher, hooks: handlers } of hooks.hooks.PreToolUse)
    for (const h of handlers) {
      expect(h.command).toBe(
        'node "${CLAUDE_PLUGIN_ROOT}/hooks/auto-mode-guard.mjs"',
      );
      if (matcher === "Bash") expect(h.if).toMatch(/^Bash\(.+ \*\)$/);
    }
});

test("the user-invoked skills cannot be invoked by the model", () => {
  for (const skill of ["setup", "handoff"]) {
    const fm = frontMatter(read(`skills/${skill}/SKILL.md`));
    expect(fm["disable-model-invocation"]).toBe("true");
  }
});

test("lib imports only lib, and the other folders import only lib and their own folder", () => {
  const files = (dir) =>
    fs
      .readdirSync(path.join(ROOT, dir), { recursive: true })
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => path.join(dir, f));
  for (const dir of ["lib", "hooks", "status-line", "skills"])
    for (const file of files(dir))
      for (const [, spec] of read(file).matchAll(/from "(\.[^"]+)"/g)) {
        const target = path.relative(
          ROOT,
          path.resolve(ROOT, path.dirname(file), spec),
        );
        const top = target.split(path.sep)[0];
        expect([dir, "lib"], `${file} -> ${spec}`).toContain(
          dir === "lib" ? "lib" : top,
        );
        if (dir === "lib") expect(top, `${file} -> ${spec}`).toBe("lib");
      }
});
