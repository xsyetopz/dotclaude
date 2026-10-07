# Claude Mods

This page answers one question: what does Claude Code let a plugin hooks module do, and which parts does dotclaude use?
It is the evidence for the hooks module of Claude Code 2.1.288, with the 0.27 use of it on top.

## Summary

- Claude Code 2.1.287 and later can load a plugin "hooks module".
  Anthropic calls a plugin with such a module a mod.
  The docs describe mods (**official**, `hooks.md`).
- dotclaude 0.27.0 uses the module in `plugins/dotclaude/hooks/mod.mjs` for two events, `tool.check` and `prompt.section`.
  The `tool.check` handler calls `next(e)` first and returns an engine deny unchanged.
  Its pure rules are in `lib/guard.mjs`.
- 0.27.0 has one classic `PreToolUse` command hook, `hooks/auto-mode-guard.mjs`, which acts only in auto mode.
  It has no prompt hook on `Stop`.
  The rows and sections below that name other events, `ask-guarded-calls.mjs`, or 0.19 to 0.26 parts are history, and each says so.
- The module gets no permission mode, and in auto mode the classifier decides an ask of `tool.check` (**measured**, 2.1.292).
  An ask of a classic hook stops the call in auto mode (**measured**, 2.1.292).
  See [Auto mode](#auto-mode-module-ask-against-classic-ask).
- Where the built-in guard `sec-default` loads, it skips the `prompt.section` hook of a user's mod (**measured**, 2.1.292).
  See [The built-in guard](#the-built-in-guard-sec-default).
- The API is early access, so each dotclaude release names one Claude Code version.
  The mods API can change between releases.
- [Parts](Parts) lists what the module does.

Labels: **official** (Anthropic docs and files), **binary** (the Claude Code bundle, read only), **measured** (a run on this machine).
This page quotes only short strings from the bundle, and it gives no bundle code.

## What a mod is

| Topic | Fact | Label |
| --- | --- | --- |
| Registration | `hooks/hooks.json` names one module: `{ "description": …, "modules": ["./register.ts"] }`. The module exports `register(on, options)`, and each hook has the form `($, e, next)`. | **official**, `mods/README.md` in `anthropics/claude-code` |
| Count | A plugin can have one module only. The schema says that a second entry "is refused". | **binary**, 2.1.287 |
| Classic hooks | The same `hooks.json` can also have the classic `hooks` key. | **binary**, 2.1.287 |
| Environment | The module is ESM in `.ts`, `.js`, `.mjs`, or a related extension. It runs "in an environment of its own: no DOM, no Node". The CLI runs it, not the Bun on `PATH`. | **official**, `mods/types/claude-code.d.ts` |
| File and process work | It goes through `$.fs` and `$.process.run`. | **official**, `mods/types/claude-code.d.ts` |
| Options | `register` gets its `options` from the `userConfig` of `plugin.json`. | **official**, `mods/agents-md` |
| Tooling | `/plugin-types` writes `.claude/types/claude-code.d.ts`. `claude plugin test [dir]` runs each `*.test.ts` file with the kit from `claude-code/testing`. `claude plugin validate` checks a module before it loads. | **official**, d.ts header and CLI help |
| Built-in mods | Claude Code has 6: `agents-md`, `diff`, `plugin-authoring`, `sec-default`, `telemetry`, and `you-should-know`. `/plugin` lists them under **Built-in** as `cc-plugin-<name>`. Each one except `sec-default` can be turned off there, and `you-should-know` is off by default. | **official**, `plugins/mods/overview` |
| `sec-default` | It loads for Team and Enterprise users and on machines with managed settings. | **official**, `plugins/mods/admin` |

Where `sec-default` loads, it sends the `classic.*` events past the mods that a user installs (**binary**).
So the module of dotclaude uses only native events.

## The built-in guard (`sec-default`)

The [admin page](https://code.claude.com/docs/en/plugins/mods/admin) of the docs gives these rules (**official**):

- The guard loads when the machine has managed settings, or when the user signs in with a Team or Enterprise plan.
  A user cannot turn it off.
- "The guard protects what you manage."
  A user's mod cannot change the system prompt, managed hooks, managed instructions, or the settings that a mod reads.
- A user's mod can still deny a call, and it can approve a call that an `ask` rule or a non-managed `PreToolUse` hook would stop.
  "In auto mode, a call the mod approves runs without a classifier check."
- A plugin that Claude Code copies into its cache counts as a user's plugin, also when managed `enabledPlugins` turns it on.
  This covers each plugin from a GitHub, git, URL, or npm source.
- A plugin counts as the organization's only when managed settings name its marketplace as a local folder by absolute path (`extraKnownMarketplaces`), the marketplace lists it by a relative path, and managed `enabledPlugins` turns it on.
- `prependPlugins` in managed settings sets the order of the organization's mods.
  The list replaces the default, so it must name `sec-default@builtin`.
- The source of the guard is public in [`mods/sec-default`](https://github.com/anthropics/claude-code/tree/main/mods/sec-default).

On this machine, with Claude Code 2.1.292 (**measured**):

- The machine had a managed settings file with only `fastMode` and `availableModels`.
  That was enough to load the guard.
- The debug log said that the `prompt.section` hook of dotclaude was bypassed by `cc-plugin-sec-default` at tier `user`.
  So the replacement text of `context_management` did not reach the prompt.
- The `tool.check` hook of dotclaude still ran, and its ask reached the user.
- The classic `PreToolUse` command hook of the plugin also ran.

dotclaude installs from GitHub, so it is always a user's mod.
To let its `prompt.section` hook run on a machine with the guard, do one of these (**not verified**, both need `sudo`):

1. Remove the managed settings files, and keep their keys in user settings.
   Without managed settings and without a Team or Enterprise login, the guard does not load.
1. Copy the marketplace to a folder that only an administrator can write.
   In managed settings, name that folder in `extraKnownMarketplaces`, set `enabledPlugins` for `dotclaude@dotclaude`, and set `prependPlugins` to `["sec-default@builtin", "dotclaude@dotclaude"]`.

The optional `templates/managed-settings.json` of dotclaude is a managed settings file.
So when you install it, the guard loads, and the `context_management` text of dotclaude goes away.
The forced output style still says that compaction is off.

## The gate

- The GrowthBook flag `tengu_plugin_hooks_modules` turns modules on.
  Its default is true (**binary**, 2.1.287).
- No refusal reason is about the plan or about a first-party plugin.
  So a plugin from a marketplace can load a module, unless an organization sets `allowManagedModsOnly` in `sec-default` (**official**, `mods/sec-default/hooks/hooks.json`).
- The API is early access: "this surface may change between releases without notice" (**official**, d.ts header).

Claude Code refuses a module for one of these reasons (**binary**):

- `diskless`, `hooks_modules_off`, `all_hooks_disabled`, `sideload_disabled`, and `local_dirs_blocked`.
- `managed_hooks_only` (`allowManagedHooksOnly`) and `hooks_disabled_in_settings` (`disableAllHooks`).
- `safe_mode`, `bare_mode`, and `untrusted`.

## Order

- The chain order is managed settings hooks, then hooks modules, then the other settings hooks (**official**, d.ts `ClassicEventOf`).
  So a dotclaude module runs before classic hooks of other plugins.
- `sec-default` is outermost, unless managed `prependPlugins` changes the order (**official**, `mods/README.md`).

## The event that dotclaude uses

| Work | Event | Evidence |
| --- | --- | --- |
| Ask for a recursive `rm` outside the project, and the policy ask | `tool.check` | The hook calls `next(e)`, returns an engine deny unchanged, and otherwise returns an ask (`plugins/dotclaude/hooks/mod.mjs`). Lab tests in `tests/mod.test.ts` cover it. |
| Replace the `context_management` section of the system prompt | `prompt.section` with the matcher `{ name: "context_management" }` | The hook returns `{ text }` when `DISABLE_COMPACT` is set, and calls `next(e)` otherwise. The text is the same on each call, so the prompt cache stays. Lab tests cover both cases. |

- The module has no `.catch`, so a failure gives no ask and the verdict of the engine stands.
- `session.cwd`, `session.root`, `session.id`, `env`, and `process.run` are the calls that the module makes, and the lab stubs each one.
- A section has an `id`, a `text`, and a `scope` of `shared` or `session` (**official**, d.ts).
  The `session` scope has `context_management`, which says that the system summarizes prior messages (**binary**).
  With `DISABLE_COMPACT`, that is false.
- `prompt.compose` sees all sections at once.
  dotclaude needs one section, so it uses `prompt.section`.
- `SessionStart` of the optional plugins stays a classic command hook, because `session.start` does not fire after `/clear`, `/resume`, or a compaction, and it cannot add context (**official**, d.ts).

## Events that 0.19 to 0.26 used

0.19 to 0.26 also used these events, and 0.27.0 uses none of them.
The first rows are 0.19 evidence that 0.20.0 removed, and the later releases used `tool.call`, `agent.spawn`, `prompt.submit`, `turn.complete`, and `session.compact` for guards, spawn rules, the cold-cache note, and the compaction handoff.

| Work | Event | Evidence |
| --- | --- | --- |
| Subagent context, main effort | `turn.step` | A `tool.call` input has no effort level (**official**, d.ts). |
| Built-in agents | `agent.offer` | `{ isOffered: false }` removes the agent from the listing and from dispatch (**official**, d.ts). |
| Task reminders | `prompt.attachment` | `{ text: null }` leaves an attachment out. The reminders have type `task_reminder` or `todo_reminder` and origin `engine` (**official**, d.ts). |
| Automatic clear | `prompt.submit`, `command.run` | `{ drop }` enters no prompt. `$.command.run` rejects inside a hook that the turn waits on, so the module ran `/clear` from a timer after the hook returned (**official**, d.ts, and **measured**, 2.1.288). `$.prompt.submit` takes no `context` and skips the hook that calls it (**measured**). |
| Permission reminders | `telemetry.log` | A `tool_decision` record has `decision` (`accept` or `reject`), `source` (`config`, `user_temporary`, or `user_reject`), and the `tool_use_id` of the `tool.check` call. It comes before the tool runs (**measured**, 2.1.288). |

0.19 also kept `SubagentStop`, `TaskCompleted`, `StopFailure`, `PreModelSwitch`, `PostModelSwitch`, and `ConfigChange` as classic hooks.
No native event exists for the first five.
`config.set` sees only the `/config` rows (**official**, d.ts).

## Gaps

| Gap | Effect on dotclaude |
| --- | --- |
| No permission mode in the module | The 0.27 module cannot tell auto mode from another mode. |
| The auto-mode classifier can allow an ask of `tool.check` | `hooks/auto-mode-guard.mjs` gives the same ask from a classic hook in auto mode. |
| `sec-default` skips the `prompt.section` hook of a user's mod | On a machine with managed settings or a Team or Enterprise login, the `context_management` text of dotclaude does not load. |
| A classic `allow` is dropped | Matters only for `Agent` and `SendMessage`. |
| An action that throws is skipped, with no log | The 0.27 module fails open on purpose. |
| `$.fs.write` is not atomic | The module cannot write a file atomically, and 0.27 writes none. |
| `$.session.cwd()` differs in a worktree | 0.19 to 0.26 kept the first cwd as the project. The 0.27 test stubs `session.cwd` and `session.root`. |
| The `Notification` input of an `AskUserQuestion` dialog looks like a permission dialog | 0.20.0 removed permission reminders. |
| `$.model.fork` fails after `--continue` | The first fork gives `nothing-to-fork`. 0.27 does not fork. |

### Auto mode: module ask against classic ask

Measured on Claude Code 2.1.292 with `-p --permission-mode auto` in `just sandbox`:

- A `tool.check` ask of the module went to the auto-mode classifier, and the classifier allowed the call.
- The d.ts says that `ask` "puts it to the mode's decider (the dialog, the auto-mode classifier, a headless host)" (**official**).
- A classic `PreToolUse` hook that returned `permissionDecision: "ask"` stopped the call.
  In `-p`, the call was in `permission_denials`, and the target of `rm -r` outside the project was still there.
- The `if` field of a classic hook works as a filter.
  The debug log has "Skipping hook due to if condition … not matching" for each handler whose pattern did not match.
  So the 7 Bash handlers of `auto-mode-guard.mjs` start one process only for `rm`, `sudo`, `xargs`, `gh`, `git clone`, `curl`, and `wget`.
- The `permission_mode` field of the classic hook input is `auto` in auto mode.
  The script gives no output in each other mode, so the module alone decides there, and the user sees one ask, not two.
- In auto mode, Claude Code ignores some allow rules as dangerous, because they "bypass the classifier".
  The debug log named `Bash(bun run *)`, `Bash(npm run *)`, and `Bash(pnpm run *)`.
  The classifier decides those commands in auto mode.

<details>
<summary>Permission mode and the auto-mode classifier (0.19 to 0.26)</summary>

- The module gets no permission mode.
  No field on `tool.call` or `tool.check` has it, and `/config` has only the default mode (**official**, d.ts).
  So in 0.19, `find . -name '*.log' -delete` gave an ask in the module and nothing in the classic hook in auto mode (**measured**).
- In 2.1.289, the auto-mode classifier decides an ask of `tool.check`, and it can allow the call.
  The d.ts says that `ask` "puts it to the mode's decider (the dialog, the auto-mode classifier, a headless host)" (**official**).
  In auto mode, `codegraph init -y` and `git branch -D old` ran with no prompt, and the transcript said "Allowed by auto mode classifier" (**measured**).
- An ask of a classic `PreToolUse` hook sets a floor: "a classifier allow re-surfaces as this ask" (**binary**, `hookAskFloor`).
  No module field reaches that floor.
- So 0.22.0 gives the asks of the Bash and edit guards again from `plugins/dotclaude/hooks/pre-tool-use/ask-guarded-calls.mjs`.
  With `-p --permission-mode auto`, that hook made `codegraph init -y` a denial, and `git status` ran (**measured**).
- The attribution ask of the Bash guard is still in the module only.
- A classic `allow` is dropped, so the engine rules decide.
  This matters only for `Agent` and `SendMessage`, which no permission rule gates.

</details>

<details>
<summary>Errors, fan-out, and writes</summary>

- An action that throws is skipped, and its error is not logged.
  The module has no stderr.
  A rethrow would make the engine skip all of dotclaude for the event and count the failure toward a runaway (**binary**, `hookFailed`).
- So `plugins/dotclaude/hooks/module/index.mjs` catches the errors of the calls that can fail.
  0.19 had a `DOTCLAUDE_DEBUG` switch that rethrew, and 0.20.0 has none.
- In 0.19, the running marker was written after `next` of `agent.spawn`, so two spawns in one message could both pass the concurrency check.
  0.20.0 has no such check.
  The profile bounds fan-out with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`.
- `$.fs.write` is not atomic.
  It runs `mkdir` and then `writeFile` (**measured**, 2.1.287 bundle).
  `$.fs` has no rename, so the module cannot write a file atomically.
- In 0.19, the module actions that changed the session ledger waited in a queue for each ledger file.
  So parallel tool calls kept all of their writes.
  The queue did not reach a command hook process, so such a process could read a ledger that was half written.
  0.20.0 has no ledger.

</details>

<details>
<summary>Worktree subagents</summary>

- In a subagent with `isolation: "worktree"`, `$.session.cwd()` gives `<root>/.claude/worktrees/<name>`, and `$.session.root()` gives `<root>` (**measured**).
  The module uses the worktree as the project of the subagent.
- A `WorktreeCreate` hook can put the worktree outside `<root>`.
  Then `$.session.cwd()` gives that folder (**measured**, 2.1.288), and the module uses it as the project.
- The cwd follows a `cd`, so the module keeps the first cwd of the subagent in a worktree as its project.
- In 2.1.287, a mod `tool.call` hook that matches Bash made each Bash call in an `isolation: "worktree"` subagent fail.
  This happened even when the hook only called `next(e)`.
  The error was "The working-directory isolation context for this agent was lost" (**measured**, 4 of 4 calls).
- The mod runs in a worker host, so the tool runs outside the cwd store of the agent (**binary**, 2.1.287).
- 2.1.288 fixed it (**official**, release notes).
  The note says: "Fixed a plugin's `tool.call` hook making Bash fail and file searches read the wrong folder in subagents that run in a worktree".
  On 2.1.288, 0 calls failed (**measured**).
- dotclaude required 2.1.288 for this reason, and 0.27.0 requires 2.1.292.

</details>

<details>
<summary>Environment, notifications, and fork</summary>

- `$.env.get` reads the environment of the Claude Code process (**binary**, 2.1.288).
- The `Notification` input for an `AskUserQuestion` dialog is `permission_prompt` with the message "Claude needs your permission" and no tool name (**measured**, 2.1.288).
  So only state that the module writes can tell it from a permission dialog.
  0.19 used this for permission reminders, and 0.20.0 removed them.
- After `--continue`, the first `$.model.fork` gives `nothing-to-fork`, and a fork after the next turn works (**measured**, 2.1.288).
- The API can change in each release: "this surface may change between releases without notice" (**official**, d.ts header).
  Each dotclaude release names one Claude Code version.

</details>

## Related pages

- [Prompt hooks on Stop](Stop-Prompt-Hooks) has the 0.26 evidence for a prompt hook on `Stop`.
- [Parts](Parts) lists what the module does.
- [Guards](Guards) tells how the guards ask and deny.
- [Design](Design) gives the design principles.
