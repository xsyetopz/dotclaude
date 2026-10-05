---
name: handoff
description: Writes a handoff note so a fresh session can continue the task. Use when the user wants to hand off, pause, or save progress before `/clear` or `/compact`.
argument-hint: "[output path, default .claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md]"
---

<procedure>
1. Collect the facts before you write.
   Run `git status --short`, `git diff --stat HEAD`, `git log --oneline -10`, and `git rev-parse --abbrev-ref HEAD`.
   Find which test or build commands ran in this session, and their last result.
1. Write only what you verified or what the user said.
   Mark each item that you are not sure of as unverified, because the next session reads the note as fact.
1. List as done only the files that this session or its subagents edited.
   Before you name an uncommitted or untracked file as the user's work, look for an `Edit` or `Write` call or a command of this session that changed it.
   Name it as the user's work only when you find no such call, because the next session repeats the note as fact.
   When you cannot tell, mark the file as unverified.
</procedure>

<header>
Start the note with this front matter, so the next session can read the state without the prose:

```yaml
---
status: in-progress # or blocked, done, or superseded
branch: <current branch>
head: <short sha of HEAD>
written: <UTC time, ISO 8601>
---
```

Set `status: done` only when **Open** is empty.
When a newer note continues the work of an earlier open note, set the earlier note to `status: superseded`.
A new session continues only from a note with `in-progress` or `blocked`.
</header>

<sections>
Use these sections in this order.
Skip a section only when it has no content:

1. **Goal**: the user's request in their own words, and each constraint that they added later, quoted exactly.
   End with a **Done when** line: the observable result that completes the task, such as a passing command.
1. **State**: what is done, with file paths, and if each part is verified (name the command and its result) or not.
   Mark partial work as partial: a file left mid-edit, an interrupted command, a background job that still runs.
   Otherwise the next session takes it as complete.
1. **Decisions**: each choice and its reason, with the options tried or rejected and why, so the next session does not try them again.
   When a later decision replaced an earlier one, give the later one and name the one that it replaced.
1. **Open**: the remaining steps in order, each request from the user that is not started, and each blocked item with its blocker.
   Include each question that waits for the user's answer, and each thing that you told the user you would do.
1. **Details that are hard to rebuild**: exact error messages, commands, IDs, versions, and `file:line` locations that the next session would otherwise find again.
</sections>

<output_format>
Keep the note under about 80 lines.
Give file paths, not pasted file contents.
Tell the user the path.
Then give a short prompt for the new session, in the same reply.
The prompt names the next step and the note as `@` and its absolute path, so that Claude Code reads the note at once.
When the path has a space, put it in quotes, as in `@"/a b/n.md"`, because a space ends a bare `@` path.
Write the prompt for this task, and do not copy a fixed text.
A handoff note describes one session, so it stays out of the project history.
When the note path is not ignored by git (`git check-ignore -q <path>` exits 1), add the path to `.git/info/exclude`.
Use that file and not `.gitignore`, because `.gitignore` is a tracked project file.
Tell the user that you added it.
</output_format>

<task>
Write a handoff note that a fresh session reads in place of this conversation.
It carries what the conversation knows and the repository does not.
Write it to `$ARGUMENTS`, or, when the user gives no path, to a new file `.claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md`.
Use the UTC time and a topic of two to four lowercase words joined by hyphens, so the names sort by time and show the work.
Keep the earlier notes, because they record other work.
An earlier note in `.claude/handoffs/` can cover the same work and still be `in-progress` or `blocked`.
Then copy its open items into the new note and set its `status` to `superseded`.
</task>
