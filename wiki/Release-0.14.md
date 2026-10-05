# Release 0.14

Release 0.14 added a contribution guard that checks the AI policy of a project before Claude writes to it.
It also added a context note at 100k tokens and a model lock for effort levels.
The goal was to stop unwanted AI contributions and to give Claude time to write a handoff before compaction.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.14.0.

## Added

- A contribution guard in the Bash guard.
  - It covers `git commit`, `git push`, and `gh pr`, `gh issue`, and `gh discussion` writes.
    It also covers `gh api` writes and GraphQL mutations that post content.
  - It denies a contribution to a project that forbids AI work.
    The catalog comes from `open-source-ai-contribution-policies` by melissawm (183 projects, 101 forbid).
  - It asks before a push or write to a GitHub repository whose owner is not the `gh` login of the user.
    The prompt shows the catalog entry of the project, or says that its policy is possibly unwritten.
  - A local `git commit` in the clone of another owner passes.
  - See [Contributions](Contributions).
- `scripts/update-ai-policies.mjs` updates the catalog into the plugin data directory.
  At session start, a detached process checks the upstream README hash at most once a day.
  The guard reads only the stored hash, and tells the user to update when it differs from the catalog.
  `DOTCLAUDE_OFFLINE=1` turns the check off.
- The `contribute-upstream` skill.
  It reads the AI policy of the project, stops when the project forbids AI work, and treats a missing policy as unknown.
  It verifies the claim before a draft and writes the draft in plain English for the user to send.
  Claude does not reply in the thread after that unless the user asks.
- The settings profile adds `permissions.ask` rules for `gh pr create`, `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment`, `gh discussion create`, and `gh discussion comment`.
- A context note.
  When the main context is 100k tokens or more, each prompt that the user types tells Claude the context size.
  It also tells Claude to start a handoff with `write-session-handoff`.
  No hook input gives Claude its context size.
  With the settings profile, Claude Code compacts at about 117k tokens (median 121k in 145 measured compactions), before the 150k handoff point.
  The note at 100k gives Claude time to write a handoff first.
  In a long run with no typed prompt, the first tool call past 100k gives the note once.
  It comes again after the context goes under 100k and back over it.
  The size comes from the end of the transcript, and the note uses the `usage_notes` option.
  Release 0.15 changed when the note asks for a handoff.

## Changed

- The model lock denies a subagent or a `claude` command at an effort level that dotclaude does not support for its model (0.14.1).
  Opus 5.5 supports `low` to `xhigh`.
  Sonnet 5.5 supports only `low` and `medium`, because work that needs `high` needs judgment, and Opus 5.5 gives more for the same cost there.
  The deny reason names where the effort came from and what to do.
  `EFFORT_LEVELS` in `hooks/lib/_models.mjs` holds the table.
- System prompt, approvals.
  Approval also covers actions that spend money or speak for the user.
  A request says what the action does, why, what it changes, and how to undo it.
  Open questions go in one `AskUserQuestion` call.
  Claude does not ask in text for an approval that a permission prompt gives, because many small approvals teach the user to approve without reading.
- System prompt, gaps.
  Claude does not call an unsupported case "intended" or a `correct skip` only because the code does not handle it.
  It checks public implementations and docs, and reports a gap unless the project or the user excludes the case.
  In one session an agent called four controllers `correct skips` although public drivers for them exist.
- `apply-settings-profile` runs all previews and asks one question for the profile groups, the switches, and the extras.
  The permission prompt of each `--apply` is the approval of the write, with no second question in text.
- The usage notes give the reset time of the session and weekly limits.
  At 90%, Claude writes a handoff when the remaining work does not fit before the limit, and tells the user the reset time.
- Hooks run faster on Bun.
  - The Edit guard reads the transcript only when an edit removes assertions (a long session: 35 to 17 ms for each edit).
  - The Bash and Edit guards find the latest prompt of the user from the end of the transcript and stop there.
    In a long session, an edit that removes assertions took 26 ms, not 40 ms.
  - The contribution catalog and the settings stamp hash with `Bun.CryptoHasher`, not `node:crypto` (a Bash check: about 3 ms less).
  - The status line measures width with `Bun.stripANSI`, not `node:util` (about 2 ms less).
  - The secret scan starts Betterleaks with `Bun.spawn`, not `node:child_process`, which uses about 15% less CPU after a `Bash` call.
  - The contribution guard reads the `gh` login from `hosts.yml`, and starts `gh` only when it cannot read the file.
    A push to the repository of another owner took 37 ms, not 91 ms.
- The dossier fixes the cost comparison of Sonnet 5.5 and Opus 5.5 from the Artificial Analysis suite.
  `diff-reviewer` stays on Sonnet 5.5, so a `risk: high` slice still gets two different models as reviewers.
- `docs/models.md` listed the supported effort levels for each model and the limits of the check (0.14.1).
  0.20.0 removed it, and [Plans and models](Plans-and-Models#effort) now has the effort levels.
  Model Fit adds the ProjectArchitect Bench A/B as reported evidence, with its limits.

## Fixed

- The search guard denied `rg -uu`, `fd -I`, and `git grep --no-index` into large gitignored notes or docs.
  It now denies an explicit bypass only when it walks a build or dependency directory, such as `node_modules` or `dist`.
- `rm -rf "$TMPDIR/name"` asked for approval.
  A named child of `$TMPDIR` now passes.
  `$TMPDIR` itself, a glob, and `..` still ask.
- Inline code such as `python3 -c "s.replace('os.unlink(', …)"` gave a destructive-code warning for text inside a string literal.
  The check now ignores string literals.
- The stop gate counted an edit of `.gitignore`, `.git/`, `.claude/`, or a gitignored file as a code edit.
  It then asked for a check run.
  It now counts only files that git does not ignore, in both the `Edit` and `Bash` paths.

Previous: [Release 0.13](Release-0.13) · Next: [Release 0.15](Release-0.15)
