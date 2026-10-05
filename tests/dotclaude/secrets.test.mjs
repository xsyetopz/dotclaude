import { expect, test } from "bun:test";
import {
  findingsOf,
  redact,
  strings,
} from "../../plugins/dotclaude/lib/guards/secrets.mjs";

test("redact replaces each secret in nested strings and keeps the shape", () => {
  const { value, count } = redact(
    { a: ["key=abc123", 5], b: { c: "abc123 and abc123xyz" } },
    [
      { rule: "r1", secret: "abc123" },
      { rule: "r2", secret: "abc123xyz" },
    ],
  );
  expect(count).toBe(3);
  expect(value).toEqual({
    a: ["key=[REDACTED:r1]", 5],
    b: { c: "[REDACTED:r1] and [REDACTED:r2]" },
  });
});

test("strings lists every string of a value", () => {
  expect(strings({ a: "x", b: ["y", { c: "z" }], d: 1 })).toEqual([
    "x",
    "y",
    "z",
  ]);
});

test("findingsOf reads a report and rejects bad JSON", () => {
  expect(findingsOf('[{"RuleID":"r","Secret":"s"},{"RuleID":"q"}]')).toEqual([
    { rule: "r", secret: "s" },
  ]);
  expect(findingsOf("")).toEqual([]);
  expect(findingsOf("{")).toBeNull();
});
