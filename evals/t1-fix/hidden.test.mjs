import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./slug.mjs";

test("hidden: separators collapse and trim", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  Many   spaces  "), "many-spaces");
  assert.equal(slugify("--already-slugged--"), "already-slugged");
  assert.equal(slugify("Top 10 Tips"), "top-10-tips");
  assert.equal(slugify("a_b.c"), "a-b-c");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify(""), "");
});
