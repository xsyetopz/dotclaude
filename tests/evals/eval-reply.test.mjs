// evals/reply.mjs: the word-count and adverb graders of the final reply.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grade } from "../../evals/oracle.mjs";
import {
  ADVERBS,
  countWords,
  finalReply,
  gradeAdverbs,
  gradeWordCount,
} from "../../evals/reply.mjs";

test("the word-count grader passes at the bound and fails above it", () => {
  const four = "Fixed `slugify()`. Tests pass.";
  expect(countWords(four)).toBe(4);
  expect(gradeWordCount(four, 4)).toMatchObject({
    name: "word-count",
    passed: true,
  });
  expect(gradeWordCount(`${four} Now.`, 4)).toMatchObject({
    passed: false,
    explanation: "5 words, bound 4",
  });
  expect(gradeWordCount("", 4).passed).toBe(true);
});

test("the adverb grader fails on a listed word and passes on clean prose", () => {
  expect(gradeAdverbs("Fixed `slugify()`. The test passes.").passed).toBe(true);
  const bad = gradeAdverbs("I simply fixed it. It is Very clean.");
  expect(bad).toMatchObject({ name: "adverbs", passed: false });
  expect(bad.explanation).toBe("found: simply, very");
});

test("the adverb grader matches whole words and ignores code", () => {
  // "justify" holds "just" but is another word.
  expect(gradeAdverbs("It will justify the change.").passed).toBe(true);
  expect(
    gradeAdverbs("Run `just test` and see:\n```\nvery.mjs\n```").passed,
  ).toBe(true);
  for (const word of ADVERBS)
    expect(gradeAdverbs(`It was ${word} done.`).passed).toBe(false);
});

test("the final reply is the text of the last result event", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-reply-"));
  const trace = path.join(tmp, "trace.jsonl");
  fs.writeFileSync(
    trace,
    [
      JSON.stringify({ type: "assistant", message: {} }),
      JSON.stringify({ type: "result", result: "Fixed it." }),
      "not json",
    ].join("\n"),
  );
  expect(finalReply(trace)).toBe("Fixed it.");
  expect(finalReply(path.join(tmp, "none.jsonl"))).toBeNull();
});

test("the oracle step adds reply graders to a case with a reply.json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-reply-"));
  const caseDir = path.join(tmp, "evals", "t1");
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(
    path.join(caseDir, "reply.json"),
    JSON.stringify({ maxWords: 5, reason: "test" }),
  );
  const run = (name, reply) => {
    const out = path.join(tmp, name, "out");
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(path.join(tmp, name, "home", "cwd"), { recursive: true });
    const trace = path.join(out, "trace.jsonl");
    fs.writeFileSync(trace, JSON.stringify({ type: "result", result: reply }));
    return { passed: true, tracePath: trace, error: null, graders: [] };
  };
  const result = {
    cases: [
      {
        name: "t1",
        dir: "evals/t1",
        arms: {
          with: [run("a", "Fixed. Tests pass."), run("b", "Simply fixed it.")],
        },
      },
    ],
  };
  expect(grade(result, tmp)).toEqual([]);
  const [good, bad] = result.cases[0].arms.with;
  expect(good.graders.map((g) => [g.name, g.passed])).toEqual([
    ["word-count", true],
    ["adverbs", true],
  ]);
  expect(good.passed).toBe(true);
  expect(bad.graders.map((g) => [g.name, g.passed])).toEqual([
    ["word-count", true],
    ["adverbs", false],
  ]);
  expect(bad.passed).toBe(false);
});
