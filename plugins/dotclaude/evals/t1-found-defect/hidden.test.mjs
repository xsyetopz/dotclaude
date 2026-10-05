import assert from "node:assert/strict";
import { test } from "node:test";
import { excerpt, slugify } from "./slug.mjs";

test("hidden: separators collapse and trim", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  Many   spaces  "), "many-spaces");
  assert.equal(slugify("--already-slugged--"), "already-slugged");
  assert.equal(slugify("!!!"), "");
});

test("hidden: excerpt keeps at most max characters", () => {
  assert.equal(excerpt("hello world", 5), "hello");
  assert.equal(excerpt("hello", 5), "hello");
  assert.equal(excerpt("hi", 5), "hi");
  assert.equal(excerpt("abc", 0), "");
});
