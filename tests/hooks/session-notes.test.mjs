// Session start notes: setup warnings, model adjustments, and browser options.

import { expect, test } from "bun:test";
import { profileStamp } from "../../hooks/lib/_profile.mjs";
import { hook } from "../support/hooks.mjs";

test("session start warns about incomplete setup and notes a CodeGraph index", () => {
  const start = (env) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      { CLAUDE_CODE_EFFORT_LEVEL: "", ...env },
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
