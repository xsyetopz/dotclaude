#!/usr/bin/env bun
// UserPromptSubmit: when a prompt the user typed names code symbols that exist
// in the project's CodeGraph index, list where they are, so Claude can query
// CodeGraph for them instead of grepping. It lists locations only; the source
// is one `codegraph_explore` call away. This replaces `codegraph prompt-hook`,
// which injects up to 9 KB of explored source whenever a prompt contains words
// such as "how" or "call", including in task notifications and subagent
// hand-backs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emit, option, projectRoot, run, userTyped } from "../lib/_common.mjs";

const MAX_TOKENS = 4;
const MAX_SYMBOLS = 8;
// A `name.ext` of these kinds is a file reference, not a member access.
const DOC_EXT =
  /\.(md|markdown|txt|rst|json|ya?ml|toml|lock|csv|tsv|log|ini|cfg|conf|env|xml|html?|png|jpe?g|gif|svg|pdf)$/i;

/**
 * Identifier-shaped tokens: camelCase or PascalCase with an inner capital,
 * snake_case, a `name(` call, or the sides of an `a.b` member access. These
 * shapes rarely occur in prose, so a prompt without them is left alone.
 */
export function codeTokens(prompt) {
  const out = new Set();
  const text = prompt.replace(/https?:\/\/\S+/g, " ");
  for (const [w] of text.matchAll(/[A-Za-z_$][\w$]*/g))
    if (/[a-z][A-Z]/.test(w) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(w)) out.add(w);
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\(/g)) out.add(m[1]);
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g))
    if (!DOC_EXT.test(m[0])) {
      out.add(m[1]);
      out.add(m[2]);
    }
  return [...out].filter((t) => t.length > 2).slice(0, MAX_TOKENS);
}

function lookup(token, root) {
  const res = spawnSync(
    "codegraph",
    ["query", "--json", "--limit", "3", "--path", root, token],
    { encoding: "utf8", timeout: 3000 },
  );
  if (res.status !== 0 || !res.stdout) return [];
  try {
    return JSON.parse(res.stdout)
      .map((hit) => hit.node)
      .filter((node) => node?.name === token && node.kind !== "import");
  } catch {
    return [];
  }
}

run((data) => {
  if (!option("codegraph_hint") || !userTyped(data.prompt)) return;
  const root = projectRoot(data);
  if (!fs.existsSync(path.join(root, ".codegraph")) || !Bun.which("codegraph"))
    return;
  const tokens = codeTokens(data.prompt);
  if (!tokens.length) return;
  const seen = new Set();
  const lines = [];
  for (const token of tokens) {
    for (const node of lookup(token, root)) {
      const where = `${node.filePath}:${node.startLine}`;
      if (seen.has(where) || lines.length >= MAX_SYMBOLS) continue;
      seen.add(where);
      lines.push(`- ${node.name} (${node.kind}, ${where})`);
    }
  }
  if (!lines.length) return;
  const names = [...new Set(lines.map((l) => l.slice(2).split(" ")[0]))];
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `<codegraph_symbols>\nIndexed symbols this prompt names:\n${lines.join("\n")}\nFor their source and call paths, call codegraph_explore once with "${names.join(" ")}".\n</codegraph_symbols>`,
    },
  });
});
