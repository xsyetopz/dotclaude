---
name: write-session-handoff
description: Write a handoff note that lets a fresh Claude Code session continue the current task without this conversation, covering the goal, verified state, decisions and rejected approaches, open items, and hard-to-rebuild details. Use it whenever the user wants to hand off, wrap up for a new session, start fresh, save progress before /clear or /compact, pause work to resume later, or asks "what would a new session need to know", even when they do not say "handoff".
argument-hint: "[output path, default .claude/handoff.md]"
---

# Write a handoff note

A fresh session reads this note instead of the conversation, so it has to carry what the conversation knows and the repository does not. Write it to `$ARGUMENTS`, or to `.claude/handoff.md` when no path was given. If the file already exists, overwrite it; the previous handoff is stale.

Gather facts before writing: run `git status --short`, `git diff --stat HEAD`, and `git log --oneline -10`, and check which test or build commands ran in this session and their last result. Write only what you verified or what the user said; mark anything you are unsure of as unverified.

Use these sections, in this order, and skip a section only when it is truly empty:

1. **Goal**: the user's request in their own words, plus any constraints they added later, quoted exactly.
2. **State**: what is done, with file paths, and whether each part is verified (name the command and its result) or not.
3. **Decisions**: choices made and the reason for each, including options that were tried or rejected and why, so the next session does not retry them.
4. **Open**: remaining steps in order, and anything blocked with what it is blocked on.
5. **Details that are hard to rebuild**: exact error messages, commands, IDs, versions, and file:line locations the next session would otherwise have to rediscover.

Keep it under about 80 lines, and give file paths rather than pasted file contents. Then tell the user the path you wrote, and that a new session can start with "Read <path> and continue." If that file is inside the repository and not ignored by git, mention that they may want to add it to `.gitignore`, since a handoff note describes one session and does not belong in the project history.
