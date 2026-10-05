#!/usr/bin/env bash
# Hidden tests: the fix must generalize beyond the visible test.
set -euo pipefail
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
