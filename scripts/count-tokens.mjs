#!/usr/bin/env bun
// Token cost of the text that dotclaude adds to a session, counted by the
// Anthropic token counting endpoint.
//
//   ANTHROPIC_API_KEY=... bun scripts/count-tokens.mjs [--json]
//
// Opt-in: it calls the API, so it needs `ANTHROPIC_API_KEY` and exits with
// code 1 and a one-line message without it. The count for each text is the
// count of a message that holds the text, minus the count of a one-word
// message alone, so it leaves out the fixed request overhead. Only static
// texts are counted: the output style, the Fable note, the subagent
// conventions and Sonnet scope note, and each agent prompt. The notes that
// depend on the account or the project (plan, attribution) are not.

import fs from "node:fs";
import path from "node:path";
import { FABLE } from "../hooks/lib/_model-notes.mjs";
import {
  GUIDANCE_END,
  GUIDANCE_START,
  SONNET,
} from "../hooks/subagent-start/inject-working-conventions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";
const MODEL = "claude-opus-5-5";
const BASELINE = "Hello";

const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

/** The named texts that dotclaude injects, as `{ name, text }`. */
export function sources(root = ROOT) {
  const read = (rel) => body(fs.readFileSync(path.join(root, rel), "utf8"));
  const items = [
    { name: "output style", text: read("output-styles/dotclaude.md") },
    { name: "SessionStart: Fable note", text: FABLE },
    {
      name: "SubagentStart: conventions",
      // The conventions with no project test command.
      text: GUIDANCE_START + GUIDANCE_END,
    },
    {
      name: "SubagentStart: Sonnet scope note",
      text: SONNET,
    },
  ];
  for (const file of fs.readdirSync(path.join(root, "agents")).sort())
    if (file.endsWith(".md"))
      items.push({
        name: `agent: ${file.slice(0, -3)}`,
        text: read(`agents/${file}`),
      });
  return items;
}

/** Input tokens that the API counts for one user message. */
export async function countTokens(text, { key, fetch: fetchImpl = fetch }) {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok)
    throw new Error(`count_tokens ${res.status}: ${(await res.text()).trim()}`);
  return (await res.json()).input_tokens;
}

/** Rows `{ name, tokens }`: each count minus the baseline message's count. */
export async function buildTable(items, options) {
  const baseline = await countTokens(BASELINE, options);
  const rows = [];
  for (const { name, text } of items)
    rows.push({ name, tokens: (await countTokens(text, options)) - baseline });
  return rows;
}

export function render(rows) {
  const width = Math.max(4, ...rows.map((r) => r.name.length));
  const line = (a, b) => `${a.padEnd(width)}  ${String(b).padStart(6)}`;
  return [
    line("Text", "Tokens"),
    ...rows.map((r) => line(r.name, r.tokens)),
  ].join("\n");
}

if (import.meta.main) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("ANTHROPIC_API_KEY is not set. Set it to count tokens.");
    process.exit(1);
  }
  try {
    const rows = await buildTable(sources(), { key });
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(rows, null, 2)
        : render(rows),
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
