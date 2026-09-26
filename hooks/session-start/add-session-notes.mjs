#!/usr/bin/env bun
// SessionStart: short notes Claude cannot get any other way. Plugin options
// reach hooks as CLAUDE_PLUGIN_OPTION_* but never skill text, so the browser
// and CAPTCHA options are passed on here, only when they differ from their
// defaults. On Fable 5.1 it also adds the model's adjustments to the
// Opus-tuned output style.

import { emit, option, run } from "../lib/_common.mjs";
import { FABLE, isFable } from "../lib/_model-notes.mjs";

function browserNotes() {
  const notes = [];
  if (option("cloakbrowser", false))
    notes.push(
      "use CloakBrowser (the drive-web-browser skill's launcher) as the browser backend rather than agent-browser",
    );
  if (option("cloakbrowser_headless", false))
    notes.push("pass --headless to the CloakBrowser launcher");
  if (!option("cloakbrowser_humanize", true))
    notes.push("pass --no-humanize to the CloakBrowser launcher");
  if (option("captcha_ocr_ddddocr", false))
    notes.push(
      "offline CAPTCHA OCR is enabled, so the recognize-captcha skill may be used when a text CAPTCHA appears despite CloakBrowser",
    );
  return notes;
}

run((data) => {
  const parts = [];
  // A resumed or forked transcript already holds the note from its first
  // session, and a model restored on resume reaches PostModelSwitch.
  const continued = data.source === "resume" || data.source === "fork";
  if (!continued && isFable(data.model)) parts.push(FABLE);
  const browser = browserNotes();
  if (browser.length)
    parts.push(
      `<browser_preferences>The user's dotclaude settings: ${browser.join("; ")}.</browser_preferences>`,
    );
  if (!parts.length) return;
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n"),
    },
  });
});
