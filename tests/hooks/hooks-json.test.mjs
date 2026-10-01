// hooks.json wiring: one dispatcher entry per event, and a dispatcher table
// that names every action file once.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ACTIONS } from "../../hooks/dispatch.mjs";
import { HOOKS } from "../support/hooks.mjs";

const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));

test("hooks.json runs the dispatcher once per event in the table", () => {
  expect(Object.keys(cfg.hooks).sort()).toEqual(Object.keys(ACTIONS).sort());
  for (const [event, entries] of Object.entries(cfg.hooks)) {
    expect(entries).toHaveLength(1);
    const [handler] = entries[0].hooks;
    expect(handler.command).toBe("bun");
    // The placeholder is literal text that Claude Code substitutes at run time.
    const root = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
    expect(handler.args).toEqual([`${root}/hooks/dispatch.mjs`, event]);
  }
});

test("each hooks.json matcher covers the matchers of its actions", () => {
  for (const [event, [entry]] of Object.entries(cfg.hooks)) {
    const matchers = [...new Set(ACTIONS[event].map(([m]) => m))];
    if (matchers.includes("*")) expect(entry.matcher).toBeUndefined();
    else {
      const names = (m) => [...new Set(m.split("|"))].sort();
      expect(names(entry.matcher)).toEqual(names(matchers.join("|")));
    }
  }
});

test("the table names every action file, and each file exists", () => {
  const listed = new Set(
    Object.values(ACTIONS)
      .flat()
      .map(([, action]) => action),
  );
  for (const action of listed)
    expect(fs.existsSync(path.join(HOOKS, action)), action).toBeTruthy();
  const onDisk = fs
    .readdirSync(HOOKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !["lib", "status-line"].includes(d.name))
    .flatMap((d) =>
      fs
        .readdirSync(path.join(HOOKS, d.name))
        .filter((f) => f.endsWith(".mjs"))
        .map((f) => `${d.name}/${f}`),
    );
  expect(onDisk.sort()).toEqual([...listed].sort());
});
