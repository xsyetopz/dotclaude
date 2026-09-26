#!/usr/bin/env bash
set -euo pipefail
cat > stack.mjs <<'SRC'
export class Stack {
  #items = [];
  push(item) {
    this.#items.push(item);
  }
}
SRC
