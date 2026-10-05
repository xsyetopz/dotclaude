#!/usr/bin/env bun
// SessionStart: tells Claude to load the `drive-web-browser` skill before a
// browser command. Plugin options reach hooks as CLAUDE_PLUGIN_OPTION_* but
// never skill text, so a non-default `backend` is passed on here.

const LOAD_SKILL =
  "For anything in a web browser (agent-browser, CloakBrowser, screenshots, forms), load the `dotclaude-browser:drive-web-browser` skill before the first browser command.";

const CLOAKBROWSER_NOTE =
  "Use CloakBrowser as the browser backend, not plain `agent-browser`. Follow the skill's CloakBrowser section.";

// Clause 9 of the dotclaude Terms of Use. A test compares the tag with
// `hooks/lib/_terms.mjs`, which this plugin cannot import.
export const CLAUSE_TAG =
  '<dotclaude_terms clause="9" title="Web browser (dotclaude-browser)">';

export function sessionContext(backend) {
  const choice = (backend ?? "").trim().toLowerCase();
  const text =
    choice === "cloakbrowser"
      ? `${LOAD_SKILL}\n<browser_preferences>This preference comes from the user's dotclaude-browser settings. ${CLOAKBROWSER_NOTE}</browser_preferences>`
      : LOAD_SKILL;
  return `${CLAUSE_TAG}\n${text}\n</dotclaude_terms>`;
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
