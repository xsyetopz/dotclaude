---
name: write-session-handoff
description: Write a handoff note so a fresh session can continue the current task without this conversation. Use it when the user wants to hand off, wrap up for a new session, or start fresh. Also use it to save progress before `/clear` or `/compact`, or to pause and resume later. Also use it when the user asks "what would a new session need to know", even without the word "handoff".
argument-hint: "[output path, default .claude/handoff.md]"
---

<task>
Write a handoff note that a fresh session reads instead of this conversation. It must carry what the conversation knows and the repository does not. Write it to `$ARGUMENTS`, or to `.claude/handoff.md` when the user gives no path. Overwrite any existing file, because the previous handoff is stale.
</task>

<procedure>
1. Gather facts before you write: run `git status --short`, `git diff --stat HEAD`, and `git log --oneline -10`. Check which test or build commands ran in this session, and their last result.
2. Write only what you verified or what the user said. Mark anything you are unsure of as unverified, because the next session will treat the note as fact.
3. Separate this session's changes from the user's: list as done only the files this session or its subagents edited. Name other uncommitted changes as the user's work.
</procedure>

<sections>
Use these sections in this order. Skip a section only when it is truly empty:

1. **Goal**: the user's request in their own words, plus any constraints they added later, quoted exactly.
2. **State**: what is done, with file paths, and whether each part is verified (name the command and its result) or not.
3. **Decisions**: choices made and the reason for each, including options tried or rejected and why, so the next session does not retry them.
4. **Open**: remaining steps in order, and each blocked item with what blocks it.
5. **Details that are hard to rebuild**: exact error messages, commands, IDs, versions, and `file:line` locations the next session would otherwise have to rediscover.
</sections>

<output>
Keep the note under about 80 lines. Give file paths, not pasted file contents. Tell the user the path you wrote. Tell them a new session can start with `Read <path> and continue`. Check if the file is inside the repository and git does not ignore it. If so, say they may want to add it to `.gitignore`. A handoff note describes one session and does not belong in the project history.
</output>
