---
name: polish
description: Review the current change the way a senior perfectionist developer would in code review, list everything they would reject, and fix it. Run when the user types /dotclaude:polish, typically after a feature is built.
disable-model-invocation: true
argument-hint: "[paths or git range; defaults to the uncommitted changes]"
---

<task>
What would a senior perfectionist developer reject in code review of this change? Find all of it and fix it properly, without cutting corners.

Target: $ARGUMENTS (if empty, the uncommitted changes: `git diff HEAD` plus untracked files you created in this session).
</task>

<procedure>
1. Read the whole change and the code around it, as a reviewer who owns this codebase would.
2. List what they would reject, most serious first: incorrect or unhandled cases, weak or missing tests, names that do not match the domain, duplicated logic that an existing helper covers, dead code and leftover scaffolding, inconsistent error handling, comments that restate the code or are now wrong, docs that no longer match, and anything that does not follow the repository's conventions.
3. Show the list to the user in the same message as your first fix, then fix every item. Stay inside the change's scope: problems in code the change did not touch go in the report as follow-ups.
4. Run the tests, build, and linters that cover the change.
</procedure>

<output>
Report each item and how you fixed it, the checks you ran and their results, and the follow-ups you left out of scope.
</output>
