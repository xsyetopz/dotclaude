#!/usr/bin/env bun
// UserPromptSubmit: run a `/dotclaude:<skill>` typed in the middle of a
// message. Claude Code expands a slash command only at the start of a message,
// and a hook cannot rewrite the prompt, so Claude is told to load the skill
// through the Skill tool with the rest of the message as its arguments. The
// Skill tool loads it the way Claude Code would (forks, `!` commands, model
// and tool settings). A user-only skill refuses the Skill tool, so Claude asks
// the user to send it again at the start of a message.

import fs from "node:fs";
import path from "node:path";
import { emit, run, userTyped } from "../lib/_common.mjs";

const TOKEN = /(^|\s)\/dotclaude:([a-z0-9-]+)(?![\w:/-])/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const USER_ONLY = /^disable-model-invocation:\s*true\s*$/m;

// Pasted blocks and `>` quote lines only mention a skill; a name there, such
// as one quoted back from Claude's own reply, is not an invocation.
const QUOTED =
  /<pasted_content id="([^"]*)">[\s\S]*?<\/pasted_content id="\1">|^[ \t]*>.*$/gm;

function pluginRoot() {
  return (
    process.env.CLAUDE_PLUGIN_ROOT || path.resolve(import.meta.dirname, "../..")
  );
}

function findSkill(text) {
  // Blank quoted spans with spaces so match offsets still index `text`.
  const typed = text.replace(QUOTED, (q) => q.replace(/[^\n]/g, " "));
  for (const m of typed.matchAll(TOKEN)) {
    const start = m.index + m[1].length;
    if (start === 0) continue;
    const file = path.join(pluginRoot(), "skills", m[2], "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const end = start + m[0].length - m[1].length;
    const args =
      `${text.slice(0, start).trimEnd()} ${text.slice(end).trimStart()}`.trim();
    return { name: m[2], file, args };
  }
  return undefined;
}

run((data) => {
  if (!userTyped(data.prompt)) return;
  const skill = findSkill(data.prompt.trimStart());
  if (!skill) return;
  const { name, file, args } = skill;
  const frontmatter =
    fs.readFileSync(file, "utf8").match(FRONTMATTER)?.[1] ?? "";
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: USER_ONLY.test(frontmatter)
        ? `The user's message names /dotclaude:${name}, which runs only when a message starts with it. Ask the user to send it again beginning with /dotclaude:${name}.`
        : `The user's message invokes /dotclaude:${name}. Run it now by calling the Skill tool with skill "dotclaude:${name}" and args ${JSON.stringify(args)}.`,
    },
  });
});
