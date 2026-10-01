#!/usr/bin/env bun
// PostToolUseFailure(Edit): when `old_string` matches no text in the file,
// give Claude the closest lines with their line numbers, so that the next try
// copies the real text instead of guessing again. The idea comes from the
// `edit_gate.py` hook in DensePack (MIT). This is a new implementation.

import fs from "node:fs";
import path from "node:path";
import { emit, run } from "../lib/_common.mjs";

const MISS = "String to replace not found";
const MAX_BYTES = 1_000_000;
const MAX_LINES = 20_000;
// Lines of `old_string` that take part in the score. More lines cost more
// time and seldom move the best window.
const SCORED_LINES = 8;
const SHOWN_LINES = 20;
const MIN_SCORE = 0.6;
const MAX_LINE_CHARS = 200;

const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

function bigrams(s) {
  const counts = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const pair = s.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Dice similarity of two bigram multisets, from 0 to 1. */
function dice(a, b, aText, bText) {
  if (aText === bText) return 1;
  if (aText.length < 2 || bText.length < 2) return 0;
  let shared = 0;
  for (const [pair, n] of a) shared += Math.min(n, b.get(pair) ?? 0);
  return (2 * shared) / (aText.length - 1 + (bText.length - 1));
}

/** The best start line (0-based) for `wanted`, and its mean line score. */
function closest(lines, wanted) {
  const want = wanted.map((l) => ({ text: l, grams: bigrams(l) }));
  const have = lines.map((l) => {
    const text = norm(l);
    return { text, grams: bigrams(text) };
  });
  let best = { start: -1, score: 0 };
  for (let start = 0; start + want.length <= have.length; start += 1) {
    let sum = 0;
    for (let k = 0; k < want.length; k += 1) {
      const h = have[start + k];
      sum += dice(want[k].grams, h.grams, want[k].text, h.text);
    }
    const score = sum / want.length;
    if (score > best.score) best = { start, score };
  }
  return best;
}

run((data) => {
  const input = data.tool_input ?? {};
  if (data.tool_name !== "Edit" || !String(data.error ?? "").includes(MISS))
    return;
  if (typeof input.old_string !== "string" || !input.file_path) return;
  let text;
  try {
    if (fs.statSync(input.file_path).size > MAX_BYTES) return;
    text = fs.readFileSync(input.file_path, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n");
  if (lines.length > MAX_LINES) return;
  // Blank lines carry no signal, so the score starts at the first line with
  // text and the shown window starts there too.
  const old = input.old_string.split("\n");
  const first = old.findIndex((l) => l.trim());
  if (first < 0) return;
  const wanted = old.slice(first, first + SCORED_LINES).map(norm);
  const { start, score } = closest(lines, wanted);
  if (start < 0 || score < MIN_SCORE) return;
  const count = Math.min(old.length - first, SHOWN_LINES, lines.length - start);
  const shown = lines
    .slice(start, start + count)
    .map((l, i) => {
      const line =
        l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)} [...]` : l;
      return `${start + i + 1}\t${line}`;
    })
    .join("\n");
  const range =
    count > 1 ? `lines ${start + 1}-${start + count}` : `line ${start + 1}`;
  emit({
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: `\`old_string\` matches no text in \`${path.basename(input.file_path)}\`. The closest text is at ${range}:\n\n${shown}\n\nCopy \`old_string\` exactly from these lines, without the line numbers, and run the edit again.`,
    },
  });
});
