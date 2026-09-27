// Session start notes: setup warnings, model adjustments, and browser options.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hook, repo } from "../support/hooks.mjs";

test("session start warns about incomplete setup and notes a CodeGraph index", () => {
  const warn = hook(
    "session-start/warn-incomplete-setup.mjs",
    { hook_event_name: "SessionStart", source: "startup" },
    { CLAUDE_CODE_DISABLE_FAST_MODE: "" },
  );
  expect(warn.systemMessage).toMatch(/fast mode/);
  const home = (settings) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-home-"));
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(
      path.join(dir, ".claude", "settings.json"),
      JSON.stringify(settings),
    );
    return dir;
  };
  const current = {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
    CLAUDE_CODE_EFFORT_LEVEL: "",
    CLAUDE_CONFIG_DIR: "",
    HOME: home({ maxEffortLevel: "xhigh" }),
    DOTCLAUDE_MANAGED_DIR: fs.mkdtempSync(
      path.join(os.tmpdir(), "dotclaude-managed-"),
    ),
  };
  const start = (env) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      { ...current, ...env },
    );
  expect(start({})).toBe(null);
  expect(start({ ANTHROPIC_DEFAULT_HAIKU_MODEL: "" }).systemMessage).toMatch(
    /out of date/,
  );
  expect(start({ CLAUDE_CODE_EFFORT_LEVEL: "max" }).systemMessage).toMatch(
    /CLAUDE_CODE_EFFORT_LEVEL=max/,
  );
  const oldProfile = home({ model: "opus" });
  expect(start({ HOME: oldProfile }).systemMessage).toMatch(
    /out of date: the effort cap \(maxEffortLevel\)/,
  );
  const both = start({
    HOME: oldProfile,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
  }).systemMessage;
  expect(both.match(/out of date/g).length, both).toBe(1);
  // The cap applied at local scope, or locked in a managed drop-in, counts too.
  const local = path.join(repo, ".claude", "settings.local.json");
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify({ maxEffortLevel: "xhigh" }));
  expect(start({ HOME: oldProfile })).toBe(null);
  fs.rmSync(local);
  const managed = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-managed-"));
  fs.mkdirSync(path.join(managed, "managed-settings.d"));
  fs.writeFileSync(
    path.join(managed, "managed-settings.d", "50-dotclaude.json"),
    JSON.stringify({ maxEffortLevel: "xhigh" }),
  );
  expect(start({ HOME: oldProfile, DOTCLAUDE_MANAGED_DIR: managed })).toBe(
    null,
  );
  fs.mkdirSync(path.join(repo, ".codegraph"), { recursive: true });
  const note = hook("session-start/note-codegraph-index.mjs", {
    hook_event_name: "SessionStart",
    source: "startup",
  });
  expect(note.hookSpecificOutput.additionalContext).toMatch(/CodeGraph/);
  expect(
    hook(
      "session-start/note-codegraph-index.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      { CLAUDE_PLUGIN_OPTION_CODEGRAPH_HINT: "false" },
    ),
  ).toBe(null);
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
