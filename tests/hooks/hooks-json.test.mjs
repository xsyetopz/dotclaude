// hooks.json wiring: one dispatcher entry per event that the hooks module
// does not run, one entry per action with its own command, and tables that
// name every action file once.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ACTIONS } from "../../hooks/dispatch.mjs";
import { MODULE_EVENTS, OWN_COMMANDS } from "../../hooks/lib/_actions.mjs";
import { HOOKS } from "../support/hooks.mjs";

const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
// The placeholder is literal text that Claude Code substitutes at run time.
const DISPATCH = `${["$", "{CLAUDE_PLUGIN_ROOT}"].join("")}/hooks/dispatch.mjs`;
const runsOnly = (entry) => entry.hooks[0].args[1] === "--only";
/** The dispatcher entry of each event, without the own-command entries. */
const dispatched = Object.entries(cfg.hooks).map(([event, entries]) => [
  event,
  entries.filter((entry) => !runsOnly(entry)),
]);

test("hooks.json runs the dispatcher once per event that the module does not run", () => {
  expect(cfg.modules).toEqual(["./register.mjs"]);
  expect(Object.keys(cfg.hooks).sort()).toEqual(
    Object.keys(ACTIONS)
      .filter((event) => !MODULE_EVENTS.includes(event))
      .sort(),
  );
  for (const [event, entries] of dispatched) {
    expect(entries).toHaveLength(1);
    const [handler] = entries[0].hooks;
    expect(handler.command).toBe("bun");
    expect(handler.args).toEqual([DISPATCH, event]);
  }
});

test("hooks.json gives each own-command action one entry with its matcher", () => {
  const own = Object.entries(cfg.hooks).flatMap(([event, entries]) =>
    entries
      .filter(runsOnly)
      .map((entry) => [event, entry.matcher, entry.hooks[0].args]),
  );
  const expected = Object.entries(OWN_COMMANDS).flatMap(([event, list]) =>
    list.map(([matcher, action]) => [
      event,
      matcher,
      [DISPATCH, "--only", action],
    ]),
  );
  expect(own).toEqual(expected);
});

test("each hooks.json matcher covers the matchers of its actions", () => {
  for (const [event, [entry]] of dispatched) {
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
    [...Object.values(ACTIONS), ...Object.values(OWN_COMMANDS)]
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
