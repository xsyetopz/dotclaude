# Quickstart

This page shows what you see in your first session with dotclaude.
It assumes that you finished [Install](Install).

## What you see at session start

| What | When |
| --- | --- |
| Status line | After `/dotclaude:setup`. It shows model, effort, context against the compaction point, cache expiry, and usage limits. |
| Setup notice | At startup, when your setup differs from the profile of the plugin version. |
| Terms of Use and working rules | Claude gets them as context. You do not see them. |

The setup notice has this form:

```text
dotclaude 0.22.2: your setup differs from the profile in 2 settings.
Run /dotclaude:setup to see and apply the changes.
```

The Terms of Use say that you accepted each clause, and that Claude must follow each one.
A clause with a hook is enforced.
See [Terms of Use](Terms-of-Use).

## What happens in a session

### A guard asks

Claude plans `rm -r` on a folder outside the project.
The Bash guard asks you first and gives the reason, for example `The target is outside the project.`
You decide.
Hooks never approve a command for you.
See [Guards](Guards).

### A test edit asks

Claude edits a test file and removes an assertion.
The edit guard asks, for example `The edit removes 1 assertion(s) from the test file a.test.mjs.`
It asks the same way when an edit adds a `skip`, `xfail`, `todo`, or focus marker.

### A secret is redacted

A tool output has a secret.
Claude sees `[REDACTED:<rule>]` in its place.
This needs `betterleaks` on `PATH`.

### A handoff note before compaction

Before an automatic compaction, dotclaude forks a handoff note into `.claude/handoffs/`.
Claude then stops and tells you to run `/clear`.
The next session gets a pointer to the newest open note.
You can write a note yourself with `/dotclaude:handoff`.
See [Handoffs](Handoffs).

### A cold cache note

You resume a session after the prompt cache expired, and the context is large.
Claude tells you in its first reply that the next prompt writes the context to the cache again.
Run `/clear` instead when the task is done.

## Next steps

- [Guards](Guards): see what the guards ask about.
- [Handoffs](Handoffs): carry work across `/clear`.
- [Options](Options): turn each part on or off.
