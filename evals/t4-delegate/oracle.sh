#!/usr/bin/env bash
# The agent's tests exist, and they and the hidden tests pass.
set -euo pipefail
test -f stack.test.mjs
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
