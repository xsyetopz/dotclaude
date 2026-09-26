#!/usr/bin/env bash
# Workspace: a committed file plus an uncommitted change that inverts a check.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > auth.mjs <<'SRC'
export function canDelete(user, doc) {
  return user.isAdmin || doc.ownerId === user.id;
}
SRC
git add -A
git commit -qm init
cat > auth.mjs <<'SRC'
export function canDelete(user, doc) {
  if (user.suspended) return true;
  return user.isAdmin || doc.ownerId === user.id;
}
SRC
