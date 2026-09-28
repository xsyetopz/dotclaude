// Import direction: event hooks depend on hooks/lib, never on each other, and
// hooks/lib depends on nothing outside itself. Skill scripts may import
// hooks/lib, so the plan and profile logic has one owner.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const hooks = path.join(import.meta.dir, "..", "..", "hooks");
const imports = (file) =>
  [...fs.readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith("."));

test("hooks/lib imports only itself, and event hooks only hooks/lib", () => {
  const bad = [];
  for (const rel of fs.readdirSync(hooks, { recursive: true }).map(String)) {
    if (!rel.endsWith(".mjs")) continue;
    const inLib = rel.startsWith(`lib${path.sep}`);
    for (const spec of imports(path.join(hooks, rel))) {
      const target = path.relative(
        hooks,
        path.resolve(path.dirname(path.join(hooks, rel)), spec),
      );
      if (!target.startsWith(`lib${path.sep}`)) bad.push(`${rel} -> ${spec}`);
      else if (!inLib && !spec.startsWith("../lib/"))
        bad.push(`${rel} -> ${spec}`);
    }
  }
  expect(bad).toEqual([]);
});
