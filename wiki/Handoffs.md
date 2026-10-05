# Handoffs

A handoff note saves the state of a task, so that a fresh session continues from it after `/clear`.
A new session starts with a small context, and a long session costs more on each turn.

## How it works

| Part | What it does |
| --- | --- |
| Note file | A Markdown file in `.claude/handoffs/`, named `<YYYY-MM-DD-HHMM>-<topic>.md` with a UTC time. |
| `/dotclaude:handoff` | The skill that writes a note on request. |
| Compaction handoff | Before an automatic compaction, a fork of the conversation writes a note named `<time>-compaction.md`. Claude then stops and tells you to run `/clear`. |
| Handoff pointer | At session start, a hook points Claude to the newest note with `status: in-progress`. |
| Progress files | Each subagent writes its steps to a file, so that its work survives a turn limit. |

A note has this front matter:

```yaml
---
status: in-progress # or blocked, done, or superseded
branch: <current branch>
head: <short sha of HEAD>
written: <UTC time, ISO 8601>
---
```

A new session continues only from a note with `in-progress` or `blocked`.
The compaction note has only `status` and `written`.

## Write a note

1. Run the skill.
   Add a path when you want a different file.

   ```text
   /dotclaude:handoff
   ```

1. Claude collects the facts with `git status --short`, `git diff --stat HEAD`, `git log --oneline -10`, and `git rev-parse --abbrev-ref HEAD`.
1. Claude writes the sections **Goal**, **State**, **Decisions**, **Open**, and **Details that are hard to rebuild**.
   It marks each unverified item and keeps the note under about 80 lines.
1. Claude tells you the path and gives a prompt for the new session.
   The prompt names the next step and the note as `@` and its absolute path.
   A path with a space goes in quotes, as in `@"/a b/n.md"`.
1. If git does not ignore the path, Claude adds it to `.git/info/exclude` and tells you.

## Continue from a note

1. Run `/clear`.
1. Send the prompt that Claude gave you.
   For example:

   ```text
   Continue the task in @/path/to/project/.claude/handoffs/2026-10-04-0213-compaction.md
   ```

1. Claude reads the note and compares it with `git status` and `git log --oneline -5`.
   Where they differ, the repository is correct.

## Mark a note done

1. Check the **Open** section of the note.
1. Set `status` by this rule:

   | Open section | Status |
   | --- | --- |
   | Empty | `done` |
   | Items copied into a newer note | `superseded` |
   | Items remain | `in-progress` |

Claude sets `superseded` on the earlier note when it writes a newer note for the same work.
The compaction hook also sets `superseded` on the earlier compaction note of the same session.

## Compaction flow

1. The context fills, and Claude Code starts an automatic compaction.
1. A fork of the conversation writes a note to `.claude/handoffs/`.
1. The compaction runs, with a rule that keeps an unapproved plan or an open question open.
1. Claude uses no tool, tells you the path, and stops.
1. You run `/clear` and send the prompt that Claude wrote.

A manual `/compact` writes no note, because you chose to continue in the same session.
Set the option `compaction_handoff` to `false` to turn the note off ([Options](Options)).

## Progress files of subagents

Claude Code delivers no report from a subagent that stops at its turn limit.
Each subagent adds one line after each step to `dotclaude-progress/<agent ID>.md` in the temporary folder.
When an agent stops at its limit, the main agent reads the file and sends the next step with `SendMessage`.
This is clause 15 of the [Terms of Use](Terms-of-Use).

```bash
echo 'done: <step> | next: <step>' >> <progress file>
```

> **Warning:** Do not write secrets in a note or a progress file.

## Related pages

- [Options](Options)
- [Parts](Parts)
- [Terms of Use](Terms-of-Use)
- [Quickstart](Quickstart)
