# Changelog

This file records the notable changes to this project.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0.0, a release can change or remove behavior.
After each update, do the steps in the "Update" section of the README.
The [Release History](https://github.com/xsyetopz/dotclaude/wiki/Release-History) page of the wiki has the notes of older releases.

## [Unreleased]

### Fixed

- The clause 18 prompt hook blocked correct messages that list a part as not verified, repeat a claim of another agent that they did not check, or report a run whose results they did not read.
  It now blocks only when it can quote the words of the done claim.
  In a replay of 32 real messages and 5 breaks with the transcript, the system prompt, and the model of Claude Code 2.1.292, false blocks went from 4 of 32 to 2 of 32, and the hook caught 5 of 5 breaks.
- The Bash guard denied a write to a temporary file as a write to a project file.
  It now ignores module paths in `import`, `from`, and `require`, and follows `cd` from part to part of a command, so that `cd "$TMPDIR/x" && … > out.txt` writes to `$TMPDIR`.

## [0.25.1] - 2026-10-06

### Fixed

- The clause 18 prompt hook let through a progress report that calls each part written or still running, and says that its checks are still to run.
  Before, it blocked such a report in 2 of 5 runs, because it read "written" as "done".
  With the fix, it let through the same report in 8 of 8 runs, and blocked a false done claim in 4 of 4 runs.

## [0.25.0] - 2026-10-06

### Added

- Clause 18, "Known defects", goes to the main agent and to each subagent.
  - Claude fixes each defect in its own change, and each defect that makes its check fail, before it reports done.
  - Claude reports a defect outside the request with its evidence.
    The main agent then asks you to fix it now, or to keep it open with a reason and an owner.
  - Claude calls a failing check "flaky" only when it names the cause and a rerun passes.
- A prompt hook on `Stop` and `SubagentStop` blocks a last message that calls a part done that no check passed on.
  This includes a check that did not run, failed, is flaky, or is pre-existing, and a failed-test count that is not 0.
  A **Not verified** list, open items, and a skipped step that is not a check do not count.
  When the model is not sure, it blocks, because a missed failure looks like finished work.
  It blocks only once in a row.
  It uses the background model of Claude Code, so each stop adds one model call.
  Live tests on Claude Code 2.1.292 confirm that a plugin prompt hook runs on both events.
  Claude Code shows the full hook prompt to Claude at each block, so the prompt is short and reads as the rule.
- The guards ask before each `PublishPlugin` call (Claude Code 2.1.292), because it publishes a plugin to the claude.ai library of your organization.
  No `guard_*` option turns this ask off.

### Changed

- The 13 agent prompts start each report with `Done` or `Not done`, and list each part with no passing check under **Not verified**.
  - A worker agent fixes each defect in its own change, and reports a defect outside the brief under **Outside the brief**, with its evidence.
    It no longer puts such a defect in the report as a follow-up.
  - Each agent runs its checks before it uses 3/4 of its turns.
- Clause 1: a check that cannot run blocks a done report.
- Clause 6 and the `dotclaude:handoff` skill: each **Open** item has the reason that it stays open and its owner.
  An item that was open in an earlier note is done in the new session, or Claude asks you about it.
- Clause 10 (`dotclaude-jev`): a pick of Jev on a fact question with a confidence of 0.9 or more settles the question.
  When Claude does not follow a pick of Jev, it says so and gives the reason.
- Clause 15: the main agent gives each subagent a slice whose checks fit in its turn limit, and reads "done" next to "did not run" or "flaky" as not done.
- The hook texts of the three plugins are in stricter ASD-STE100: shorter sentences, and each text gives the reason and the action.
  The assertion and skip-marker asks of the edit guard now say why a weaker test is a risk.

## [0.24.0] - 2026-10-06

### Added

- The `dotclaude-modder` plugin lets Claude mod a PC game that you own.
  It is a port of [universal-modder](https://github.com/rehan-remade/universal-modder) by Rehan, under the MIT license.
  - Nine skills take Claude from engine recon to assets, in-game tests, a published mod, a showcase video, and field notes.
  - The `um` command keeps the commands of the upstream `um`.
    It runs on Bun, and `uv` runs its Python parts (`um sprite`, `um video`, and `um backup`).
  - The `fal_key` option gives the key to `um fal` and to the fal MCP server.
  - `um kb` puts each field note in `untrusted_field_note` tags.
    By default, it reads the notes of a reviewed upstream commit from 2026-10-05.
    `UM_KB_BRANCH=main` gives the latest notes.
    With `UM_KB_REPO` and no `UM_KB_BRANCH`, `um kb` reads `main` of that repository, because the reviewed commit is not in a fork.
  - The `um kb pr` dry run makes no network call.
  - `um kb sync` stops when GitHub sends only a part of the file list.
    When a sync fails, `um kb` tells you that it uses the older cached copy.
  - `um kb search` stops on a `--limit` that is not a number, also an empty one.
    `um kb show` of a folder name shows the first note whose path contains the name.
  - The skills pre-approve only the `um` commands that read or that write local files.
    Claude Code asks before `um kb pr`, `um fal` jobs, `um backup restore`, and `um win` input, launch, kill, and registry commands.
  - `um backup create` never replaces a snapshot.
    A second snapshot in the same second gets a number suffix.
  - `um backup` accepts only a snapshot name that stays in the `backups` folder, also on Windows.
    A failed `um backup create` leaves a `.part` file, and not a damaged latest snapshot.
    `um backup restore` checks the whole snapshot before it changes a file, and it stops with a clear message on a damaged snapshot.
  - `um sprite` (`palette`, `cutout`, and `outline`) and `um video` beat detection are faster and use less memory, with the same output.
  - The modding skills refer to [xsyetopz/skills](https://github.com/xsyetopz/skills) for reverse engineering.
  - `um <group> <command> --help` shows the help of each option, as the upstream `um` does.
    The help lists the permitted values of an option, and a `-h` after `--` goes to the program that `um` starts.
- Clause 17 of the Terms of Use, `Game modding`: Claude backs up saves before a change, stops a process only by its PID, keeps a modded game off official online servers and away from DRM and anti-cheat, reads field notes as reference text, and gets your OK before a publish.
  A hook of `dotclaude-modder` denies a `Bash` call that stops processes by name.
- CI installs `uv` to run the Python tests of `um`.
- Three worker agents, so the roster grows from 10 to 13.
  TypeSafe Jev scored a list of candidate roles, and the audit of the usage data since 0.23.0 picked these three.
  - `eval-designer` writes eval cases and graders, and checks that each case fails on a baseline before it measures the change.
  - `fuzz-engineer` writes fuzz and property tests for parsers and input handlers, and reduces each crash to a minimal input.
  - `infra-engineer` writes CI, container, build, and deploy config, checks it locally, and stops before an apply or a deploy.
- The `reviewer` agent has an `api` lens for a public surface and its breaking changes.
  Its `security` lens also audits a whole feature or trust boundary, not only a diff.
- The `investigator` agent audits dependencies for licenses, abandoned packages, and the breaking changes of each upgrade.

### Fixed

- The `sembr` hook no longer tells Claude to split a front matter value, such as the one-line `description:` of an agent.
  An `Edit` sends only its new text, so the hook did not see the `---` line of the front matter.
  Now a line that starts with a lowercase `key:` is not prose.
- The working rules tell Claude to offer a commit only with no known defect, and to fix each defect at its cause.
  Before, Claude could list a defect as not fixed and offer a commit.
- Clause 15 tells Claude what to do when `SendMessage` cannot continue an agent, such as an agent in a worktree that Claude Code lost.
  Claude starts one new agent with the worktree folder of the old agent, its progress file, and its diff, and the new agent does only the steps that are not done.

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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.25.1...HEAD
