// Graders for the final reply of a run: a word count and an adverb check.
//
// `claude plugin eval` has no grader for either, so `evals/oracle.mjs` runs
// them after the eval. A case opts in with a `reply.json` file:
//
//   { "maxWords": 80, "reason": "why this bound suits the case" }
//
// The reply is the `result` text of the run's stream-json trace.

import fs from "node:fs";

/**
 * Intensifiers and "-ly" adverbs that the reply must not use. They add
 * weight, not facts. This is the only copy of the list.
 */
export const ADVERBS = [
  "actually",
  "basically",
  "clearly",
  "completely",
  "easily",
  "essentially",
  "fully",
  "just",
  "quietly",
  "really",
  "simply",
  "silently",
  "successfully",
  "totally",
  "very",
];

const ADVERB_PATTERN = new RegExp(`\\b(?:${ADVERBS.join("|")})\\b`, "gi");

/** The text of the last `result` event of a stream-json trace, or null. */
export function finalReply(traceFile) {
  let text;
  try {
    text = fs.readFileSync(traceFile, "utf8");
  } catch {
    return null;
  }
  let reply = null;
  for (const line of text.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result" && typeof event.result === "string")
      reply = event.result;
  }
  return reply;
}

/** Words of `text`: runs of characters between whitespace. */
export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Passes when the reply has at most `maxWords` words. */
export function gradeWordCount(reply, maxWords) {
  const words = countWords(reply);
  return {
    name: "word-count",
    weight: 1,
    scored: true,
    passed: words <= maxWords,
    explanation: `${words} words, bound ${maxWords}`,
  };
}

/** Fails when the reply has a word of `ADVERBS`. Code spans are ignored. */
export function gradeAdverbs(reply) {
  const prose = reply.replace(/```[\s\S]*?```|`[^`\n]*`/g, " ");
  const found = [
    ...new Set(
      [...prose.matchAll(ADVERB_PATTERN)].map((m) => m[0].toLowerCase()),
    ),
  ];
  return {
    name: "adverbs",
    weight: 1,
    scored: true,
    passed: found.length === 0,
    explanation: found.length ? `found: ${found.join(", ")}` : "no adverbs",
  };
}
