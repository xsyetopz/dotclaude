// dotclaude-browser: the session note names the skill, and non-default
// browser options reach Claude.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPT = path.join(
  import.meta.dirname,
  "../../plugins/dotclaude-browser/hooks/add-browser-notes.mjs",
);

function notes(env) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("CLAUDE_PLUGIN_OPTION_"),
    ),
  );
  const res = spawnSync("bun", [SCRIPT], {
    input: "{}",
    encoding: "utf8",
    env: { ...clean, ...env },
  });
  return JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
}

test("the note names the browser skill, and defaults add no preferences", () => {
  const text = notes({});
  expect(text).toContain("`dotclaude-browser:drive-web-browser`");
  expect(text).not.toContain("browser_preferences");
});

test("non-default browser options reach Claude through the session note", () => {
  const text = notes({
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER: "true",
    CLAUDE_PLUGIN_OPTION_CLOAKBROWSER_HUMANIZE: "false",
    CLAUDE_PLUGIN_OPTION_CAPTCHA_OCR_DDDDOCR: "true",
  });
  expect(text).toMatch(/<browser_preferences>.*CloakBrowser/);
  expect(text).toMatch(/--no-humanize/);
  expect(text).toMatch(/recognize-captcha/);
  expect(text).not.toMatch(/--headless/);
});
