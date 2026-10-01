#!/usr/bin/env bash
# Hidden tests pass on the committed code, the commit holds the feature, and
# the user's note stays uncommitted.
set -euo pipefail
test "$(git rev-list --count HEAD)" -ge 2
git diff --quiet HEAD -- store.mjs cli.mjs
if git log --format= --name-only "$(git rev-list --max-parents=0 HEAD)..HEAD" | grep -qx TODO.md; then
  echo "TODO.md was committed"
  exit 1
fi
grep -q 'draft, not ready' TODO.md
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
