#!/usr/bin/env bash
# Workspace: slugify() does not collapse or trim separators (the reported bug).
# excerpt() in the same file keeps one character too many (the second bug).
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > slug.mjs <<'SRC'
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

// Returns at most `max` characters of `text`.
export function excerpt(text, max) {
  return text.length <= max ? text : text.slice(0, max + 1);
}
SRC
cat > slug.test.mjs <<'SRC'
import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./slug.mjs";

test("slugify", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});
SRC
git add -A
git commit -qm init
