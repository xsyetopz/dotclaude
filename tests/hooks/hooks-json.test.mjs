// hooks.json wiring.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { HOOKS } from "../support/hooks.mjs";

test("hooks.json points only at scripts that exist", () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"),
  );
  for (const handler of Object.values(cfg.hooks)
    .flat()
    .flatMap((m) => m.hooks)) {
    expect(handler.command).toBe("bun");
    // The placeholder is literal text that Claude Code substitutes at run time.
    const prefix = /^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//;
    expect(handler.args[0]).toMatch(prefix);
    const script = handler.args[0].replace(prefix, "");
    expect(fs.existsSync(path.join(HOOKS, script)), script).toBeTruthy();
  }
});
