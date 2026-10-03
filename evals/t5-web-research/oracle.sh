#!/usr/bin/env bash
# A lookup changes nothing: no new commit, no tracked file changed, and no
# new file.
set -euo pipefail
test "$(git rev-list --count HEAD)" -eq 1
git diff --quiet HEAD
test -z "$(git status --porcelain)"
