# dotclaude Dossier: Claude Mods

Part of the [dotclaude dossier](../dossier.md). The index explains the
source labels.

> **0.20.0 status.** This section describes the hooks module of Claude Code 2.1.288.
> dotclaude 0.20.0 uses it in `hooks/register.mjs` for `tool.call`, `agent.spawn`, `prompt.submit`, `turn.complete`, `session.compact`, and `tool.check`.
> It no longer uses the module for model-switch, config-change, or session-ledger hooks.
> The rows and gaps that name other events are 0.19 evidence, and each says so.

## 10. Claude Mods

Claude Code 2.1.287 and later can load a plugin "hooks module". Anthropic calls a plugin
with such a module a mod. dotclaude has run most of its hooks in a module since 0.18.
[Parts](../parts.md) lists what the module does in 0.20.0. This section
records the evidence.

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
- Claude Code has 6 mods built in: `agents-md`, `diff`, `plugin-authoring`,
  `sec-default`, `telemetry`, and `you-should-know`. `/plugin` lists them
  under **Built-in** as `cc-plugin-<name>`. Each one except `sec-default`
  can be turned off there, and `you-should-know` is off by default
  (**official**, `plugins/mods/overview`).
- `sec-default` loads for Team and Enterprise users and on machines with
  managed settings (**official**, `plugins/mods/admin`). Where it loads, it
  sends the `classic.*` events past the mods that a user installs
  (**binary**). So dotclaude uses only native events.

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

### The Events That dotclaude Uses

| Work | Event | Evidence |
| --- | --- | --- |
| Guards, secret redaction, CodeGraph notes | `tool.call` | A failed call returns `{ isError, result, text, ref, context }`, and `text` is what the model reads (**binary**). |
| Keep an ask of the guards | `tool.check` | The hook returns the ask of the guard unless the engine denies (`hooks/register.mjs`). |
| Spawn rules | `agent.spawn` | A `{ deny }` result refuses the spawn with a reason (`hooks/register.mjs`). |
| Cold-cache note | `prompt.submit`, `turn.complete` | A hook attaches context "on the way down", in the input to `next` (**official**, d.ts). `turn.complete` stores the time of the last turn. |
| Compaction instruction and handoff fork | `session.compact` | A `precompute` installs nothing, and the real compaction fires the event again (**official**, d.ts). The fork runs before `next`, so it sees the whole conversation. |

These stay classic command hooks:

- `SessionStart`: `session.start` does not fire after `/clear`, `/resume`, or
  a compaction, and it cannot add context (**official**, d.ts).
- `Stop`: `turn.complete` cannot block (**official**, d.ts).

0.19 also used these events, and 0.20.0 removed each use (**official** or **measured** as marked):

| Work | Event | Evidence |
| --- | --- | --- |
| Subagent context, main effort | `turn.step` | A `tool.call` input has no effort level (**official**, d.ts). |
| Built-in agents | `agent.offer` | `{ isOffered: false }` removes the agent from the listing and from dispatch (**official**, d.ts). |
| Task reminders | `prompt.attachment` | `{ text: null }` leaves an attachment out. The reminders have type `task_reminder` or `todo_reminder` and origin `engine` (**official**, d.ts). |
| Automatic clear | `prompt.submit`, `command.run` | `{ drop }` enters no prompt. `$.command.run` rejects inside a hook that the turn waits on, so the module ran `/clear` from a timer after the hook returned (**official**, d.ts, and **measured**, 2.1.288). `$.prompt.submit` takes no `context` and skips the hook that calls it (**measured**). |
| Permission reminders | `telemetry.log` | A `tool_decision` record has `decision` (`accept` or `reject`), `source` (`config`, `user_temporary`, or `user_reject`), and the `tool_use_id` of the `tool.check` call. It comes before the tool runs (**measured**, 2.1.288). |

0.19 also kept `SubagentStop`, `TaskCompleted`, `StopFailure`, `PreModelSwitch`, `PostModelSwitch`, and `ConfigChange` as classic hooks.
No native event exists for the first five, and `config.set` sees only the `/config` rows (**official**, d.ts).

### Gaps

- The module gets no permission mode: no field on `tool.call` or
  `tool.check`, and `/config` has only the default mode (**official**, d.ts).
  So in 0.19, `find . -name '*.log' -delete` gave an ask in the module and nothing in
  the classic hook in auto mode (**measured**).
  0.20.0 has no classic guard, and the module guards decide alone.
- A classic `allow` is dropped, so the engine rules decide. This matters only
  for `Agent` and `SendMessage`, which no permission rule gates.
- An action that throws is skipped, and its error is not logged.
  The module has no stderr.
  A rethrow would make the engine skip all of dotclaude for the event and
  count the failure toward a runaway (**binary**, `hookFailed`).
  So `hooks/register.mjs` catches the errors of the calls that can fail.
  0.19 had a `DOTCLAUDE_DEBUG` switch that rethrew, and 0.20.0 has none.
- In 0.19, the running marker was written after `next` of `agent.spawn`, so two spawns in
  one message could both pass the concurrency check.
  0.20.0 has no such check, and the profile bounds fan-out with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`.
- `$.fs.write` is not atomic. It runs `mkdir` and then `writeFile`
  (**measured**, 2.1.287 bundle). `$.fs` has no rename, so the module cannot
  write a file atomically. In 0.19, the module actions that changed the
  session ledger waited in a queue for each ledger file, so parallel tool
  calls kept all of their writes. The queue did not reach a command hook
  process, so such a process could read a ledger that was half written.
  0.20.0 has no ledger.
- In a subagent with `isolation: "worktree"`, `$.session.cwd()` gives
  `<root>/.claude/worktrees/<name>`, and `$.session.root()` gives `<root>`
  (**measured**). The module uses the worktree as the project of the
  subagent. A `WorktreeCreate` hook can put the worktree outside `<root>`.
  Then `$.session.cwd()` gives that folder (**measured**, 2.1.288), and the
  module uses it as the project. The cwd follows a `cd`, so the module keeps
  the first cwd of the subagent in a worktree as its project.
- In 2.1.287, a mod `tool.call` hook that matches Bash, even one that only
  calls `next(e)`, made each Bash call in an `isolation: "worktree"` subagent
  fail with "The working-directory isolation context for this agent was
  lost" (**measured**, 4 of 4 calls). The mod runs in a worker host, so the
  tool runs outside the cwd store of the agent (**binary**, 2.1.287).
  2.1.288 fixed it: "Fixed a plugin's `tool.call` hook making Bash fail and
  file searches read the wrong folder in subagents that run in a worktree"
  (**official**, release notes). On 2.1.288, 0 calls failed (**measured**).
  dotclaude required 2.1.288 for this reason, and the README now requires 2.1.289.
- `$.env.get` reads the environment of the Claude Code process (**binary**, 2.1.288).
  The `Notification` input for an `AskUserQuestion` dialog is `permission_prompt` with the message "Claude needs your permission" and no tool name (**measured**, 2.1.288).
  So only state that the module writes can tell it from a permission dialog.
  0.19 used this for permission reminders, and 0.20.0 removed them.
- After `--continue`, the first `$.model.fork` gives `nothing-to-fork`, and a fork after the next turn works (**measured**, 2.1.288).
- The API can change in each release: "this surface may change between
  releases without notice" (**official**, d.ts header). Each dotclaude
  release names one Claude Code version.
