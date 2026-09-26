---
name: recap
description: Report where the session stands and correct earlier claims that no longer hold. Use when the user names /dotclaude:recap anywhere in a message or asks where things stand, often after a compaction or long work.
argument-hint: "[focus, optional]"
---

<task>
Audit this entire conversation and tell the user where things stand, so they can confirm the session is still on their task before it continues. After a compaction the summary is all you have of earlier turns, and it can be wrong; this recap is the user's chance to catch that.
</task>

<procedure>
1. Re-read the state instead of trusting memory: `git status --short`, `git diff --stat HEAD`, `git log --oneline -5`, the task list if one exists, and any handoff or progress file the session wrote.
2. Reconstruct the user's goal from their own messages, quoting them for the request and every constraint they added later.
3. Compare what the conversation claims against what the files and git now show, and explicitly correct any earlier statement that turned out wrong or has been overtaken.
4. If the task list is out of date, update it.
</procedure>

<output>
Answer in this order, briefly:

- **Goal**: the request and later constraints, in the user's words.
- **Done**: what is finished, with file paths, and whether each part was verified (the command and its result) or not.
- **In progress**: what you were doing when this recap was asked for.
- **Open**: remaining steps in order, and anything blocked with what it waits on.
- **Corrections**: earlier statements that were wrong or are now stale, with what is true instead, or "none".
- **Decisions and rejected approaches**: each with its reason, so they are not retried.

Focus on $ARGUMENTS if it is given. Stop after the recap, so the user can confirm or correct it before work continues.
</output>
