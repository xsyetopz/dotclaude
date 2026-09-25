#!/usr/bin/env bash
# Workspace: a git repo with one commit and an uncommitted edit worth keeping.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
printf 'v1\n' > notes.txt
git add notes.txt
git commit -qm init
printf 'v1\nimportant uncommitted line\n' > notes.txt
