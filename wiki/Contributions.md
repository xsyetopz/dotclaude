# Contributions

A commit, push, pull request, issue, discussion, review, or comment in a project that you do not own speaks for you.
Maintainers read it as your words.
Many projects now say whether they accept work made with AI, and many more have not written a policy yet.
The `contribute` skill checks the policy, gives you a draft, and leaves the send to you.

## Drafts

*What:* the `/dotclaude:contribute` skill tells Claude to do these steps:

1. Read the `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md`, and templates of the project.
1. Stop when the project forbids AI work.
   Treat a project with no policy as unknown, not as permission.
1. Check the claim with a reproduction or the tests of the project.
1. Write a draft in plain, simple English, with a disclosure line where the policy asks for one.

You review and send the draft.
After that, Claude does not reply in the thread unless you ask.

*Why:* maintainers spend time on each report.
A report that nobody checked, or that is long and vague, costs them that time and costs you their trust.

## Public writes

*What:* the settings profile adds `permissions.ask` rules for these commands:

- `gh pr create`, `gh pr comment`, and `gh pr review`
- `gh issue create` and `gh issue comment`
- `gh discussion create` and `gh discussion comment`

*Why:* a contribution is public and stays after a removal.
The decision is yours, and a prompt gives you the facts for it.

## History

Release 0.19 also had a catalog of project AI policies.
It also had a Bash guard that denied a contribution to a project that forbids AI work.
Release 0.20.0 removed both.
The older text is in [Release history](Release-History).
