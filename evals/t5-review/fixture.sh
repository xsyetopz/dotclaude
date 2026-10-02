#!/usr/bin/env bash
# Workspace: the last commit adds pagination, a TTL cache, and session
# pruning. Planted defects: `page()` never returns a null cursor, the cache
# compares milliseconds with seconds, and the sort orders ids as strings.
# The reverse `splice` loop in `prune()` is correct.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > api.mjs <<'SRC'
export function listUsers(users) {
  return users;
}
SRC
git add -A
git commit -qm init
cat > page.mjs <<'SRC'
// One page of items sorted by numeric `id`, and the cursor of the next page,
// or null after the last page.
export function page(items, cursor = 0, size = 20) {
  const sorted = [...items].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  return {
    items: sorted.slice(cursor, cursor + size),
    next: cursor + size,
  };
}
SRC
cat > cache.mjs <<'SRC'
// Keep each entry for `ttlSeconds` seconds.
export function createCache({ ttlSeconds, now = Date.now }) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at > ttlSeconds) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, at: now() });
    },
  };
}
SRC
cat > prune.mjs <<'SRC'
// Remove expired sessions in place and return the array.
export function prune(sessions, now) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].expires <= now) sessions.splice(i, 1);
  }
  return sessions;
}
SRC
cat > api.mjs <<'SRC'
import { createCache } from "./cache.mjs";
import { page } from "./page.mjs";

const cache = createCache({ ttlSeconds: 60 });

export function listUsers(users, query = {}) {
  const key = `${query.cursor ?? 0}:${query.size ?? 20}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = page(users, Number(query.cursor) || 0, Number(query.size) || 20);
  cache.set(key, result);
  return result;
}
SRC
git add -A
git commit -qm "Add cursor pagination, a TTL cache, and session pruning"
