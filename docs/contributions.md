# Contributions To Other Projects

Part of the [dotclaude documentation](README.md).

A commit, push, pull request, issue, discussion, review, or comment in a project that you do not own speaks for you.
Maintainers read it as your words.
Many projects now say whether they accept work made with AI, and many more have not written a policy yet.
The `contribute` skill checks the policy, gives you a draft, and leaves the send to you.

## Drafts

**What:** the `/dotclaude:contribute` skill tells Claude to do these steps:

1. Read the project's `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md`, and templates.
1. Stop when the project forbids AI work.
   Treat a project with no policy as unknown, not as permission.
1. Verify the claim with a reproduction or the project's tests.
1. Write a draft in plain, simple English, with a disclosure line where the policy asks for one.

You review and send the draft.
After that, Claude does not reply in the thread unless you ask.

**Why:** maintainers spend time on each report.
A report that is not verified, or that is long and vague, costs them that time and costs you their trust.

## Public Writes

**What:** the settings profile adds `permissions.ask` rules for `gh pr create`, `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment`, `gh discussion create`, and `gh discussion comment`.

**Why:** a contribution is public and stays after a delete.
The decision is yours, and a prompt gives you the facts for it.

## History

0.19 also had a catalog of project AI policies, and a Bash guard that denied a contribution to a project that forbids AI work.
0.20.0 removed both, and the older text is in [the 0.19 releases](changelog/).
