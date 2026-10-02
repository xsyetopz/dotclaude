#!/usr/bin/env bash
# A review changes nothing: no new commit and no tracked file changed.
set -euo pipefail
test "$(git rev-list --count HEAD)" -eq 2
git diff --quiet HEAD
