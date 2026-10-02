# dotclaude Dossier: Claude Mods

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

## 10. Claude Mods

Claude Code 2.1.287 can load a plugin "hooks module". Anthropic calls a plugin
with such a module a mod. dotclaude 0.17.1 uses no module. This section
records the facts for a prototype in 0.18.

### What A Mod Is

- A mod is a plugin whose `hooks/hooks.json` names one module:
  `{ "description": …, "modules": ["./register.ts"] }`. The module exports
  `register(on, options)`, and each hook has the form `($, e, next)`
  (**official**, `mods/README.md` in `anthropics/claude-code`).
- A plugin can have one module only. The schema says that a second entry "is
  refused". The same `hooks.json` can also have the classic `hooks` key
  (**binary**, 2.1.287).
- The module is ESM in `.ts`, `.js`, `.mjs`, or a related extension. It runs
  "in an environment of its own: no DOM, no Node". The CLI runs it, not the
  Bun on `PATH`. File and process work goes through `$.fs` and
  `$.process.run` (**official**, `mods/types/claude-code.d.ts`).
- `register` gets its `options` from the `userConfig` of `plugin.json`
  (**official**, `mods/agents-md`).
- `/plugin-types` writes `.claude/types/claude-code.d.ts`.
  `claude plugin test [dir]` runs each `*.test.ts` file with the kit from
  `claude-code/testing`. `claude plugin validate` checks a module before it
  loads (**official**, d.ts header and CLI help).
- Claude Code has 4 mods built in: `sec-default`, `diff`, `telemetry`, and
  `agents-md` (**official**). It also has `cc-plugin-you-should-know@builtin`,
  which writes "You should know" explainer pages. `/plugin disable
  you-should-know` turns it off (**binary**, partly **inference**).

### The Gate

- The GrowthBook flag `tengu_plugin_hooks_modules` turns modules on. Its
  default is true (**binary**, 2.1.287).
- Claude Code refuses a module for one of these reasons (**binary**):
  `diskless`, `hooks_modules_off`, `all_hooks_disabled`, `sideload_disabled`,
  `local_dirs_blocked`, `managed_hooks_only` (`allowManagedHooksOnly`),
  `hooks_disabled_in_settings` (`disableAllHooks`), `safe_mode`, `bare_mode`,
  and `untrusted`.
- No reason is about the plan or about a first-party plugin. So a plugin from
  a marketplace can load a module, unless an organization sets
  `allowManagedModsOnly` in `sec-default` (**official**,
  `mods/sec-default/hooks/hooks.json`).
- The API is early access: "this surface may change between releases without
  notice" (**official**, d.ts header).

### Order

- The chain order is managed settings hooks, then hooks modules, then the
  other settings hooks (**official**, d.ts `ClassicEventOf`). So a dotclaude
  module runs before the dotclaude classic hooks.
- `sec-default` is outermost, unless managed `prependPlugins` changes the
  order (**official**, `mods/README.md`).

### The Events That Apply To dotclaude

| dotclaude today | Mod event | What the module adds |
| --- | --- | --- |
| SessionStart notes | `session.start`, `prompt.context` | One process. The notes go in as a context block. |
| UserPromptSubmit | `prompt.submit` | It can change or drop the prompt. |
| SubagentStart | `agent.spawn` | It can also set the model or deny the spawn. |
| PreToolUse guards | `tool.check`, `tool.call` | An exact verdict with no new process for each call. |
| PostToolUse redaction | `tool.call` around `next` | It changes a typed result, not `updatedToolOutput` JSON. |
| Stop and SubagentStop checks | `classic.Stop` with `block` | The same power. `turn.complete` cannot block. |
| PreCompact | `session.compact` | It can change the instructions or the messages, or skip. |
| Model lock | `turn.step` | It sets the model for each request. |
| ConfigChange | `config.set` | It can deny or clamp a `/config` row. |
| Status line script | `ui.status`, `ui.render` `AbovePrompt` | It runs in the process and can take input. |

The other classic events are available as `classic.<Event>`, with `block`,
`additionalContext`, `updatedToolOutput`, and `permissionDecision`
(**official**, d.ts `ClassicResult`).

### Risks

- The API can change in each release. dotclaude needs one exact Claude Code
  version for each release, so a test on that version catches a change
  (**inference**).
- A policy, a remote flag, `--bare`, safe mode, or an untrusted workspace can
  turn off modules. So each classic hook must stay as the fallback, and a
  module must not do the same work twice when both run (**inference**).
- The module gets no Node or Bun API. The guards in `hooks/lib` use
  `node:fs`, `node:child_process`, and `Bun.Glob`, so a port needs an adapter
  over `$.fs` and `$.process` (**inference**).
- Not checked: whether a `classic.*` hook gets the same payload as the stdin
  JSON of a command hook.

### Plan For 0.18

1. Write a module that does only the model lock with `turn.step` and the
   SessionStart notes with `prompt.context`. These have no file system work.
1. When the module loads, the classic hooks for the same work return early.
   Find a signal that a classic hook can read, and measure it in the sandbox.
1. Test the module with `claude plugin test`, and keep the Bun tests for the
   classic hooks.
1. Measure the time per tool call for the guards in a module against the
   current hook process. Port the guards only if the gain is large.
