#!/usr/bin/env bun
// SessionStart: tells Claude to load the `drive-web-browser` skill before a
// browser command. Without that line, Claude drove browser CLIs from Bash
// without the skill. Plugin options reach hooks as CLAUDE_PLUGIN_OPTION_* but
// never skill text, so the browser and CAPTCHA options that differ from their
// defaults are passed on here too.

const FALSE = new Set(["0", "false", "no", "off", ""]);

function option(key, fallback) {
  const raw = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (raw === undefined) return fallback;
  return !FALSE.has(raw.trim().toLowerCase());
}

function browserNotes() {
  const notes = [];
  if (option("cloakbrowser", false))
    notes.push(
      "Use CloakBrowser (the `drive-web-browser` skill's launcher) as the browser backend, not `agent-browser`.",
    );
  if (option("cloakbrowser_headless", false))
    notes.push("Pass `--headless` to the CloakBrowser launcher.");
  if (!option("cloakbrowser_humanize", true))
    notes.push("Pass `--no-humanize` to the CloakBrowser launcher.");
  if (option("captcha_ocr_ddddocr", false))
    notes.push(
      "Offline CAPTCHA OCR is on, so you may use the `recognize-captcha` skill when a text CAPTCHA appears despite CloakBrowser.",
    );
  return notes;
}

const LOAD_SKILL =
  "For anything in a web browser (agent-browser, CloakBrowser, screenshots, forms), load the `dotclaude-browser:drive-web-browser` skill before the first browser command.";

if (import.meta.main) {
  const notes = browserNotes();
  const preferences = notes.length
    ? `\n<browser_preferences>These preferences come from the user's dotclaude-browser settings. ${notes.join(" ")}</browser_preferences>`
    : "";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `${LOAD_SKILL}${preferences}`,
      },
    }),
  );
}
