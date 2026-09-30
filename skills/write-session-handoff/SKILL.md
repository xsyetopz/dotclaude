---
name: write-session-handoff
description: Write a handoff note so that a fresh session can continue the current task. Use when the user wants to hand off, start fresh, or pause, or to save progress before `/clear` or `/compact`.
argument-hint: "[output path, default .claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md]"
---

<procedure>
1. Gather facts before you write: run `git status --short`, `git diff --stat HEAD`, `git log --oneline -10`, and `git rev-parse --abbrev-ref HEAD`. Check which test or build commands ran in this session, and their last result.
2. Write only what you verified or what the user said. Mark anything you are unsure of as unverified, because the next session will treat the note as fact.
3. Separate this session's changes from the user's: list as done only the files this session or its subagents edited. Name other uncommitted changes as the user's work.
</procedure>

<header>
Start the note with this front matter, so the next session and dotclaude can read the state without the prose:

```yaml
---
status: in-progress # or blocked, done, or superseded
branch: <current branch>
head: <short sha of HEAD>
written: <UTC time, ISO 8601>
---
```

Set `status: done` only when nothing in **Open** remains. Set `status: superseded` on an earlier open note when a newer note continues its work. dotclaude points new sessions only at notes with `in-progress` or `blocked`.
</header>

<sections>
Use these sections in this order. Skip a section only when it is truly empty:

1. **Goal**: the user's request in their own words, plus any constraints they added later, quoted exactly. End with a **Done when** line: the observable result that finishes the task, such as a passing command.
2. **State**: what is done, with file paths, and whether each part is verified (name the command and its result) or not. Flag partial work as partial: a file left mid-edit, an interrupted command, a background job still running. The next session otherwise takes it as complete.
3. **Decisions**: choices made and the reason for each, including options tried or rejected and why, so the next session does not retry them. When a later decision replaced an earlier one, give the later one and say which one it replaced.
4. **Open**: remaining steps in order, each request from the user that is not started, and each blocked item with what blocks it. Include each question that waits for the user's answer, and each thing you told the user you would do.
5. **Details that are hard to rebuild**: exact error messages, commands, IDs, versions, and `file:line` locations the next session would otherwise have to rediscover.
</sections>

<output_format>
Keep the note under about 80 lines. Give file paths, not pasted file contents. Tell the user the path you wrote. Tell them a new session can start with `Read <path>, check it against the repository, and continue`. A handoff note describes one session and does not belong in the project history. dotclaude adds `.claude/handoffs/` to `.git/info/exclude` itself. For a different path inside the repository that git does not ignore (`git check-ignore -q <path>` exits 1), add the path to `.git/info/exclude`, not to `.gitignore`, because `.gitignore` is a tracked project file. Tell the user that you added it.
</output_format>

<task>
Write a handoff note that a fresh session reads instead of this conversation. It must carry what the conversation knows and the repository does not. Write it to `$ARGUMENTS`, or, when the user gives no path, to a new file `.claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md`. Use the UTC time and a topic of two to four lowercase words joined by hyphens, so the names sort by time and show the work. Keep earlier notes, because they record other work. When an earlier note in `.claude/handoffs/` covers the same work and is still `in-progress` or `blocked`, carry its open items into the new note and set its `status` to `superseded`.
</task>
