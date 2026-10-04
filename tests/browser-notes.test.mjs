// dotclaude-browser: the session note names the skill, and a non-default
// backend reaches Claude.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPT = path.join(
  import.meta.dirname,
  "../plugins/dotclaude-browser/hooks/add-browser-notes.mjs",
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

test("the note names the browser skill, and the default adds no preference", () => {
  for (const env of [{}, { CLAUDE_PLUGIN_OPTION_BACKEND: "agent-browser" }]) {
    const text = notes(env);
    expect(text).toContain("`dotclaude-browser:drive-web-browser`");
    expect(text).not.toContain("browser_preferences");
  }
});

test("the cloakbrowser backend reaches Claude through the session note", () => {
  const text = notes({ CLAUDE_PLUGIN_OPTION_BACKEND: "CloakBrowser" });
  expect(text).toMatch(/<browser_preferences>.*CloakBrowser/);
});
