# Changelog

This file records the notable changes to this project.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0.0, a release can change or remove behavior.
After each update, do the steps in the "Update" section of the README.
The [Release History](https://github.com/xsyetopz/dotclaude/wiki/Release-History) page of the wiki has the notes of older releases.

## [Unreleased]

## [0.27.0] - 2026-10-07

0.27.0 is a breaking release.
The core plugin is built again from an empty tree on the documented extension points of Claude Code 2.1.292:
a settings profile, a forced output style, one hooks module, agents, and skills.
The [Design](https://github.com/xsyetopz/dotclaude/wiki/Design) page gives the source of each decision.

### Migration from 0.26

- Install Node.js 22.18 or later, because the scripts and hooks no longer run on Bun.
- Update, restart Claude Code, and run `/dotclaude:setup`.
  Setup removes `includeGitInstructions: false`, `autoCompactWindow`, `advisorModel`, the 0.26 `subagentStatusLine` and its stub,
  and the 0.26 block in `<config dir>/CLAUDE.md`, because they work against the new profile.
  It makes a backup of each file before it writes.
- The plugin options are gone, so the `/config` entries of dotclaude have no effect.
- Handoff notes from 0.26 in `.claude/handoffs/` stay readable, and no hook writes new ones.

### Added

- Compaction is off: `autoCompactEnabled: false` and `DISABLE_COMPACT=1`, which also turns off `/compact`.
- The context window is 300K tokens by `CLAUDE_CODE_MAX_CONTEXT_TOKENS=300000`,
  which Claude Code honors only together with `DISABLE_COMPACT`.
  At the limit the session stops, and the user runs `/clear`.
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` makes `/context` and the context warnings use the same window.
  Without it, Claude Code 2.1.292 uses 200K for Opus 5.5 there.
- Auto memory is off: `autoMemoryEnabled: false`.
- The forced `dotclaude` output style, with `keep-coding-instructions: false`,
  together with `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`.
  It replaces the built-in coding instructions and the 0.26 spec injection, and the prompt cache holds it.
- The sandbox is on, with network access only to GitHub and the package registries.
- `templates/managed-settings.json` for users who want the compaction, memory, and sandbox keys enforced.
  Setup prints the copy command and does not run it, because it needs `sudo`.
  With it, the built-in guard `sec-default` loads and skips the `context_management` text of the module.
- OpenSpec is a first-class integration.
  Setup checks the `openspec` CLI, offers the install and `openspec init --tools claude`,
  and the status line shows the active change with its task count.
- The profile turns off the tools that it does not use, so that their schemas leave each request:
  `enableArtifact: false`, `enableWorkflows: false`, and deny rules for `ScheduleWakeup` and `ReportFindings`.
  `/code-review` then gives its findings as text.
  In the sandbox, `/context` at the start of a session fell from 32k to 8.1k tokens, with the trimmed modder plugin.
- The hook lab: `just lab` runs `claude plugin test plugins/dotclaude`,
  which loads the hooks module and fires stubbed `tool.check` events.

### Changed

- Permissions ask only before dangerous commands, with native rules and no Bash parser:
  force pushes, history rewrites, piped shells, `sudo`, publishes, public `gh` writes, and SQL drops.
  Read-only git and the usual build and test commands are allowed.
- One hooks module replaces the 0.26 command hooks.
  It asks before a recursive `rm` outside the project,
  and before the first call to a GitHub repository of another owner with an AI policy.
  It keeps a deny of the engine and fails open.
  With `DISABLE_COMPACT` set, its `prompt.section` handler replaces the `context_management` section of the system prompt,
  which says that the system summarizes prior messages, with text that says compaction is off.
  The built-in guard `sec-default` skips this handler on a machine with managed settings or a Team or Enterprise login.
- In auto mode, the classifier can allow an ask of the module, so one classic PreToolUse hook, `hooks/auto-mode-guard.mjs`, asks again for the same calls.
  It runs only in auto mode, only for commands that its `if` filters match, and needs Node.js.
- The scripts and hooks of the core and `dotclaude-jev` plugins run on Node.js 22.18 or later, not on Bun.
  Setup changes a `bun` status line command to `node`.
  The `um` command of `dotclaude-modder` stays on Bun, because it uses the YAML parser of Bun.
  The `allowed-tools` of the `second-opinion` skill allow only `node` with `jev.mjs`, not each `bun` command.
  The `drive-web-browser` skill and the Browser page give `npm install -g agent-browser`.
- A prompt audit against Opus 5.5 removed two numeric reply caps from the output style and the `reviewer` agent, and the `Reason:` line of the old spec format from the Jev note.
  The modder skill says that a `/clear` also removes what is not in `MODLOG.md`.
- `/dotclaude:handoff` is user-invoked only.
  It writes a note that primes the next session: the goal, the constraints, the decisions, the rejected approaches, and the proof.
- `maxEffortLevel` is `xhigh`, and the profile sets no effort level, so each model keeps its default.
- The status line is one file, and it shows the context against the 300K window, yellow at 75% and red at 90%.
- The add-on plugins work without the core plugin.
  `dotclaude-browser` is skill-only, and `dotclaude-jev` gives its own session note.
- `dotclaude-modder` has one skill, `mod-any-game`, and no session note.
  The 8 other skills are step files in `references/` that Claude reads only at their step,
  so the plugin adds one skill listing to each session, not nine.
  The rules of the session note are in the skill.
- `includeGitInstructions` stays at its default, and the profile sets `attribution.commit` and `attribution.pr`.

### Removed

- The operating spec, its SessionStart and SubagentStart injection, and `lib/terms.mjs`.
- The compaction fork, the cold-cache note, and each hook that tells the user to run `/clear`.
- The Bash, edit, secret-redaction, spawn, and attribution guards, and the dependency on `betterleaks`.
- The CodeGraph augment, the `sembr` rewrap, the long-run note, the setup notice, and the Stop prompt hook.
- The Ponytail integration and the `minimal-code` rule.
  The output style has its own rule to write the least code that does the task.
- All plugin options, the `Concise` output style, and the `contribute` skill.
- The agents `translator`, `docs-writer`, `digest-writer`, `eval-designer`, `fuzz-engineer`, `infra-engineer`, and `reverse-engineer`.
- The evals in `plugins/dotclaude/evals/` and `tools/compaction-report.mjs`.
- `advisorModel` and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`.
  The advisor tool adds its instructions to each request, and each advisor call reads the whole context again.
- The `reverse-engineer` agent of `dotclaude-modder`.
  The `reverse-engineer-binary` skill in [xsyetopz/skills](https://github.com/xsyetopz/skills) replaces it.

## [0.26.0] - 2026-10-06

### Migration from 0.25

- Run `/dotclaude:setup` after the update.
  The settings profile now sets `promptCacheTtl` to `"5m"`, and setup writes it over the earlier value.
  The other options, the stored state, the status line, and the `CLAUDE.md` block need no change.

### Removed

- The clause 18 prompt hook on `SubagentStop`.
  Claude Code sends the transcript with each prompt hook call on `Stop` and `SubagentStop`, up to half of the context window of the model.
  In 7 days of sessions, the mean was about 46k tokens, or about $0.046 on Claude Haiku 4.5, for each call.
  Clause 18 already tells the main agent to compare each "done" in a subagent report with the check output.
  The prompt hook on `Stop` stays.

### Changed

- The settings profile sets `promptCacheTtl: 5m` for the main conversation.
  In 7 days of transcripts, 98.7% of the main-agent calls came 5 minutes or less after the call before them.
  At API prices, the 5-minute cache would have cost 8.5% less than the 1-hour cache.
- The section "Long runs" is now "Runs and subagents", and it has a new routing rule for the main agent.
  The main agent does a chain of dependent steps itself, and gives long reads, long check runs, and bulk work to worker agents.
  The main agent does a worker slice itself when its check failed twice.
  In 7 days of transcripts, tool results in the main context cost about 15% of the main-agent cost, because each later turn reads them again.
- The SessionStart context is about 2.5 KB, and the SubagentStart context is about 1 KB.
  Each rule is one line, with a reason only where the rule needs one.
  The rules that a hook teaches (Bash writes, line breaks, `AskUserQuestion`) are not in the context, because the hook message gives the rule when it fires.
  The handoff rules move to the `handoff` skill, and the session context only points to an open note.
  The project AI policy rules come with the ask of the policy guard, because Claude does not see an ask reason.
  Subagents get one section of six rules, with their progress file.
  The section "Known defects" is now "Checks", and the done-claim rule is now rule 12.1.
  The line-break note gives the line numbers of each block, and not the sembr text.
- The agent prompts are about half as long (66 KB to less than 32 KB), and a test keeps all agent files together at 32,000 bytes or less (`AGENTS_MAX_BYTES`).
  They lose the rules that the SubagentStart context now gives each subagent: defects, checks, the turn budget, denies, and the report start.
  They also lose examples and repeated points.
  A new subagent rule tells each subagent to start its report with `Done` or `Not done`.
- Rules 10.6 and 12.1 do not offer the **Not verified** list as an exit.
  When the check of a part fails, the agent fixes the part and runs the check again.
  A part goes under **Not verified** only when its check cannot run.
- Text from outside (AI policy files, CodeGraph index data, and `um kb` field notes) goes to Claude in its own tag, with each `<` escaped, so that the text cannot close the tag.
  The Stop prompt hook puts its input in a `hook_input` tag first, and asks for only the JSON object.
  Wrapper tags around one short block are removed.
- The `handoff` skill is 43% shorter (5.1 KB to 2.9 KB), and it also tells Claude how to read a note.
  The rules removed in 0.26.0: wait-for-go, no-invented-steps, measure, deny-route, deny-final, lower-cost, no-extras, keep-safety, background, blocker, shared-runs, policy-subagent, the progress rules for the main agent, escalate, fix-own, run-checks, self-check, not-verified, and continue.
- **Breaking:** the Terms of Use clauses are now the dotclaude operating spec (`wiki/Operating-Spec.md`).
  Each rule has a number, such as 12.1, and an RFC 2119 level, and each hook reason ends with the number of its rule.
  The text goes to Claude in `dotclaude_spec` tags, and not in `dotclaude_terms` tags.
  The working rules lose the `<verification>` block and the line about LSP, CodeGraph, and `grep`.
  The Jev section loses the line about `AskUserQuestion`, because rule 11.1 says the same thing.
- The rule about a deny moves to the start of the spec, which subagents also get.
  A hook deny is a decision of the user, so the agent does what its reason says, and does not get its result another way.
  A subagent got past a deny in 0.25.1 by rewording a command.
- The Bash guard deny of a write to a project file tells an agent with no `Edit` or `Write`, such as a read-only subagent, to report the write that it needs.
  Before, the deny told it only to use tools that it did not have.
- The wiki labels the subagent cache figures in `Design.md` with their measurement, and records that the Stop hook lets one retry through.
- The cold-cache note counts the idle time from the last compaction of the main agent, and not only from the last turn.
  A compaction writes a new cache, so after it the note does not say that the cache expired too early.

### Fixed

- The clause 18 prompt hook blocked correct messages that list a part as not verified, repeat a claim of another agent that they did not check, or report a run whose results they did not read.
  It now blocks only when it can quote the words of the done claim.
  In a replay of 32 real messages and 5 breaks with the transcript, the system prompt, and the model of Claude Code 2.1.292, false blocks went from 4 of 32 to 2 of 32, and the hook caught 5 of 5 breaks.
  Transcripts do not record `background_tasks` and `session_crons`, so the replay sent them empty.
  A second replay of one real progress report and one false done claim, each with `background_tasks` empty and with a running `just check`, gave the correct result in 4 of 4 runs.
- The clause 18 prompt hook on `Stop` blocked a message that only asked the user for approval.
  The prompt now states rule 12.1 as a stopping condition about the claims of the last message, and not about whether the task is complete.
  In 10 sandbox runs on Claude Haiku 4.5, the false blocks went from 2 to 0, and 2 of 2 unchecked done claims were still blocked.
  The block reason tells the agent to run the check and fix the part, and does not offer the **Not verified** list as an exit.
  The prompt went from 1,859 to 1,498 characters.
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

## Older Releases

| Series | Releases |
| --- | --- |
| [0.23](https://github.com/xsyetopz/dotclaude/wiki/Release-0.23) | 0.23.2, 0.23.1, 0.23.0 |
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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.27.0...HEAD
