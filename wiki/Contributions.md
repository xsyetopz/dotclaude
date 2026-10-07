# Contributions

The `/dotclaude:contribute` skill checks the AI policy of a project, gives you a draft, and leaves the send to you.
A commit, push, pull request, issue, discussion, review, or comment in a project that you do not own speaks for you.
Maintainers read it as your words.

## Before you begin

Many projects say whether they accept work made with AI, and many more have not written a policy yet.
Install the core plugin first.
See [Install](Install).

## Draft a contribution

1. Run the skill.

   ```text
   /dotclaude:contribute
   ```

1. Claude reads the `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md`, and templates of the project.
1. Claude stops when the project forbids AI work.
   A project with no policy is unknown, not permitted.
1. Claude checks the claim with a reproduction or the tests of the project.
1. Claude writes a draft in plain, simple English, with a disclosure line where the policy asks for one.
1. You review and send the draft.
   After that, Claude does not reply in the thread unless you ask.

> **Note:** Maintainers spend time on each report.
> A report that nobody checked, or that is long and vague, costs them that time and costs you their trust.

## Public writes

The settings profile adds `permissions.ask` rules for these commands:

| Area | Commands |
| --- | --- |
| Pull requests | `gh pr create`, `gh pr comment`, `gh pr review` |
| Issues | `gh issue create`, `gh issue comment` |
| Discussions | `gh discussion create`, `gh discussion comment` |

A contribution is public and stays after a removal.
The decision is yours, and a prompt gives you the facts for it.

## History

<details>
<summary>Removed in 0.20.0</summary>

Release 0.19 also had a catalog of project AI policies.
It also had a Bash guard that denied a contribution to a project that forbids AI work.
Release 0.20.0 removed both.
The older text is in [Release history](Release-History).

</details>

## Related pages

- [Guards](Guards): the policy guard asks before a call reaches a project with an AI policy.
- [Operating spec](Operating-Spec): section 9, the project AI policy.
- [Install](Install): set up the profile that adds the ask rules.
