#!/usr/bin/env bash
# Workspace: an empty project. The answer is on a web page, so the fixture
# holds only a note that the oracle checks stays unchanged.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > NOTES.md <<'SRC'
# Server notes

Timeouts for the HTTP server are not decided yet.
SRC
git add -A
git commit -qm init
