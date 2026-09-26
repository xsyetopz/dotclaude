---
name: review-code-changes
description: Review uncommitted changes, a git range, or paths with the code-reviewer agent in a fresh read-only context, with findings tied to failure scenarios. Run when the user types /dotclaude:review-code-changes.
disable-model-invocation: true
argument-hint: "[git range or paths, optional]"
context: fork
agent: code-reviewer
---

<task>
Review the current change.

Request or spec to review against: take it from the conversation that invoked this review if one is visible; otherwise infer the intent from commit messages and the diff, and say in the verdict that no spec was given.

Target: $ARGUMENTS
</task>

<context>
If the target above is empty, review the uncommitted changes. Their summary when this review started:

!`git status --short 2>/dev/null | head -50; echo; git diff --stat HEAD 2>/dev/null | tail -30`
</context>
