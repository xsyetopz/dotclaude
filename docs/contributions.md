# Contributions To Other Projects

A commit, push, pull request, issue, discussion, review, or comment in a
project that you do not own speaks for you. Maintainers read it as your
words. Many projects now say whether they accept work made with AI, and many
more have not written a policy yet. dotclaude checks the policy, gives you a
draft, and leaves the send to you.

## The AI Policy Catalog

**What:** dotclaude ships a catalog of project AI policies, made from the
table in [open-source-ai-contribution-policies][upstream] by melissawm
(CC0-1.0). The file is `hooks/lib/_ai-policies.json`. Each entry has the
project, its policy link, and the answers to "AI allowed?", "disclosure
required?", and "human in the loop required?". Each entry also has the
repository keys (`host/owner/repo`, or `host/owner` for a whole
organization). A map in `hooks/lib/_ai-policies.mjs` adds the repositories
of projects whose table link points to a website.

**Why:** a project's own files hold its policy, but Claude does not always
read them before it acts. A catalog lets the guard stop a contribution even
when Claude did not look.

## The Guard

**What:** the [Bash guard](hooks.md#bash-guard-bash_guard) finds these
commands:

- `git commit` and `git push`
- `gh pr` `create`, `comment`, `review`, `edit`, `reopen`, and `ready`
- `gh issue` `create`, `comment`, `edit`, and `reopen`
- `gh discussion` `create`, `comment`, and `edit`
- `gh api` writes to a repository's pulls, issues, comments, git data, or
  contents
- `gh api graphql` mutations that post content, such as `createDiscussion`
  and `addDiscussionComment`

It finds the target repository from `-R`, a URL argument, the push remote,
or the remotes of the working directory. Then it does one of these:

- **Deny:** the catalog says that the target project does not accept AI
  contributions ("No" or "No\*"). Claude gets the reason with the policy
  link, stops all work that contributes to the project, and tells you.
- **Ask:** the command pushes or writes to a GitHub repository whose owner
  is not your `gh` login. The prompt names the repository and the catalog
  entry. When the catalog has no entry, the prompt says that the policy is
  possibly unwritten.
- **Ask:** a GraphQL mutation posts content. The guard cannot find the
  repository from a node ID, so the prompt asks you to check the policy.

A `git commit` in another owner's clone passes, because it stays local until
a push. Reads, such as `gh pr view`, pass.

**Why:** a contribution is public and stays after a delete. The decision is
yours, and a prompt gives you the facts for it.

## Updates

**What:** at session start, a detached process checks the upstream README
when the last check is more than a day old. It downloads the raw file with a
3-second limit, and it keeps the git blob hash of the file. The guard reads
only that stored hash and compares it with the catalog. It never waits for
the network. When the two differ, the deny or ask reason tells you to run:

```bash
bun <plugin>/scripts/update-ai-policies.mjs
```

The script writes a new catalog to the plugin data directory, and that copy
wins over the shipped one. `--dry-run` shows the counts and writes nothing.
`--ship` writes the shipped file, for a dotclaude release. With
`DOTCLAUDE_OFFLINE=1` set, nothing checks. The tests set it.

**Why:** the upstream list changes often. A check on every command costs
time, a check in the guard can hold a command for 3 seconds, and an automatic
update would change what the guard denies without
your knowledge.

## Drafts

**What:** the `contribute-upstream` skill and the system prompt tell Claude
to do these steps:

1. Read the project's `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md`, and
   templates.
1. Stop when the project forbids AI work. Treat a project with no policy as
   unknown, not as permission.
1. Verify the claim with a reproduction or the project's tests.
1. Write a draft in plain, simple English, with a disclosure line where the
   policy asks for one.

You review and send the draft. After that, Claude does not reply in the
thread unless you ask.

**Why:** maintainers spend time on each report. A report that is not
verified, or that is long and vague, costs them that time and costs you
their trust.

[upstream]: https://github.com/melissawm/open-source-ai-contribution-policies
