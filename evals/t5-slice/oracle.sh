#!/usr/bin/env bash
# Every requirement holds, the agent added tests, and `parseDuration()` is
# unchanged.
set -euo pipefail
git diff --quiet HEAD -- duration.mjs
grep -q -- '--since' cli.test.mjs
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
