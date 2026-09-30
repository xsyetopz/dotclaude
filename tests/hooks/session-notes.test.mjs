// Session start notes: setup warnings and model adjustments.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../../hooks/lib/_budget.mjs";
import { profileStamp } from "../../hooks/lib/_profile.mjs";
import { hook, tmp } from "../support/hooks.mjs";

test("session start warns about incomplete setup and notes a CodeGraph index", () => {
  const start = (env) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      // The launcher notice has its own test in apply-launcher.test.mjs.
      {
        CLAUDE_CODE_EFFORT_LEVEL: "",
        DOTCLAUDE_SYSTEM_PROMPT: "0",
        CLAUDE_PLUGIN_OPTION_SECRET_REDACTION: "false",
        ...env,
      },
    );
  const current = { DOTCLAUDE_SETTINGS_PROFILE: profileStamp() };
  expect(start(current)).toBe(null);
  const missing = start({ DOTCLAUDE_SETTINGS_PROFILE: "" }).systemMessage;
  // Any change to the shipped profile reads as out of date, with no check
  // written per release.
  const stale = start({
    DOTCLAUDE_SETTINGS_PROFILE: "0123456789ab",
  }).systemMessage;
  // Both point to the command that applies the profile, and a missing
  // profile gets a different notice from a stale one.
  expect(missing).toContain("/dotclaude:apply-settings-profile");
  expect(stale).toContain("/dotclaude:apply-settings-profile");
  expect(stale).not.toBe(missing);
  expect(
    start({
      DOTCLAUDE_SETTINGS_PROFILE: "",
      CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false",
    }),
  ).toBe(null);
  expect(
    start({ ...current, CLAUDE_CODE_EFFORT_LEVEL: "max" }).systemMessage,
  ).toMatch(/CLAUDE_CODE_EFFORT_LEVEL=max/);
});

test("session start says when secret redaction has no betterleaks", () => {
  // A PATH that holds bun and nothing else, so betterleaks is missing.
  const bin = tmp("dotclaude-bin-");
  fs.symlinkSync(Bun.which("bun"), path.join(bin, "bun"));
  const start = (option) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      {
        PATH: bin,
        CLAUDE_CODE_EFFORT_LEVEL: "",
        DOTCLAUDE_SYSTEM_PROMPT: "0",
        DOTCLAUDE_SETTINGS_PROFILE: profileStamp(),
        CLAUDE_PLUGIN_OPTION_SECRET_REDACTION: option,
      },
    );
  expect(start("true").systemMessage).toContain("`brew install betterleaks`");
  expect(start("false")).toBe(null);
});

test("session start says when Claude Code is older than the plugin needs", () => {
  // A stand-in for the running binary that prints a given version.
  const claude = (output) => {
    const file = path.join(tmp("dotclaude-claude-"), "claude");
    fs.writeFileSync(file, `#!/bin/sh\necho "${output}"\n`);
    fs.chmodSync(file, 0o755);
    return file;
  };
  const start = (execpath) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      {
        CLAUDE_CODE_EXECPATH: execpath,
        CLAUDE_CODE_EFFORT_LEVEL: "",
        DOTCLAUDE_SYSTEM_PROMPT: "0",
        DOTCLAUDE_SETTINGS_PROFILE: profileStamp(),
        CLAUDE_PLUGIN_OPTION_SECRET_REDACTION: "false",
      },
    );
  const old = start(claude("2.1.283 (Claude Code)")).systemMessage;
  expect(old).toContain("2.1.284 or later");
  expect(old).toContain("`claude update`");
  // Numeric order, not string order: 2.1.1000 is newer than 2.1.284.
  expect(start(claude("2.1.284 (Claude Code)"))).toBe(null);
  expect(start(claude("2.1.1000 (Claude Code)"))).toBe(null);
  expect(start(claude("2.2.0 (Claude Code)"))).toBe(null);
  // An unknown version gives no notice, because the check cannot tell.
  expect(start(claude("not a version"))).toBe(null);
});

test("Fable sessions get the Fable adjustments; Opus sessions get nothing", () => {
  const start = (model, source = "startup") =>
    hook("session-start/add-session-notes.mjs", {
      hook_event_name: "SessionStart",
      source,
      model,
    });
  expect(
    start("claude-fable-5-1").hookSpecificOutput.additionalContext,
  ).toMatch(/fable_adjustments/);
  expect(start("claude-opus-5-5")).toBe(null);
  expect(start("claude-fable-5-1", "resume")).toBe(null);
});

test("a switch to Fable adds its adjustments and a switch away retracts them", () => {
  const sw = (from_model, to_model) =>
    hook("post-model-switch/add-model-notes.mjs", {
      hook_event_name: "PostModelSwitch",
      from_model,
      to_model,
      source: "command",
    });
  const toFable = sw("claude-opus-5-5", "claude-fable-5-1").hookSpecificOutput;
  expect(toFable.hookEventName).toBe("PostModelSwitch");
  expect(toFable.additionalContext).toMatch(/<fable_adjustments>/);
  const away = sw("claude-fable-5-1", "claude-opus-5-5").hookSpecificOutput;
  // The retraction names the block it retracts and does not add it again.
  expect(away.additionalContext).toMatch(/fable_adjustments/);
  expect(away.additionalContext).not.toMatch(/<\/fable_adjustments>/);
  expect(away.additionalContext).not.toBe(toFable.additionalContext);
  expect(sw("claude-sonnet-5-5", "claude-opus-5-5")).toBe(null);
});

function instructionProject() {
  const project = tmp("dotclaude-instructions-");
  const config = tmp("dotclaude-config-");
  execFileSync("git", ["init", "-q", project]);
  const write = (file, text) => {
    const full = path.join(file.startsWith("/") ? "" : project, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  const start = () =>
    hook(
      "session-start/warn-instruction-size.mjs",
      { hook_event_name: "SessionStart", source: "startup", cwd: project },
      { CLAUDE_PROJECT_DIR: project, CLAUDE_CONFIG_DIR: config },
    );
  return { project, config, write, start };
}

test("session start lints each instruction file once, under its original's path", () => {
  const { project, write, start } = instructionProject();
  const lines = (n) => "rule\n".repeat(n);
  write("AGENTS.md", lines(150));
  fs.symlinkSync("AGENTS.md", path.join(project, "CLAUDE.md"));
  fs.symlinkSync("AGENTS.md", path.join(project, "GEMINI.md"));
  // Block-level HTML comments are not sent, so they do not count.
  write("src/CLAUDE.md", `<!--\n${lines(100)}-->\n${lines(150)}`);
  write(".claude/rules/api.md", `---\npaths: ["src/**"]\n---\n${lines(100)}`);
  expect(start()).toBe(null);

  write("AGENTS.md", lines(151));
  write("src/CLAUDE.md", lines(201));
  // A nested name symlinked to the root file is the root file.
  fs.symlinkSync("../AGENTS.md", path.join(project, "src", "AGENTS.md"));
  fs.symlinkSync("missing.md", path.join(project, "src", "GEMINI.md"));
  const message = start().systemMessage;
  // One line per finding: the long nested file, the long root file (once,
  // under its original's name), and the broken symlink. Nothing else, so no
  // hidden-AGENTS.md notice and no startup token total.
  const found = message.split("\n");
  expect(found).toHaveLength(3);
  const lineFor = (label) => {
    const hits = found.filter((l) => l.includes(label));
    expect(hits, label).toHaveLength(1);
    return hits[0];
  };
  const nested = lineFor("`src/CLAUDE.md`");
  expect(nested).toContain("\u001b[31m✖");
  expect(nested).toMatch(/\b201\b/);
  expect(nested).toMatch(new RegExp(`\\b${LIMITS.instructionLines.fail}\\b`));
  const root = lineFor("`AGENTS.md`");
  expect(root).toContain("\u001b[33m⚠");
  expect(root).toMatch(/\b151\b/);
  expect(root).toMatch(new RegExp(`\\b${LIMITS.instructionLines.warn}\\b`));
  const broken = lineFor("`src/GEMINI.md`");
  expect(broken).toContain("\u001b[33m⚠");
  expect(broken).toContain("`missing.md`");
});

test("session start totals the instructions that load at start, imports included", () => {
  const { config, write, start } = instructionProject();
  const words = (n) => "word ".repeat(n);
  // 1,500 words is about 2,000 tokens.
  write(path.join(config, "CLAUDE.md"), words(1500));
  write("CLAUDE.md", "See @docs/style.md, not `@docs/big.md`.\n");
  write("docs/style.md", words(1500));
  write("docs/big.md", words(9000));
  // Files that load later do not count toward the start.
  write("packages/api/CLAUDE.md", words(100).replaceAll(" ", "\n"));
  write(".claude/rules/api.md", `---\npaths: ["api/**"]\n---\n${words(3000)}`);
  const warned = start().systemMessage;
  // The total, then the target it passes, then the largest file and its size.
  expect(warned).toMatch(
    new RegExp(
      `⚠ .*\\b40\\d\\d\\b.*\\b${LIMITS.startupInstructionTokens.warn}\\b.*\`(docs/style\\.md|.*CLAUDE\\.md)\` \\(2000\\)`,
    ),
  );
  expect(warned).not.toContain("✖");

  write(".claude/rules/general.md", words(1000));
  expect(start().systemMessage).toMatch(
    new RegExp(
      `✖ .*\\b5\\d\\d\\d\\b.*\\b${LIMITS.startupInstructionTokens.fail}\\b`,
    ),
  );
});

test("session start flags an AGENTS.md hidden by a CLAUDE.md and deep imports", () => {
  const { write, start } = instructionProject();
  write("CLAUDE.md", "Build with `just`.\n");
  write("AGENTS.md", "Test with `just test`.\n");
  // Two tiny files: the only finding is the AGENTS.md that CLAUDE.md hides.
  const hidden = start().systemMessage.split("\n");
  expect(hidden).toHaveLength(1);
  expect(hidden[0]).toContain("⚠ `AGENTS.md`");
  write("CLAUDE.md", "@AGENTS.md\n");
  expect(start()).toBe(null);

  write("AGENTS.md", "@a1.md\n");
  // CLAUDE.md -> AGENTS.md -> a1 -> a2 -> a3 is four hops, and a4 the fifth.
  for (let i = 1; i <= 3; i += 1) write(`a${i}.md`, `@a${i + 1}.md\n`);
  write("a4.md", "too deep\n");
  // The importing file, then the file past the hop limit, then the limit.
  expect(start().systemMessage).toMatch(
    new RegExp(`✖ \`a3\\.md\`.*\`a4\\.md\`.*\\b${LIMITS.importHops.fail}\\b`),
  );
});

test("session notes restore the attribution that includeGitInstructions: false drops", () => {
  const config = tmp("dotclaude-config-");
  const project = tmp("dotclaude-project-");
  const settings = (dir, s) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(s));
  };
  const notes = (model = "claude-opus-5-5", env = {}, source = "startup") =>
    hook(
      "session-start/add-session-notes.mjs",
      { hook_event_name: "SessionStart", source, model, cwd: project },
      {
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "",
        ...env,
      },
    )?.hookSpecificOutput.additionalContext ?? null;

  // Claude Code sends its own lines while its git instructions are on.
  expect(notes()).toBe(null);

  settings(config, { includeGitInstructions: false });
  const opus = notes();
  expect(opus).toContain(
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
  );
  expect(opus).toContain(
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  );
  expect(notes("claude-fable-5-1")).toContain(
    "Co-Authored-By: Claude <noreply@anthropic.com>",
  );
  expect(notes("claude-haiku-4-5-20251001")).toContain("Claude Haiku 4.5");
  expect(notes("claude-opus-5-5", {}, "resume")).toBe(null);
  expect(
    notes("claude-opus-5-5", { CLAUDE_PLUGIN_OPTION_GIT_ATTRIBUTION: "false" }),
  ).toBe(null);
  // The environment variable wins over the setting, as in Claude Code.
  expect(
    notes("claude-opus-5-5", { CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "0" }),
  ).toBe(null);

  // Project settings override user settings key by key.
  settings(path.join(project, ".claude"), {
    attribution: { commit: "Assisted-by: Claude", pr: "" },
  });
  const custom = notes();
  expect(custom).toContain("Assisted-by: Claude");
  expect(custom).not.toContain("Co-Authored-By");
  // `pr: ""` drops the pull request footer line.
  expect(custom).not.toContain(
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  );

  settings(path.join(project, ".claude"), { includeCoAuthoredBy: false });
  expect(notes()).toBe(null);
});

test("session notes restore the pre-commit skill line that includeGitInstructions: false drops", () => {
  const config = tmp("dotclaude-config-");
  const project = tmp("dotclaude-project-");
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const notes = (env = {}) =>
    hook(
      "session-start/add-session-notes.mjs",
      {
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-opus-5-5",
        cwd: project,
      },
      {
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "",
        CLAUDE_PLUGIN_OPTION_GIT_ATTRIBUTION: "false",
        ...env,
      },
    )?.hookSpecificOutput.additionalContext ?? null;

  write(path.join(project, ".claude/skills/verify/SKILL.md"), "---\n---\n");
  // Claude Code gives the line itself while its git instructions are on.
  expect(notes()).toBe(null);

  write(
    path.join(config, "settings.json"),
    JSON.stringify({ includeGitInstructions: false }),
  );
  const verify = notes();
  expect(verify).toContain("`/verify` right before each `git commit`");
  expect(verify).not.toContain("/simplify");

  // A user command file counts, as `commands_DEPRECATED` does in Claude Code.
  write(path.join(config, "commands/simplify.md"), "Simplify.\n");
  expect(notes()).toContain("`/verify` and `/simplify`");
  expect(notes({ CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "0" })).toBe(null);

  // The built-in `code-review` comes last, only when the setting asks for it.
  write(
    path.join(project, ".claude/settings.json"),
    JSON.stringify({ includeCodeReviewSuggestion: true }),
  );
  expect(notes()).toContain(
    "`/verify`, `/simplify`, and `/code-review medium` right before",
  );

  fs.rmSync(path.join(project, ".claude/skills"), { recursive: true });
  fs.rmSync(path.join(config, "commands"), { recursive: true });
  expect(notes()).toContain("Run `/code-review medium` right before");
  fs.rmSync(path.join(project, ".claude/settings.json"));
  expect(notes()).toBe(null);
});

test("claudeTrailerOff follows attribution.commit and includeCoAuthoredBy", async () => {
  const { claudeTrailerOff } = await import("../../hooks/lib/_attribution.mjs");
  const config = tmp("dotclaude-config-");
  const project = tmp("dotclaude-project-");
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  const set = (s) =>
    fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify(s));
  try {
    expect(claudeTrailerOff(project)).toBe(false);
    set({ attribution: { commit: "" } });
    expect(claudeTrailerOff(project)).toBe(true);
    set({ attribution: { commit: "Assisted-by: Claude" } });
    expect(claudeTrailerOff(project)).toBe(true);
    set({
      attribution: { commit: "Co-Authored-By: Claude <noreply@anthropic.com>" },
    });
    expect(claudeTrailerOff(project)).toBe(false);
    set({ attribution: { pr: "" } });
    expect(claudeTrailerOff(project)).toBe(false);
    set({ includeCoAuthoredBy: false });
    expect(claudeTrailerOff(project)).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
