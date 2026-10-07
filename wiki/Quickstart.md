# Quickstart

This page shows what you see in your first session with dotclaude.
It assumes that you finished [Install](Install).

## What you see at session start

| What | When |
| --- | --- |
| Status line | After `/dotclaude:setup`. It shows model, effort, context against the 300K window, the OpenSpec change, and the 5-hour limit. |
| Output style | Always. The plugin forces the `dotclaude` style over the simple system prompt. You do not see it. |

The status line has this form, with parts joined by ` · `:

```text
Opus 5.5 xhigh · 84K/300K 28% · add-login 3/7 · 5h 41%
```

The context part turns yellow at 75% and red at 90% of the window.
The `5h` part uses the same colors.
The OpenSpec part shows the newest change with a `tasks.md` that is not archived, as `id done/total`.
The status line calls no model, no network, and no CLI.

## What happens in a session

### A permission rule asks

Claude plans a force push, a `git reset --hard`, a package publish, or a write to a pull request or an issue.
Claude Code asks you first, because the settings profile has an `ask` rule for it.
It denies a read of secrets and a `rm -rf` of the root or your home.
See [Guards](Guards).

### A recursive rm outside the project asks

Claude plans `rm -r` on a folder outside the project root.
The hooks module asks you first and names the target.
A target in the project, in `/tmp`, in `/private/tmp`, or in `$TMPDIR` goes on.
A target with `$` or a backtick counts as outside.
You decide.
The module never approves a command for you.

### A policy ask for a repository of another owner

Claude runs `git clone`, `gh`, `curl`, or `wget` on a repository of another owner, or fetches its page.
The repository has a `CLAUDE.md`, `AGENTS.md`, or `AI_POLICY.md`.
The module asks once per session and per repository, and it shows the policy text, cut at 2,000 characters.
See [Contributions](Contributions).

### The context limit

Compaction is off.
When the session reaches 300K tokens, it stops.
Write a note with `/dotclaude:handoff` before that, then run `/clear`.
No hook tells you to run `/clear`.
See [Handoffs](Handoffs).

## Next steps

- [Guards](Guards): see what asks, what denies, and what the sandbox does.
- [Handoffs](Handoffs): carry work across `/clear`.
- [OpenSpec](OpenSpec): keep the task list in a change.
