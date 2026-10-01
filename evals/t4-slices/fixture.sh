#!/usr/bin/env bash
# Workspace: six modules format text through the legacy fmt() helper. The
# tests in test/ cover each module's output.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
mkdir -p src/legacy test
cat > src/legacy/fmt.mjs <<'SRC'
// Replaces each %s or %d in order with the next argument.
export function fmt(template, ...args) {
  let i = 0;
  return template.replace(/%[sd]/g, () => String(args[i++]));
}
SRC
write_module() {
  local name=$1 fn=$2 template=$3 params=$4 call=$5 expected=$6
  cat > "src/$name.mjs" <<SRC
import { fmt } from "./legacy/fmt.mjs";

export function $fn($params) {
  return fmt("$template", $params);
}
SRC
  cat > "test/$name.test.mjs" <<SRC
import assert from "node:assert/strict";
import { test } from "node:test";
import { $fn } from "../src/$name.mjs";

test("$fn", () => {
  assert.equal($fn($call), "$expected");
});
SRC
}
write_module greet greet 'Hello, %s!' 'name' '"Ana"' 'Hello, Ana!'
write_module price price '%d.%d EUR' 'whole, cents' '3, 50' '3.50 EUR'
write_module count count '%d items in %s' 'n, where' '4, "cart"' '4 items in cart'
write_module path joinPath '%s/%s' 'dir, file' '"src", "a.mjs"' 'src/a.mjs'
write_module range range '%d..%d' 'from, to' '1, 9' '1..9'
write_module tag tag '<%s>%s</%s>' 'name, body' '"b", "x"' '<b>x</b>'
# tag() repeats the name, so it passes it twice.
sed -i.bak 's/return fmt("<%s>%s<\/%s>", name, body);/return fmt("<%s>%s<\/%s>", name, body, name);/' src/tag.mjs
rm src/tag.mjs.bak
git add -A
git commit -qm init
