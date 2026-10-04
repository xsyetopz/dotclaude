import { expect, test } from "bun:test";
import { editReasons } from "../hooks/lib/_edit-rules.mjs";

test("a settings file asks", () => {
  expect(
    editReasons("Edit", { file_path: "/p/.claude/settings.json" }),
  ).toHaveLength(1);
});

test("a lockfile and build output ask", () => {
  expect(
    editReasons("Write", { file_path: "/p/bun.lock", content: "" }),
  ).toHaveLength(1);
  expect(
    editReasons("Write", { file_path: "/p/dist/a.js", content: "" }),
  ).toHaveLength(1);
});

test("an edit that removes an assertion from a test asks", () => {
  const out = editReasons("Edit", {
    file_path: "/p/tests/a.test.mjs",
    old_string: "expect(a).toBe(1);\nexpect(b).toBe(2);",
    new_string: "expect(a).toBe(1);",
  });
  expect(out[0]).toContain("removes 1 assertion");
});

test("an edit that adds a skip marker asks", () => {
  const out = editReasons("Edit", {
    file_path: "/p/a.test.js",
    old_string: "test('x', f)",
    new_string: "test.skip('x', f)",
  });
  expect(out[0]).toContain("skip");
});

test("a Write over a test compares with the existing text", () => {
  const input = { file_path: "/p/a_test.go", content: "package a" };
  expect(editReasons("Write", input, "t.Fatal(1)")).toHaveLength(1);
  expect(editReasons("Write", input, null)).toHaveLength(0);
});

test("a normal source edit and a test edit that keeps its assertions pass", () => {
  expect(
    editReasons("Edit", {
      file_path: "/p/src/a.mjs",
      old_string: "a",
      new_string: "b",
    }),
  ).toEqual([]);
  expect(
    editReasons("Edit", {
      file_path: "/p/tests/a.test.mjs",
      old_string: "expect(a).toBe(1)",
      new_string: "expect(a).toBe(2)",
    }),
  ).toEqual([]);
});
