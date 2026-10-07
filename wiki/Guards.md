# Guards

Since 0.27 dotclaude guards a session with four layers.
Permission rules in the settings profile do most of the work.
The sandbox limits what a command can reach.
One hooks module covers the two cases that a rule cannot match.
In auto mode, one classic hook gives the same asks, because the auto-mode classifier decides an ask of the module.
This page lists each layer, what to do when one fires, and how to change one.

## The layers

| Layer | Where it lives | What it does |
| --- | --- | --- |
| Permission rules | `templates/settings.json`, applied by `/dotclaude:setup` | Deny, ask, and allow lists for tools and commands. |
| Sandbox | `sandbox` in the same profile | Runs Bash commands in the Claude Code sandbox, with a list of allowed domains. |
| Module guard | `hooks/mod.mjs`, with pure rules in `lib/guard.mjs` | One `tool.check` handler for a recursive `rm` outside the project and for the policy ask. |
| Auto-mode guard | `hooks/auto-mode-guard.mjs`, with the same rules in `lib/guard.mjs` | A classic `PreToolUse` hook that gives the same asks in auto mode only. |

Deny rules are not a security boundary on their own, so the profile pairs them with the sandbox ([Design](Design)).

## Permission rules

| List | What it holds |
| --- | --- |
| deny | Reads of secret files, `rm -rf` of `/`, `/*`, `~`, and `~/*`, `mkfs`, `dd` to a device, and the `Agent(general-purpose)` agent. |
| ask | Force pushes, `git reset --hard`, `git clean`, `git branch -D`, `git checkout --`, `git restore`, piped shells, `sudo`, publishes, `gh pr` and `gh issue` writes, `gh release`, and SQL drops and truncates. |
| allow | Read-only `git` and `gh` commands, and the build and test runners (`bun`, `npm`, `pnpm`, `cargo`, `go`, `just`, `make`). |

The profile also sets `disableBypassPermissionsMode`, so no mode skips these rules.
The exact patterns are in `plugins/dotclaude/templates/settings.json`.

## The sandbox

The profile sets `sandbox.enabled` and `allowUnsandboxedCommands: false`.
A command that fails in the sandbox does not retry outside it.
These commands run outside the sandbox, because they need your credentials and the network: `git fetch`, `git pull`, `git push`, and `gh`.
`allowedDomains` lists GitHub, npm, PyPI, crates.io, and `proxy.golang.org`.

The optional managed settings add `sandbox.failIfUnavailable`, `disableBypassPermissionsMode`, and the deny list at system level.
The setup skill prints the `sudo` command for them and never runs it.

## The module guard

`hooks/mod.mjs` registers one `tool.check` handler.
It calls the engine first, and it returns a deny of the engine unchanged.

| Case | What the module does |
| --- | --- |
| `rm` with a recursive flag, and a target outside the project root | Asks, and names the target. A target in the project, in `/tmp`, in `/private/tmp`, or in `$TMPDIR` keeps the verdict. A target with `$` or a backtick counts as outside. |
| `git clone`, `gh`, `curl`, `wget`, or a `WebFetch` of a repository of another owner that has `CLAUDE.md`, `AGENTS.md`, or `AI_POLICY.md` | Asks once per session and per repository, and shows the policy text. See [Contributions](Contributions). |

The module has no `.catch`, so it fails open.
When `gh` is missing or a call fails, the verdict of the engine stands.
A call for the policy has a 5-second timeout.

The tests of the module are in `plugins/dotclaude/tests/mod.test.ts`, and `just lab` runs them with stubbed events.
No command runs in them.
See [Development](Development).

## The auto-mode guard

In auto mode, the classifier decides an ask of `tool.check`, and it can allow the call.
An ask of a classic `PreToolUse` hook stops the call in auto mode (**measured**, 2.1.292, see [Claude mods](Claude-Mods#auto-mode-module-ask-against-classic-ask)).
So `hooks/auto-mode-guard.mjs` runs the same rules from a classic hook.

- It acts only when the `permission_mode` of the hook input is `auto`.
  In each other mode it gives no output, so you see one ask, not two.
- `hooks.json` gives it 7 Bash handlers with an `if` filter each: `rm`, `sudo`, `xargs`, `gh`, `git clone`, `curl`, and `wget`.
  A filter keeps Claude Code from starting a process for other commands.
  It also has one handler for `WebFetch`.
- It keeps the repositories that it checked in a state file for each session, under `${CLAUDE_PLUGIN_DATA}/auto-mode-guard/`, or the temp folder when that variable is not set.
  So the policy ask comes once per session and per repository, as in the module.
- It fails open: an error gives no output.
- An `if` filter matches the start of the command.
  `xargs rm` and `sudo rm` have their own handlers, but a recursive `rm` in other forms, such as after `env` or in a subshell, can pass the filter.
  The auto-mode classifier then decides the call.

The 5 tests of the script are in `tests/dotclaude/auto-mode-guard.test.mjs`, with commands as strings.

Auto mode ignores some allow rules of the profile, because they would bypass the classifier: `Bash(bun run *)`, `Bash(npm run *)`, and `Bash(pnpm run *)` (**measured**, debug log).
In auto mode the classifier decides those commands.

> **Note:** The two plugins that you can add, [Browser](Browser) and [Second opinion](Second-Opinion), add no guard.
> The Jev hook only adds a pick to a question.
> The modder plugin has a hook that denies a kill by process name ([Modder](Modder)).

## What to do when a call is denied

A deny is a decision of you.
Claude must not get the same result in another way.

1. Read the reason in the deny message.
1. Change the call so that it follows the rule.
1. If the rule is wrong for your project, change the profile in your settings file and run `/dotclaude:setup` to see the difference.

## What to do when a call asks

1. Read the reason.
1. Choose to allow or reject the call.
1. For the policy ask, read the policy that the prompt shows before you allow.
   If the policy forbids AI tools, reject the call.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No ask for a recursive `rm` outside the project | Claude Code did not load the module, for example in `--bare` mode. | Start Claude Code without that mode. |
| No ask for a recursive `rm` in auto mode | The command does not start with a word that an `if` filter of the auto-mode guard matches, or `node` is not on `PATH`. | Install Node.js 22.18 or later, or use the default mode for that work. |
| No policy ask for a project | The project has no policy file, belongs to you, or is not on GitHub. `gh` can also be missing or logged out. | None for the first three. For the last, install `gh` and log in. |
| A `git push` fails in the sandbox | The push runs outside the sandbox. The profile excludes it. | Check your git credentials. |

## Related pages

- [Parts](Parts)
- [Claude mods](Claude-Mods)
- [Design](Design)
