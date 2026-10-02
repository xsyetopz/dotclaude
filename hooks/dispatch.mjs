#!/usr/bin/env bun
// One process per hook event: `bun dispatch.mjs <Event>` imports the actions
// of that event, runs each one whose matcher fits the input, and merges their
// outputs into one reply. One process instead of one per action halves the
// CPU time of the hooks on a `Bash` call (docs/dossier/design.md).
//
// `bun dispatch.mjs --only <event-dir>/<action>.mjs ...` runs the named
// actions with no matcher, as the tests do.
//
// The actions of one event run at the same time, so an action that waits
// for a child process (`redact-secrets` waits about 25 ms for Betterleaks) does
// not delay the others. The merge uses the table order, not the finish order.
//
// Each action fails open on its own: an error in one action is logged to
// stderr and the others still run.

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { ACTIONS, MATCH_FIELD, matches, merge } from "./lib/_actions.mjs";
import { emit, readInput } from "./lib/_common.mjs";
import { TAG } from "./lib/_core.mjs";
import { nodeIo } from "./lib/_io-node.mjs";

// The tests import the table and the merge from this file.
export { ACTIONS, matches, merge };

function select(argv, data) {
  if (argv[0] === "--only") return argv.slice(1);
  const event = argv[0] ?? data.hook_event_name;
  const field = MATCH_FIELD[event];
  return (ACTIONS[event] ?? [])
    .filter(([matcher]) => matches(matcher, field ? data[field] : undefined))
    .map(([, action]) => action);
}

/** Values of `[index, value]` pairs, in index order. */
const ordered = (pairs) =>
  pairs.toSorted(([a], [b]) => a - b).map(([, value]) => value);

async function main() {
  const data = readInput();
  const current = new AsyncLocalStorage();
  const mode = {
    bodies: [],
    outputs: [],
    blocking: [],
    action: () => current.getStore(),
  };
  globalThis[Symbol.for("dotclaude.dispatch")] = mode;
  const fail = (action, err) => {
    if (process.env.DOTCLAUDE_DEBUG) throw err;
    process.stderr.write(
      `${TAG} hook error in ${action} (ignored): ${err?.stack ?? err}\n`,
    );
  };
  const runs = [];
  for (const [index, action] of select(process.argv.slice(2), data).entries()) {
    const count = mode.bodies.length;
    let mod;
    try {
      mod = await import(path.join(import.meta.dirname, action));
    } catch (err) {
      fail(action, err);
      continue;
    }
    // A ported action exports `default (io, data)` and returns its output
    // (hooks/lib/_io.mjs). A classic action registers one body through
    // `run()` when it is imported.
    let body;
    if (typeof mod.default === "function")
      body = async (input) => {
        const out = await mod.default(nodeIo(input), input);
        if (out) emit(out);
      };
    else if (mode.bodies.length > count) body = mode.bodies.at(-1);
    else continue;
    runs.push(
      current
        .run(index, async () => body(structuredClone(data)))
        .catch((err) => fail(action, err)),
    );
  }
  await Promise.all(runs);
  if (mode.blocking.length) {
    fs.writeSync(2, `${ordered(mode.blocking).join("\n")}\n`);
    process.exit(2);
  }
  const out = merge(ordered(mode.outputs));
  if (out) process.stdout.write(JSON.stringify(out));
  process.exitCode = 0;
}

if (import.meta.main) await main();
