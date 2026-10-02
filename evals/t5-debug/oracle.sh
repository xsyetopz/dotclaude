#!/usr/bin/env bash
# The shared state is fixed at its source, nested headers included. The
# correct retry loop is unchanged, and the existing tests are kept: new tests
# may be added, but no line of `client.test.mjs` is removed or changed.
set -euo pipefail
git diff --quiet HEAD -- retry.mjs
if git diff HEAD -- client.test.mjs | grep -q '^-[^-]'; then
  echo "client.test.mjs lost or changed a line"
  exit 1
fi
cp "$ORACLE_DIR/hidden.test.mjs" ./zz-hidden.test.mjs
node --test
