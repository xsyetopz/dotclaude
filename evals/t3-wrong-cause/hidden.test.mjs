import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "./csv.mjs";
import { averageScore } from "./report.mjs";

test("hidden: rows with and without a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n3,4"), [
    { a: "1", b: "2" },
    { a: "3", b: "4" },
  ]);
  assert.deepEqual(parseCsv("a,b\n1,2\n3,4\n"), [
    { a: "1", b: "2" },
    { a: "3", b: "4" },
  ]);
  assert.deepEqual(parseCsv("a,b\n"), []);
  assert.equal(averageScore("name,score\nana,4\nbo,8\ncy,9\n"), 7);
});
