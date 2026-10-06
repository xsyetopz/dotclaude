# Claude Mods

This page answers one question: what does Claude Code let a plugin hooks module do, and which parts does dotclaude use?
It is the evidence for the hooks module of Claude Code 2.1.288.

## Summary

- Claude Code 2.1.287 and later can load a plugin "hooks module".
  Anthropic calls a plugin with such a module a mod.
- dotclaude 0.22.2 uses the module in `plugins/dotclaude/hooks/module/index.mjs` for `tool.call`, `agent.spawn`, `prompt.submit`, `turn.complete`, `session.compact`, and `tool.check`.
- It no longer uses the module for model-switch, config-change, or session-ledger hooks.
  The rows and gaps that name other events are 0.19 evidence, and each says so.
- The module gets no permission mode, and in auto mode the classifier can allow an ask of `tool.check`.
  So the guards also have a classic `PreToolUse` hook.
- The API is early access, so each dotclaude release names one Claude Code version.
- [Parts](Parts) lists what the module does.

Labels: **official** (Anthropic docs and files), **binary** (the Claude Code bundle), **measured** (a run on this machine).

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
So dotclaude uses only native events.

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
  So a dotclaude module runs before the dotclaude classic hooks.
- `sec-default` is outermost, unless managed `prependPlugins` changes the order (**official**, `mods/README.md`).

## Events that dotclaude uses

| Work | Event | Evidence |
| --- | --- | --- |
| Guards, secret redaction, CodeGraph notes | `tool.call` | A failed call returns `{ isError, result, text, ref, context }`, and `text` is what the model reads (**binary**). |
| Keep an ask of the guards | `tool.check` | The hook returns the ask of the guard unless the engine denies (`plugins/dotclaude/hooks/module/index.mjs`). |
| Spawn rules | `agent.spawn` | A `{ deny }` result refuses the spawn with a reason (`plugins/dotclaude/hooks/module/index.mjs`). |
| Cold-cache note | `prompt.submit`, `turn.complete` | A hook attaches context "on the way down", in the input to `next` (**official**, d.ts). `turn.complete` stores the time of the last turn. |
| Compaction instruction and handoff fork | `session.compact` | A `precompute` installs nothing, and the real compaction fires the event again (**official**, d.ts). The fork runs before `next`, so it sees the whole conversation. |

- The guards also have a classic `PreToolUse` hook, because a module ask does not hold in auto mode (see [Gaps](#gaps)).
- `SessionStart` stays a classic command hook, because `session.start` does not fire after `/clear`, `/resume`, or a compaction, and it cannot add context (**official**, d.ts).

## Events that 0.19 used

0.19 also used these events, and 0.20.0 removed each use.

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
| No permission mode in the module | The guards also run as a classic hook. |
| The auto-mode classifier can allow an ask of `tool.check` | `ask-guarded-calls.mjs` gives the asks again. |
| A classic `allow` is dropped | Matters only for `Agent` and `SendMessage`. |
| An action that throws is skipped, with no log | The module catches errors. |
| `$.fs.write` is not atomic | The module cannot write a file atomically. |
| `$.session.cwd()` differs in a worktree | The module keeps the first cwd as the project. |
| The `Notification` input of an `AskUserQuestion` dialog looks like a permission dialog | 0.20.0 removed permission reminders. |
| `$.model.fork` fails after `--continue` | The first fork gives `nothing-to-fork`. |

<details>
<summary>Permission mode and the auto-mode classifier</summary>

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
- dotclaude required 2.1.288 for this reason, and the README now requires 2.1.291.

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

## Prompt hooks on Stop

dotclaude uses a classic hook with `"type": "prompt"` on `Stop` for clause 18.
0.26.0 removed the same hook on `SubagentStop`, because each call sends the transcript, about 46k tokens in the mean.
These facts are from the Claude Code 2.1.292 binary (**binary**), read only:

- Claude Code sends the hook `prompt` as a condition, after the words "has the following stopping condition been satisfied? Answer based on transcript evidence only."
  Stop and SubagentStop get their own system prompt for this.
- The model is the hook `model` field, else `ANTHROPIC_SMALL_FAST_MODEL`, else Haiku in most setups.
- The default timeout is 30 seconds.
- The answer schema is `ok`, `reason`, and `impossible`, and `ok` and `reason` are required.
  An `ok: false` answer on Stop or SubagentStop blocks, and Claude gets the reason and continues.
  With `impossible: true`, the stop goes through.
- The next stop in the turn has `stop_hook_active: true`.
- A timeout, an API error, invalid JSON, or a schema failure does not block, so the hook fails open.
- Claude Code ends the turn after 8 consecutive blocks from Stop hooks, and shows a warning.
  `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes the cap, and a value of 0 or less removes it.
- Each query loop keeps its own count of blocks, and a subagent runs its own loop.
  The count goes back to 0 when Claude calls a tool.
  At the cap, Claude Code shows the warning only for the main agent.

These facts are from live tests of 2.1.292 in `just sandbox` with Haiku 4.5 (**tested**):

- A `"type": "prompt"` hook in a plugin `hooks.json` runs on Stop and on SubagentStop.
  The 2.1.0 changelog added prompt hooks from plugins.
  The bug in [issue #13155](https://github.com/anthropics/claude-code/issues/13155) does not occur on 2.1.292.
- The evaluator model is `claude-haiku-4-5`.
  It gets the transcript, and `$ARGUMENTS` in the prompt becomes the hook input JSON.
- On a block, Claude gets `Stop hook feedback:`, then the full hook prompt in square brackets, then the `reason`.
  The prompt in this text has `$ARGUMENTS`, not the hook input.
  Thus a long prompt adds its full length to the context at each block, and Claude reads each rule of the prompt, also the rules that let a message through.
  Keep the prompt short, and write it as a rule that Claude can read.
- The model writes its own `reason`, and does not copy a sample reason from the prompt.
- A SubagentStop hook that always blocks blocked a subagent 8 times.
  At the 9th block, the subagent ended, and the main agent got no warning.
  The main agent had no block before, so the test does not show that the two counts are separate.
- The clause 18 prompt has about 1,150 characters.
  In one run of each of 7 sample reports, it gave the correct result for 6:
  - It let through a report that skipped a step at the request of the user.
  - It let through a report with a passing check, and a report with a **Not verified** list.
  - It blocked a report that called a fix done, apart from a flaky test.
  - It blocked a report that called a slice done with 1 failed test from another agent.
  - It blocked a report that called a fix done and also put the fix under **Not verified**.
  - It blocked an open item that "may already be done", although the prompt lets such an item through.
    The rule to block when the model is not sure is the probable cause.
- At the next stop, `stop_hook_active` was `true`, and the hook let the stop through.

The [hooks doc](https://code.claude.com/docs/en/hooks) says that the count goes back to 0 at each tool call.
The [environment variables doc](https://code.claude.com/docs/en/env-vars) says that the cap applies to Stop and SubagentStop hooks.

## Related pages

- [Parts](Parts) lists what the module does.
- [Guards](Guards) tells how the guards ask and deny.
- [Design](Design) gives the design principles.
