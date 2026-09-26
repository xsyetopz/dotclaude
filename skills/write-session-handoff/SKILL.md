---
name: write-session-handoff
description: Write a handoff note so a fresh session can continue the current task without this conversation. Use whenever the user wants to hand off, wrap up for a new session, start fresh, save progress before /clear or /compact, pause to resume later, or asks "what would a new session need to know", even without saying "handoff".
argument-hint: "[output path, default .claude/handoff.md]"
---

<task>
Write a handoff note that a fresh session reads instead of this conversation, so it must carry what the conversation knows and the repository does not. Write it to `$ARGUMENTS`, or to `.claude/handoff.md` when no path was given, overwriting any existing file, since the previous handoff is stale.
</task>

<procedure>
1. Gather facts before writing: run `git status --short`, `git diff --stat HEAD`, and `git log --oneline -10`, and check which test or build commands ran in this session and their last result.
2. Write only what you verified or what the user said, and mark anything you are unsure of as unverified, because the next session will treat the note as fact.
3. Separate this session's changes from the user's: list as done only the files this session or its subagents edited, and name other uncommitted changes as the user's work.
</procedure>

<sections>
Use these sections, in this order, skipping one only when it is truly empty:

1. **Goal**: the user's request in their own words, plus any constraints they added later, quoted exactly.
2. **State**: what is done, with file paths, and whether each part is verified (name the command and its result) or not.
3. **Decisions**: choices made and the reason for each, including options tried or rejected and why, so the next session does not retry them.
4. **Open**: remaining steps in order, and anything blocked with what it is blocked on.
5. **Details that are hard to rebuild**: exact error messages, commands, IDs, versions, and file:line locations the next session would otherwise have to rediscover.
</sections>

<output>
Keep the note under about 80 lines, giving file paths rather than pasted file contents. Then tell the user the path you wrote, and that a new session can start with "Read <path> and continue." If the file is inside the repository and not ignored by git, mention that they may want to add it to `.gitignore`, since a handoff note describes one session and does not belong in the project history.
</output>
