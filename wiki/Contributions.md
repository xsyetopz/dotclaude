# Contributions

A commit, push, pull request, issue, discussion, review, or comment in a project that you do not own speaks for you.
Maintainers read it as your words.
Since 0.27 dotclaude has no contribute skill.
The policy ask of the hooks module replaces it.

## The policy ask

The module in `hooks/mod.mjs` asks once per session and per repository, when Claude reaches a repository of another owner that has a `CLAUDE.md`, `AGENTS.md`, or `AI_POLICY.md` file.
It covers these calls:

- Bash: `git clone`, `gh`, `curl`, or `wget` on the repository.
- `WebFetch` of a page of the repository.

How it works:

1. It reads your login with `gh config get user -h github.com`.
1. It reads the organizations where you are admin with `gh api user/memberships/orgs`.
   A repository of you or of such an organization is yours, and it keeps the verdict.
1. For another owner, it reads the policy files with `gh api` and the raw accept header.
1. It asks, and shows the policy text.
   The text is XML-escaped, wrapped in `<policy_file name=...>`, and cut at 2,000 characters with `[cut]`.
1. The next call to the same repository in the session keeps the verdict.

The module has no error handler, so it fails open.
When `gh` is missing, logged out, or slower than 5 seconds, the call goes on without the ask.
A repository with no policy file also goes on.
A project with no policy is unknown, not permitted, so read its `CONTRIBUTING.md` yourself.

## What to do when it asks

1. Read the policy text in the prompt.
1. If the policy forbids AI work, reject the call.
1. If it allows AI work, allow the call, and follow what the policy asks for, such as a disclosure line.
1. Review each draft before you send it.
   After you send it, ask Claude to reply in the thread only when you want that.

> **Note:** Maintainers spend time on each report.
> A report that nobody checked, or that is long and vague, costs them that time and costs you their trust.

## Public writes

The settings profile adds `permissions.ask` rules for writes with `gh pr` and `gh issue`, and for `gh release`.
A contribution is public and stays after a removal.
The decision is yours, and a prompt gives you the facts for it.
See [Guards](Guards).

## History

<details>
<summary>Removed in 0.27.0</summary>

Release 0.26 had the `/dotclaude:contribute` skill and section 9 of the operating spec.
Release 0.27.0 removed both and kept the policy ask in the module.
Release 0.19 also had a catalog of project AI policies, and release 0.20.0 removed it.
The older text is in [Release history](Release-History).

</details>

## Related pages

- [Guards](Guards): the module guard.
- [Install](Install): set up the profile that adds the ask rules.
