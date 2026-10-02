---
name: contribute
description: Checks a project's AI policy, then drafts an issue, pull request, or comment for the user to send. Use before any contribution to a repository the user does not own.
argument-hint: "[repository and what to contribute, for example: owner/repo bug in the parser]"
---

<procedure>

1. Find the AI policy. Read these files in the target repository, if they exist: `AI_POLICY.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CODE_OF_CONDUCT.md`, the pull request template, and the issue templates. Use `gh api repos/<owner>/<repo>/contents/<path>` or the web page. Also check the organization's `.github` repository. dotclaude's Bash guard reads a catalog of projects that forbid AI contributions and denies contribution commands to them.

2. Decide from the policy:
   - **Forbidden**: the project does not accept AI-assisted work of this kind. Stop. Tell the user what the policy says, and quote it with its link. Do not draft, reword, or suggest a workaround, because the maintainers said no.
   - **Allowed with conditions**: follow each condition, for example a disclosure line, a label, a size limit, or a rule that a human must review the change first.
   - **No written policy**: the project's position is unknown. The maintainers possibly do not want AI contributions but did not write it yet. Tell the user this before you draft, and keep the contribution small and easy to review.

3. Verify before you draft. A report must be true when a maintainer checks it:
   - For a bug, build a minimal reproducible example against the latest release or the default branch, and record its output and the versions.
   - For a fix, run the project's own tests and linters on it.
   - Search the open and closed issues and pull requests for duplicates. If one exists, show it to the user instead of a new draft.
   - Separate what you verified from what you infer. Leave out claims that you could not check.

4. Write the draft to a file, for example `.claude/drafts/<repo>-issue.md`. Follow the project's template. Write in plain, simple English:
   - Put the point in the first sentence: what is wrong or what the change does.
   - Use short sentences and common words. Give steps, expected result, and actual result as lists.
   - Put commands, output, and code in code blocks. Cut every sentence that does not help the maintainer act.
   - Add a disclosure line when the policy asks for one or has no rule, for example "I used an AI assistant to help find this and write this report. I checked the reproduction myself." Ask the user to confirm that the line is true for them.

5. Give the user the file path, the policy verdict with its link, and what you verified. Stop there. The user reviews, edits, and sends the draft. If the user asks you to send it, dotclaude's Bash guard shows a permission prompt, and the user approves the command there.

6. After the draft is sent, do not reply in the thread, push follow-up commits, or answer reviewers unless the user asks. Later replies come from the user. When the user asks for help with a reply, draft it the same way.
</procedure>

<task>
Prepare the contribution in `$ARGUMENTS`, or in the user's last message when `$ARGUMENTS` is empty, for a project that the user does not own. The text goes out under the user's name, and maintainers read it as the user's words. So check that the project accepts AI contributions, verify the claim, and give the user a draft. The user sends it.
</task>
