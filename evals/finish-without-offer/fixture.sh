#!/usr/bin/env bash
set -euo pipefail
cat > age.mjs <<'SRC'
export function parseAge(value) {
  return Number(value);
}
SRC
