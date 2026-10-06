# Changelog

This file records the notable changes to this project.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0.0, a release can change or remove behavior.
After each update, do the steps in the "Update" section of the README.
The [Release History](https://github.com/xsyetopz/dotclaude/wiki/Release-History) page of the wiki has the notes of older releases.

## [Unreleased]

## [0.23.2] - 2026-10-06

### Fixed

- Clause 13 of the Terms of Use, `Long runs`: when a background run stalls, or a run waits on a stale process, lock, or monitor, Claude stops that blocker and runs the step again, also when Claude did not start it.
  Before, Claude could read the `shared_workspace` rule as a reason to stop, and end the turn with the task blocked.

## [0.23.1] - 2026-10-06

### Changed

- dotclaude needs Claude Code 2.1.291 or later.
  2.1.291 fixes a regression of 2.1.288 that could lose the last messages of a session at quit, and a regression of 2.1.290 that could drop answers to permission prompts in cloud sessions.

## [0.23.0] - 2026-10-06

### Added

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

### Changed

- dotclaude needs Claude Code 2.1.290 or later.
- In auto mode, the reminder of Claude Code 2.1.290 tells Claude to edit files with `sed`, heredocs, or scripts through `Bash`.
  The hooks module puts the dotclaude edit rule in place of this text, so that the reminder agrees with the Bash guard.
  The `guard_bash` option also turns this change off.
- The working rules are rewritten in shorter words, and no rule is removed.
  `RULES_MAX_BYTES` is 2,000 again, down from 2,200.
  The rules now say that Claude changes a test or a limit only when the user asks, because a raised limit hides the defect.

### Fixed

- The Bash guard denies a `Bash` command that writes a project file: a redirect, `tee`, `sed -i`, `perl -i`, or script code with a write call.
  A `Bash` write skips the diff that the user sees, the Claude Code checkpoints, and the dotclaude edit guard.
  The deny tells Claude to edit with `Edit` or `Write`, and to put a temporary file in `$TMPDIR`.
  A write to the temporary folder passes, and the body of a heredoc counts as data.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.22](https://github.com/xsyetopz/dotclaude/wiki/Release-0.22) | 0.22.3, 0.22.2, 0.22.1, 0.22.0 |
| [0.21](https://github.com/xsyetopz/dotclaude/wiki/Release-0.21) | 0.21.0 |
| [0.20](https://github.com/xsyetopz/dotclaude/wiki/Release-0.20) | 0.20.8, 0.20.7, 0.20.6, 0.20.5, 0.20.4, 0.20.3, 0.20.2, 0.20.1, 0.20.0 |
| [0.19](https://github.com/xsyetopz/dotclaude/wiki/Release-0.19) | 0.19.1, 0.19.0 |
| [0.18](https://github.com/xsyetopz/dotclaude/wiki/Release-0.18) | 0.18.1, 0.18.0 |
| [0.17](https://github.com/xsyetopz/dotclaude/wiki/Release-0.17) | 0.17.1, 0.17.0 |
| [0.16](https://github.com/xsyetopz/dotclaude/wiki/Release-0.16) | 0.16.1, 0.16.0 |
| [0.15](https://github.com/xsyetopz/dotclaude/wiki/Release-0.15) | 0.15.1, 0.15.0 |
| [0.14](https://github.com/xsyetopz/dotclaude/wiki/Release-0.14) | 0.14.1, 0.14.0 |
| [0.13](https://github.com/xsyetopz/dotclaude/wiki/Release-0.13) | 0.13.1, 0.13.0 |
| [0.12](https://github.com/xsyetopz/dotclaude/wiki/Release-0.12) | 0.12.1, 0.12.0 |
| [0.11](https://github.com/xsyetopz/dotclaude/wiki/Release-0.11) | 0.11.1, 0.11.0 |
| [0.10](https://github.com/xsyetopz/dotclaude/wiki/Release-0.10) | 0.10.2, 0.10.1, 0.10.0 |
| [0.9](https://github.com/xsyetopz/dotclaude/wiki/Release-0.9) | 0.9.0 |
| [0.8](https://github.com/xsyetopz/dotclaude/wiki/Release-0.8) | 0.8.2, 0.8.1, 0.8.0 |
| [0.7](https://github.com/xsyetopz/dotclaude/wiki/Release-0.7) | 0.7.0 |
| [0.6](https://github.com/xsyetopz/dotclaude/wiki/Release-0.6) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](https://github.com/xsyetopz/dotclaude/wiki/Release-0.5) | 0.5.1, 0.5.0 |
| [0.4](https://github.com/xsyetopz/dotclaude/wiki/Release-0.4) | 0.4.0 |
| [0.3](https://github.com/xsyetopz/dotclaude/wiki/Release-0.3) | 0.3.0 |
| [0.1 and 0.2](https://github.com/xsyetopz/dotclaude/wiki/Release-0.1-0.2) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.23.2...HEAD
