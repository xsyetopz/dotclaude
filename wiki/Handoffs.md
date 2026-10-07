# Handoffs

A handoff note saves the state of a task, so that a fresh session continues from it after `/clear`.
A new session starts with a small context, and a long session costs more on each turn.
Since 0.27 you start a handoff yourself.
No hook writes a note, and no hook tells you to run `/clear`.

## How it works

| Part | What it does |
| --- | --- |
| Note file | A Markdown file at `.claude/handoffs/<slug>.md`. A new note with the same slug replaces the earlier note. |
| `/dotclaude:handoff` | The skill that writes a note on request. Its arguments are `[slug] \| --list \| --rm <slug>`. |
| [OpenSpec](OpenSpec) | Holds the task list. The note names the change and does not copy its tasks. |
| Status line | Shows the context against the 300K window, in yellow at 75% and red at 90%, so that you know when to write a note. |

A note has this front matter:

```yaml
---
status: in-progress # or blocked, or done
branch: <current branch>
head: <short sha of HEAD>
written: <time>
openspec: <change id, when there is one>
---
```

The sections are **Goal** (with a `Done when` line), **Decisions**, **Rejected**, **Items**, **Files**, and **Next**.
The note stays under about 60 lines.

## Write a note

1. Run the skill.
   Give a slug when you want a name of your own.

   ```text
   /dotclaude:handoff
   ```

1. Claude writes the note and tells you the path.
1. If git tracks the path, Claude advises you to add it to `.git/info/exclude`.
1. Claude gives a prompt for the new session.
   The prompt ends with `@<absolute path>`.
   When the work has an OpenSpec change, the prompt starts with `/opsx:apply <id>`.

Run `/dotclaude:handoff --list` to list the notes, and `/dotclaude:handoff --rm <slug>` to remove one.

## Continue from a note

1. Run `/clear`.
1. Send the prompt that Claude gave you.
1. Claude reads the note and compares it with the repository.
   Where they differ, the repository is correct.

## Built-in commands that help

| Command | Use |
| --- | --- |
| `/clear` | Start a fresh session. This is the usual step after a note. |
| `/resume` | Return to an earlier session. |
| `/rewind` | Go back to an earlier point in the session. |
| `/btw` | Ask a short side question without adding it to the context. |
| `/export` | Save the conversation to a file. |

`/compact` is off, because the profile sets `DISABLE_COMPACT=1`.
At the limit the session stops, and `/clear` plus a note is the way on.

> **Warning:** Do not write secrets in a note.

## Related pages

- [OpenSpec](OpenSpec)
- [Parts](Parts)
- [Quickstart](Quickstart)
