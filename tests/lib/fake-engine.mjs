// A small fake of the engine's `$` and a fake `on`, for the tests of the
// hooks module. The tests never run a guarded command.

import { register } from "../../hooks/register.mjs";

const enoent = (file) =>
  Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });

/**
 * A fake `$`. Files are a map from path to text, which `$.files` shows to
 * the tests. `betterleaks` reports each secret in `init.secrets`, a string
 * with the rule `generic-api-key` or a `{ secret, rule }`, and each other
 * command exits with 1. `init.cwd` and `init.root` give the session folders.
 * `init.pluginRoot` gives the plugin root, whose shape sets the platform.
 */
export function fake(init = {}) {
  const files = new Map(Object.entries(init.files ?? {}));
  const env = { HOME: "/home/u", ...init.env };
  const $ = {
    files,
    plugin: {
      name: "dotclaude",
      root: init.pluginRoot ?? "/plugins/dotclaude",
    },
    env: { get: async (name) => env[name] },
    fs: {
      read: async (file) => {
        if (init.fsFails) throw new TypeError("fs failed");
        if (!files.has(file)) throw enoent(file);
        return files.get(file);
      },
      write: async (file, text) => {
        if (init.fsFails) throw new TypeError("fs failed");
        files.set(file, text);
      },
      exists: async (file) => files.has(file),
      stat: async (file) => {
        if (init.fsFails) throw new TypeError("fs failed");
        if (!files.has(file)) throw enoent(file);
        return { kind: "file", size: 1, mtimeMs: 5, isLink: false };
      },
      list: async () => [],
    },
    process: {
      run: async (argv) => {
        const leaks = argv[0] === "betterleaks";
        const report = (init.secrets ?? []).map((secret) =>
          typeof secret === "string"
            ? { Secret: secret, RuleID: "generic-api-key" }
            : { Secret: secret.secret, RuleID: secret.rule },
        );
        return {
          exitCode: leaks ? 0 : 1,
          stdout: leaks ? JSON.stringify(report) : "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        };
      },
    },
    session: {
      id: async () => "s1",
      cwd: async () => init.cwd ?? "/work",
      root: async () => init.root ?? init.cwd ?? "/work",
      messages: async () => init.messages ?? [],
      usage: async () => ({ startedAt: 0, context: { window: 200000 } }),
    },
    agent: { list: async () => init.agents ?? [] },
  };
  return $;
}

/**
 * The handlers that `register` gives to a fake `on`, by event name.
 * `options` are the plugin options that `register(on, options)` gets.
 */
export function registered(options = {}) {
  const handlers = {};
  register((name, hook) => {
    handlers[name] = hook;
  }, options);
  return handlers;
}
