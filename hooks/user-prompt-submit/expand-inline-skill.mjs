#!/usr/bin/env bun
// UserPromptSubmit: expand a `/dotclaude:<skill>` typed in the middle of a
// message. Claude Code expands a slash command only at the start of a message;
// elsewhere it reaches Claude as plain text. The skill's body is added as
// context with $ARGUMENTS set to the rest of the message. A skill that forks a
// subagent or runs `!` commands cannot be inlined, so Claude is told to run it
// through the Skill tool instead.

import fs from "node:fs";
import path from "node:path";
import { emit, run, userTyped } from "../lib/_common.mjs";

const MAX_CONTEXT = 9500;
const TOKEN = /(^|\s)\/dotclaude:([a-z0-9-]+)(?![\w:/-])/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const FORK = /^context:\s*["']?fork["']?\s*$/m;
const USER_ONLY = /^disable-model-invocation:\s*true\s*$/m;
// `!`command`` lines and ```! blocks, which Claude Code runs before the skill
// reaches Claude; a quoted `!` in prose is not one.
const DYNAMIC = /(^|\s)!`[^`\n]+`|^```!/m;

function pluginRoot() {
  return (
    process.env.CLAUDE_PLUGIN_ROOT || path.resolve(import.meta.dirname, "../..")
  );
}

function findSkill(text) {
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index + m[1].length;
    if (start === 0) continue;
    const file = path.join(pluginRoot(), "skills", m[2], "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const end = start + m[0].length - m[1].length;
    const args =
      `${text.slice(0, start).trimEnd()} ${text.slice(end).trimStart()}`.trim();
    return { name: m[2], file, args };
  }
  return null;
}

function wrap(name, body, file) {
  const open = `<skill name="dotclaude:${name}">\n`;
  const close = "\n</skill>";
  if (open.length + body.length + close.length <= MAX_CONTEXT)
    return open + body + close;
  const note = `\n[Truncated at ${MAX_CONTEXT} characters; read the rest from ${file}.]`;
  const room = MAX_CONTEXT - open.length - note.length - close.length;
  return open + body.slice(0, room) + note + close;
}

run((data) => {
  if (!userTyped(data.prompt)) return;
  const skill = findSkill(data.prompt.trimStart());
  if (!skill) return;
  const { name, file, args } = skill;
  const source = fs.readFileSync(file, "utf8");
  const front = source.match(FRONTMATTER);
  const frontmatter = front?.[1] ?? "";
  let body = front ? source.slice(front[0].length) : source;
  let context;
  if (FORK.test(frontmatter) || DYNAMIC.test(body)) {
    // A user-only skill refuses the Skill tool, so only the user can start it,
    // and only from the start of a message.
    context = USER_ONLY.test(frontmatter)
      ? `The user's message names /dotclaude:${name}, which runs only when a message starts with it. Ask the user to send it again beginning with /dotclaude:${name}.`
      : `The user's message invokes /dotclaude:${name}. Run it by calling the Skill tool with skill "dotclaude:${name}" and args ${JSON.stringify(args)}.`;
  } else {
    body = body
      .replace(/\$\{CLAUDE_SKILL_DIR\}/g, () => path.dirname(file))
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () => pluginRoot())
      .split("$ARGUMENTS")
      .join(args)
      .trim();
    context = wrap(name, body, file);
  }
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context,
    },
  });
});
