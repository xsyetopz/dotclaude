import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_JS_LINES } from "../hooks/lib/_budget.mjs";

const root = join(import.meta.dir, "..");
const DIRS = ["hooks", "status-line", "skills", "plugins"];

function lines(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += lines(path);
    else if (entry.name.endsWith(".mjs"))
      total += readFileSync(path, "utf8").split("\n").length - 1;
  }
  return total;
}

test("runtime JavaScript stays within the line budget", () => {
  const total = DIRS.map((d) => join(root, d))
    .filter(existsSync)
    .reduce((sum, dir) => sum + lines(dir), 0);
  expect(total).toBeLessThanOrEqual(RUNTIME_JS_LINES);
});
