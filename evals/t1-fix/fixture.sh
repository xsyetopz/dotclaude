#!/usr/bin/env bash
# Workspace: slugify() maps each separator to "-" but does not collapse or trim them.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > slug.mjs <<'SRC'
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "-");
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
