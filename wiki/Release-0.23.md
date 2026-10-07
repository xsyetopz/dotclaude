# Release 0.23

Released 2026-10-06, with the patch versions 0.23.1 and 0.23.2.
Adds the `translator`, `docs-writer`, and `digest-writer` agents, a clause for questions to the user,
and a Bash guard deny for writes to project files.

## Added

- Three agents:
  - `translator` translates and localizes UI strings, docs, and string catalogs, such as `.xcstrings`, `.strings`, `.po`, and JSON or YAML locale files, and fixes defects in existing translations.
    It keeps keys, placeholders, and markup byte for byte, and it lists the defects before it edits.
    It has `Bash` only to run the validators of the project, such as `plutil -lint`, and it edits only with `Edit` or `Write`.
    It runs on Sonnet 5.5 at medium effort.
  - `docs-writer` writes or updates READMEs, guides, wiki pages, changelogs, docstrings, and examples to match the code.
    It has no `Bash`, so it marks each run-time claim that it could not check.
    It runs on Sonnet 5.5 at medium effort.
  - `digest-writer` reads long material, such as files, logs, transcripts, threads, and git history, and writes a short digest of the facts that the brief asks for.
    It is read-only, with `Bash` to read `git log` and similar output, and it runs on Haiku 4.5 without `CLAUDE.md`.
- Clause 16 of the Terms of Use, `Questions to the user`: Claude asks each question to the user through `AskUserQuestion`, with options, and not in plain text.
  The user can then pick an answer, and other hooks, such as the `dotclaude-jev` hook, can add facts to the question.
  A new `Stop` hook, `hooks/stop/block-plain-questions.mjs`, blocks the end of a turn when one of the last 3 prose lines of the message ends in a question mark.
  It skips code, headings, and quotes, and it does not block a second time in a row.

## Changed

- dotclaude needs Claude Code 2.1.291 or later (0.23.1).
  2.1.291 fixes a regression of 2.1.288 that could lose the last messages of a session at quit, and a regression of 2.1.290 that could drop answers to permission prompts in cloud sessions.
- In auto mode, the reminder of Claude Code 2.1.290 tells Claude to edit files with `sed`, heredocs, or scripts through `Bash`.
  The hooks module puts the dotclaude edit rule in place of this text, so that the reminder agrees with the Bash guard.
  The `guard_bash` option also turns this change off.
- The working rules are rewritten in shorter words, and no rule is removed.
  `RULES_MAX_BYTES` is 2,000 again, down from 2,200.
  The rules now say that Claude changes a test or a limit only when the user asks, because a raised limit hides the defect.

## Fixed

- The Bash guard denies a `Bash` command that writes a project file: a redirect, `tee`, `sed -i`, `perl -i`, or script code with a write call.
  A `Bash` write skips the diff that the user sees, the Claude Code checkpoints, and the dotclaude edit guard.
  The deny tells Claude to edit with `Edit` or `Write`, and to put a temporary file in `$TMPDIR`.
  A write to the temporary folder passes, and the body of a heredoc counts as data.
- Clause 13 of the Terms of Use, `Long runs` (0.23.2): when a background run stalls, or a run waits on a stale process, lock, or monitor, Claude stops that blocker and runs the step again, also when Claude did not start it.
  Before, Claude could read the `shared_workspace` rule as a reason to stop, and end the turn with the task blocked.
