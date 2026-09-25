---
name: review-code-changes
description: Review the current uncommitted changes, or a given git range or paths, with the dotclaude code-reviewer agent in a fresh, read-only context, and report findings tied to concrete failure scenarios. Run when the user types /dotclaude:review-code-changes.
disable-model-invocation: true
argument-hint: "[git range or paths, optional]"
context: fork
agent: code-reviewer
---

Review the current change.

Request or spec to review against: take it from the conversation that invoked this review if one is visible; otherwise infer the intent from commit messages and the diff, and say in the verdict that no spec was given.

Target: $ARGUMENTS

If the target above is empty, review the uncommitted changes. Their summary at the time this review started:

!`git status --short 2>/dev/null | head -50; echo; git diff --stat HEAD 2>/dev/null | tail -30`
