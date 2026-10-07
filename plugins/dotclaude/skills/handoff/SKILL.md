---
name: handoff
description: Writes a handoff note so a fresh session can continue the task, and reads a note to continue earlier work. Use when the user wants to hand off, pause, or save progress before `/clear` or `/compact`, at a task boundary with open work, or when the user asks to continue earlier work.
argument-hint: "[output path, default .claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md]"
---

<continue>
When the user asks to continue earlier work, read the handoff note first.
Then compare it with `git status` and `git log --oneline -5` before you act, because later commits and edits make parts of a note stale.
Where they differ, the repository is correct.
</continue>

<write>
Write the note to `$ARGUMENTS`, or to a new `.claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md` with the UTC time and a topic of two to four lowercase words.
First run `git status --short`, `git diff --stat HEAD`, `git log --oneline -5`, and `git rev-parse --abbrev-ref HEAD`.
Write only what you verified or what the user said, and mark each other item as unverified, because the next session reads the note as fact.
Name a changed file as the work of the user only when no call of this session changed it.
Start with this front matter:

```yaml
---
status: in-progress # or blocked, done, or superseded
branch: <current branch>
head: <short sha of HEAD>
written: <UTC time, ISO 8601>
---
```

Then use these sections, and skip a section only when it is empty:

1. **Goal**: the request of the user and each later constraint, quoted exactly.
   End with a **Done when** line: the observable result that completes the task.
1. **State**: what is done, with file paths and the check that passed for each part.
   Mark partial work (a file left mid-edit, a background job), because the next session takes the rest as complete.
1. **Decisions**: each choice with its reason, and the rejected options with theirs.
1. **Open**: the remaining steps in order, with each question that waits for the user.
   Give each item its reason and its owner: the user or the next session.
   Do an item that was open in an earlier note, or ask the user about it, because an item with no decision never closes.
1. **Details**: exact errors, commands, IDs, and `file:line` locations that are hard to find again.

Keep the note under about 80 lines, with file paths and not file contents.
</write>

<close>
Set `status: done` only when **Open** is empty.
When the note continues an earlier note that is `in-progress` or `blocked`, copy its open items and set its status to `superseded`.
When `git check-ignore -q <path>` exits 1, add the path to `.git/info/exclude` and not to `.gitignore`, because `.gitignore` is a tracked file, and tell the user.
Then give the path and a short prompt for the session after `/clear`.
The prompt names the next step and the note as `@` and its absolute path, in quotes when the path has a space.
</close>
