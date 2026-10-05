# Guards

A guard is a hook of dotclaude that checks a tool call and denies it, asks you about it, or adds a note to its result.
This page lists each guard, what to do when one fires, and how to turn one off.

## What each guard does

All guards are in the `dotclaude` plugin.
Clause numbers refer to the [Terms of Use](Terms-of-Use).

| Guard | Option | Event | What it does | Clause |
| --- | --- | --- | --- | --- |
| Bash guard | `guard_bash` | `tool.call`, `PreToolUse` | Asks before `git push --force` (and `--force-with-lease`), `git reset --hard`, `git clean -f`, `git checkout` or `git restore` of files, `git branch -D`, `rm -r` outside the project or of the project or home folder, `dd` to a device, `mkfs`, `chmod -R 777`, `sudo`, and a read of `.env`, SSH key, or AWS credential files. | 1 |
| Bash guard, side effects | `guard_bash` | `tool.call`, `PreToolUse` | Asks before a command that skips the git hooks (`--no-verify`, `git commit -n`, `core.hooksPath`, `HUSKY=0`, `LEFTHOOK=0`, `SKIP=`), a publish (`npm publish`, `cargo publish`, `docker push`, and similar, but not with `--dry-run`), a `gh` write (a verb that does not only read, or `gh api` with a method other than `GET` or with fields, but not a `gh api graphql` query without a mutation), and a database delete (`DROP`, `TRUNCATE`, `DELETE FROM`, `FLUSHALL`, `dropdb`, `prisma migrate reset`, `rails db:drop`, `manage.py flush`). It also reads the tool that `npx` or `bunx` runs. | 1 |
| Bash guard, attribution | `guard_bash` | `tool.call`, `PreToolUse` | Denies a Claude `Co-Authored-By` line in a commit when your settings leave it out. Asks before a Claude attribution line in a repository of another owner. | 3 |
| Bash guard, CodeGraph | `guard_bash` | `tool.call`, `PreToolUse` | Asks before `codegraph init` and `codegraph uninit`. | 12 |
| Edit guard | `guard_edit` | `tool.call`, `PreToolUse` | Asks before an edit that removes test assertions, adds a skip, `xfail`, `todo`, or focus marker to a test file, writes a `[REDACTED:` marker, or changes a generated file, a lockfile, or a Claude Code settings file. | 1 |
| Secret redaction | `guard_secrets` | `tool.call` | Replaces each secret in a tool result with `[REDACTED:<rule>]`. Needs `betterleaks` on `PATH`. | 1 |
| Policy guard | `guard_policy` | `PreToolUse`, `tool.call`, `SessionStart`, `SubagentStart` | Asks before the first call of a session that reaches a project of another owner with a `CLAUDE.md`, `AGENTS.md`, or `AI_POLICY.md` file. Shows the policy to Claude after a GitHub fetch. | 14 |
| Subagent guard | `guard_agents` | `agent.spawn` | Denies a subagent spawn that breaks the model and effort rules. | 1 |
| Sembr hook | `sembr` | `tool.call` | Rewraps the message of a `git commit`, `gh pr`, or `gh issue` command before it runs. Adds a note after a `Write` or `Edit` of prose that breaks at a column. Needs `sembr` on `PATH`. | 11 |
| CodeGraph augment | `codegraph` | `tool.call` | Adds callers and callees to a search for one symbol name. Does not deny or ask. | 8 |

> **Note:** The two plugins that you can add, [Browser](Browser) and [Second opinion](Second-Opinion), have no guard.
> The Jev hook only adds a pick to a question.
> It never denies a call.

The Bash guard reads each part of a command that `&&`, `||`, `;`, `|`, or a newline splits.
It also reads the script of `bash -c` and `sh -c` one level deep.
The rules are in `plugins/dotclaude/lib/guards/`.

## What to do when a guard denies a call

A deny is a decision of you.
Claude must not get the same result in another way.

1. Read the reason in the deny message.
   It names the clause.
1. Change the call so that it follows the rule.
   For example, remove the Claude trailer, or pick the model of the agent file.
1. If the rule is wrong for your project, turn the guard off (see below).

| Deny | Fix |
| --- | --- |
| Claude `Co-Authored-By` trailer when the settings leave it out | Remove the trailer from the commit message. |
| Subagent model differs from the agent file | Omit `model`, or pick the agent that has the model that you need. |
| Subagent model or effort outside the rules | Pick an allowed model and effort from [Parts](Parts#model-and-effort-rules). |

## What to do when a guard asks

An ask shows a prompt with the reason.
In auto mode, the classic `PreToolUse` hook keeps the ask, so you still see the prompt ([Claude mods](Claude-Mods)).

1. Read the reason.
   For the Bash guard it names the part of the command.
1. Choose to allow or reject the call.
1. For the policy guard, read the policy that the prompt shows before you allow.
   If the policy forbids AI tools, reject the call.

## Turn a guard off

Each guard has an option that is on by default.

1. Open `/config`.
1. Find `dotclaude` and set the option from the table above to `false`.
1. Start a new session.

See [Options](Options) for the full list.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Secrets are not redacted | `betterleaks` is not on `PATH`. The result passes through, and session start says so. | Install `betterleaks`. |
| Commit messages keep column breaks | `sembr` is not on `PATH`. | Install `sembr`. |
| No policy prompt for a project | The project has no policy file, belongs to you, or is on a host other than GitHub. | None. The guard covers GitHub fetches and local clones. |

## Related pages

- [Options](Options)
- [Terms of Use](Terms-of-Use)
- [Parts](Parts)
- [Claude mods](Claude-Mods)
