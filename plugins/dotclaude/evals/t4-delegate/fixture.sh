#!/usr/bin/env bash
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
cat > stack.mjs <<'SRC'
export class Stack {
  #items = [];
  push(item) {
    this.#items.push(item);
  }
}
SRC
git add -A
git commit -qm init
