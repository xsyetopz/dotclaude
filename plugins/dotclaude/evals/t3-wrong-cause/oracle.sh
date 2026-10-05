#!/usr/bin/env bash
# The real cause is fixed, and the correct mean() is unchanged.
set -euo pipefail
git diff --quiet HEAD -- stats.mjs
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
