---
name: handoff
description: Writes a handoff note that primes a fresh session after `/clear`, or lists and removes notes.
disable-model-invocation: true
argument-hint: "[slug] | --list | --rm <slug>"
allowed-tools: Bash(git status*) Bash(git diff --stat*) Bash(git log --oneline*) Bash(git rev-parse*) Bash(git check-ignore*) Bash(ls *.claude/handoffs*)
---

<task>
Compaction is off, so `/clear` is the reset, and this note is what the next session knows.
Write it as a prime for the next session, not as a summary of this one:
the next session needs the goal, the constraints, the decisions, and the proof, not the story.
</task>

<arguments>
Read `$ARGUMENTS`:

- `--list`: list `.claude/handoffs/*.md` with the `status` and `written` lines of each note, then stop.
- `--rm <slug>`: delete `.claude/handoffs/<slug>.md` with the permission prompt, then stop.
- `<slug>`: write `.claude/handoffs/<slug>.md`.
- empty: write the note with a slug of two to four lowercase words that name the task.

A second note with the same slug replaces the first, so the notes do not pile up.
</arguments>

<write>
First run `git status --short`, `git diff --stat HEAD`, `git log --oneline -5`, and `git rev-parse --abbrev-ref HEAD`.
Write only what you verified in this session or what the user said.
Mark each other item as unverified, because the next session reads the note as fact.
A file is the work of the user when no call of this session changed it.

When `openspec/changes/<id>/tasks.md` exists for the task, name the change id.
Do not copy its tasks, because `tasks.md` holds their status and `/opsx:apply` continues from the first open task.
Then the note holds only what `tasks.md` does not: constraints, decisions, rejected approaches, and proof commands.

Start with this front matter:

```yaml
---
status: in-progress # or blocked, done
branch: <current branch>
head: <short sha of HEAD>
written: <UTC time, ISO 8601>
openspec: <change id, or none>
---
```

Then use these sections, and leave out a section only when it is empty:

1. **Goal**: the request of the user, quoted exactly, and each later constraint of the user.
   End with **Done when**: the check that proves the task is complete.
1. **Decisions**: each choice with its reason.
1. **Rejected**: each approach that was tried or considered and dropped, with the reason, so that the next session does not try it again.
1. **Items**: each part of the work with its status and the command that proves it.
   A status of done needs that command and its result from this session.
   Mark partial work, such as a file left mid-edit or a background job.
1. **Files**: the files that this session changed.
1. **Next**: the next step, and each question that waits for the user, with its owner.

Keep the note under about 60 lines.
Give file paths and `file:line` locations, not file contents.
</write>

<close>
When `git check-ignore -q .claude/handoffs/<slug>.md` exits 1, tell the user that git tracks the note, and that `.git/info/exclude` can ignore it.
Then give the note path, and a prompt for the session after `/clear` that names the next step and ends with `@` and the absolute path of the note.
With an OpenSpec change, the prompt starts with `/opsx:apply <id>`.
</close>
