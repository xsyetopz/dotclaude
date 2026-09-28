// Session start notes: setup warnings, model adjustments, and browser options.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
  expect(start({ DOTCLAUDE_SETTINGS_PROFILE: "" }).systemMessage).toMatch(
    /not applied yet/,
  );
  // Any change to the shipped profile reads as out of date, with no check
  // written per release.
  expect(
    start({ DOTCLAUDE_SETTINGS_PROFILE: "0123456789ab" }).systemMessage,
  ).toMatch(/out of date: this version of the plugin changed it/);
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

test("session start says when secret redaction has no gitleaks", () => {
  // A PATH that holds bun and nothing else, so gitleaks is missing.
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
  expect(start("true").systemMessage).toMatch(
    /gitleaks is not on PATH.*`brew install gitleaks`/,
  );
  expect(start("false")).toBe(null);
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
  expect(away.additionalContext).toMatch(/no longer apply/);
  expect(away.additionalContext).not.toMatch(/<\/fable_adjustments>/);
  expect(sw("claude-sonnet-5", "claude-opus-5-5")).toBe(null);
});

test("non-default browser options reach Claude through the session notes", () => {
  const notes = (env) =>
    hook(
      "session-start/add-session-notes.mjs",
      {
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-opus-5-5",
      },
      env,
    );
  expect(notes({}), "defaults add nothing").toBe(null);
  const text = notes({
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER: "true",
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER_HUMANIZE: "false",
    CLAUDE_PLUGIN_OPTION_CAPTCHA_OCR_DDDDOCR: "true",
  }).hookSpecificOutput.additionalContext;
  expect(text).toMatch(/CloakBrowser/);
  expect(text).toMatch(/--no-humanize/);
  expect(text).toMatch(/recognize-captcha/);
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
  expect(message).toContain(
    "\u001b[31m✖ `src/CLAUDE.md` has 201 lines, over the 200-line limit for one instruction file.",
  );
  expect(message).toContain(
    "\u001b[33m⚠ `AGENTS.md` has 151 lines, over the 150-line target for one instruction file.",
  );
  expect(message).toContain(
    "`src/GEMINI.md` is a symlink to `missing.md`, which does not exist, so it loads nothing.",
  );
  expect(message.match(/AGENTS\.md` has/g)).toHaveLength(1);
  expect(message).not.toContain("CLAUDE.md` has 151");
  expect(message).not.toContain("is not read");
  expect(message).not.toContain("tokens");
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
  expect(warned).toMatch(
    /⚠ Instructions loaded at session start come to about 40\d\d tokens, over the 3000-token target\. Largest: `(docs\/style\.md|.*CLAUDE\.md)` \(2000\)/,
  );

  write(".claude/rules/general.md", words(1000));
  expect(start().systemMessage).toMatch(
    /✖ Instructions loaded at session start come to about 5\d\d\d tokens, over the 5000-token limit/,
  );
});

test("session start flags an AGENTS.md hidden by a CLAUDE.md and deep imports", () => {
  const { write, start } = instructionProject();
  write("CLAUDE.md", "Build with `just`.\n");
  write("AGENTS.md", "Test with `just test`.\n");
  expect(start().systemMessage).toContain(
    "`AGENTS.md` is not read, because a CLAUDE.md loads in its place.",
  );
  write("CLAUDE.md", "@AGENTS.md\n");
  expect(start()).toBe(null);

  write("AGENTS.md", "@a1.md\n");
  // CLAUDE.md -> AGENTS.md -> a1 -> a2 -> a3 is four hops, and a4 the fifth.
  for (let i = 1; i <= 3; i += 1) write(`a${i}.md`, `@a${i + 1}.md\n`);
  write("a4.md", "too deep\n");
  expect(start().systemMessage).toContain(
    "✖ `a3.md` imports `a4.md` more than 4 `@` hops from its CLAUDE.md, so Claude Code does not load it.",
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
  expect(custom).not.toContain("pull request");

  settings(path.join(project, ".claude"), { includeCoAuthoredBy: false });
  expect(notes()).toBe(null);
});
