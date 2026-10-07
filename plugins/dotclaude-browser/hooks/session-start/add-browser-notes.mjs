#!/usr/bin/env bun
// SessionStart: tells Claude to load the `drive-web-browser` skill before a
// browser command. Plugin options reach hooks as CLAUDE_PLUGIN_OPTION_* but
// never skill text, so a non-default `backend` is passed on here.

// Rule 13.1 of the dotclaude operating spec.
// A test compares the tag and the rule with `plugins/dotclaude/lib/terms.mjs`, which this plugin cannot import.
export const LOAD_SKILL =
  "13.1 MUST load the `dotclaude-browser:drive-web-browser` skill before the first browser command of a task in a web browser (agent-browser, CloakBrowser, screenshots, forms).\nReason: The skill has the commands and the rules for the browser.";

const CLOAKBROWSER_FACT =
  "The user chose CloakBrowser as the browser backend in the settings of dotclaude-browser.";
const CLOAKBROWSER_STEP =
  "Use CloakBrowser, and not plain `agent-browser`, with the CloakBrowser section of the skill.";

export const SECTION_TAG =
  '<dotclaude_spec section="13" title="Web browser (dotclaude-browser)">';

export function sessionContext(backend) {
  const choice = (backend ?? "").trim().toLowerCase();
  const text =
    choice === "cloakbrowser"
      ? `${LOAD_SKILL}\n<browser_preferences>${CLOAKBROWSER_FACT}</browser_preferences>\n${CLOAKBROWSER_STEP}`
      : LOAD_SKILL;
  return `${SECTION_TAG}\n${text}\n</dotclaude_spec>`;
}

if (import.meta.main) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: sessionContext(
          process.env.CLAUDE_PLUGIN_OPTION_BACKEND,
        ),
      },
    }),
  );
}
