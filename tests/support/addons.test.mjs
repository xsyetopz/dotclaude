// Each add-on plugin installs and works without the core plugin,
// so no add-on file names a path in `plugins/dotclaude/` or the old operating spec.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PLUGINS = path.join(import.meta.dirname, "../../plugins");
const ADDONS = fs
  .readdirSync(PLUGINS)
  .filter((name) => name.startsWith("dotclaude-"));
const TEXT = /\.(?:mjs|js|ts|json|md)$/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : files(p);
    return TEXT.test(entry.name) ? [p] : [];
  });
}

test("the add-ons exist", () => {
  expect(ADDONS.length).toBeGreaterThan(0);
});

for (const addon of ADDONS) {
  test(`${addon} has no ties to the core plugin`, () => {
    for (const file of files(path.join(PLUGINS, addon))) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\.\.\/dotclaude\/|plugins\/dotclaude\//);
      expect(text, file).not.toContain("dotclaude_spec");
      expect(text, file).not.toContain("operating spec");
    }
  });
}
