// The hooks module and each file that it imports run in Claude Code with no
// Node and no Bun. `claude plugin validate` follows `$` only into the
// functions of `register.mjs`, so no other file of the closure touches `$`.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const hooks = path.join(import.meta.dir, "../../hooks");
const register = path.join(hooks, "register.mjs");

const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** `register.mjs` and each file that it imports, also through other files. */
function registerClosure() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(
      /^(?:import|export)[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm,
    ))
      visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(register);
  return [...seen];
}

// `register.mjs` calls `$.process.run`, so a name of the host is banned only
// where no `.` comes before it. `node:` is banned only in a string, because
// the Bash rules have a `node:` key for the `node` command.
const BANNED = {
  "node:": /["'`]node:/,
  "Bun.": /(?<![.\w$])Bun\./,
  "process.": /(?<![.\w$])process\./,
  globalThis: /\bglobalThis\b/,
  "import(": /\bimport\s*\(/,
  "$.": /(?<![\w$])\$\./,
};

/** Each `file: banned` pair of `files` whose code has the banned name. */
const findings = (files, banned) =>
  files.flatMap((file) => {
    const code = withoutComments(fs.readFileSync(file, "utf8"));
    return banned
      .filter((name) => BANNED[name].test(code))
      .map((name) => `${path.relative(hooks, file)}: ${name}`);
  });

test("the closure of register.mjs uses no Node, Bun, process, globalThis, dynamic import, or $", () => {
  const files = registerClosure().filter((file) => file !== register);
  expect(files.length).toBeGreaterThan(13);
  expect(findings(files, Object.keys(BANNED))).toEqual([]);
});

test("register.mjs uses no Node, Bun, process, or dynamic import", () => {
  expect(
    findings([register], ["node:", "Bun.", "process.", "import("]),
  ).toEqual([]);
});

test("register.mjs runs each action of the module events", async () => {
  const { ACTIONS, MODULE_EVENTS } = await import(
    "../../hooks/lib/_actions.mjs"
  );
  const source = fs.readFileSync(register, "utf8");
  const missing = MODULE_EVENTS.flatMap((event) =>
    ACTIONS[event].map(([, action]) => action),
  ).filter((action) => !source.includes(`["${action}", `));
  expect(missing).toEqual([]);
});
