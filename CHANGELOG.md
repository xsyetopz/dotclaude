# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

## [0.18.1] - 2026-10-03

### Changed

- Before a compaction, the summary request tells Claude to keep your requests and constraints in your own words, the decisions and the rejected approaches with their reasons, the current state, the open items, and exact paths, commands, errors, and numbers.
  After four compactions of the main session, the summary starts from the latest handoff note and gives its path.
  `context_compact_carryover` controls it.
- The engine reminder after five API calls with no text now asks for a fact, a failure, or a change of plan in one sentence, or for no message.
  The engine text asked Claude to say what it does, and 93 of 189 messages that only named the next step came after it.
- A subagent report longer than 6,000 characters (10,000 for `reviewer` and `investigator`) is refused once, with the parts to keep and a request to put long detail in a file.
  The second report always passes.
  The subagent conventions give the same limit in `<report_budget>`.
- The announced-work check no longer reads a reply for a choice, because a reply can be in any language.
  The working rules and the block reason tell Claude to ask a choice with `AskUserQuestion`, which the check passes.
  A question about a commit, a tag, a merge, a release, or a version bump passes, and so does a request to allow a denied command.
- The status line shows `⇊N/4` before the handoff point, and only `⇊N` in red from it, such as `⇊7`.
  `⇊7/4` read as a limit that did not hold.
- The comments of `MAIN_CONTEXT_TOKENS` and `SUBAGENT_CONTEXT_TOKENS` give the measurements from 2026-09-29 to 2026-10-03.
  The values do not change.
- The working rules tell Claude to reproduce and fix a case that the requested behavior does not handle, as part of the task.
  The old rule told Claude to report such a case as a gap, and Claude then stopped with the work not done.
  A part is blocked only when it needs a decision, an access, or information that only you can give.
- The working rules tell Claude to treat a correction as new state, with no apology, defense, or explanation of the error unless you ask for it.
- The final report gives an unverified part, an assumption, or a remaining item only when it changes what you do next,
  and adds a recommendation or a caveat only when correctness, safety, or completion needs it.
  Before Claude sends a reply, it checks each sentence against the request, your constraints, and the evidence,
  and does each remaining item that it can do with its tools.

### Fixed

- The search guard denied `grep -r` on a file or a directory when an ignored directory such as `build/` was next to it.
  Only an ignored directory inside the target counts now.
- In the hooks module, each assistant row counted as one turn, so the turn count of a subagent was too high.
  A run of assistant rows counts as one turn now.
- The edit ledger did not record many check commands, so the verify gate asked for a check that ran.
  It now records Gradle and Maven tasks such as `:app:jvmTest` and `spotlessCheck`, runner options such as `bunx --bun`, package scripts such as `release:check`, `swift-format lint`, scripts with `check`, `verify`, `test`, or `lint` in the name, and project commands such as `ojd check`.
  Of 60,129 logged Bash commands, the check-like commands that it missed went from 3,099 to 1,546.
- The edit ledger did not record a check that a wrapper script runs, for example `x27.sh swift test` or `zsh run.sh cargo test`.
  It now also reads the command after a `.sh`, `.bash`, or `.zsh` script.
  Of 87 logged commands that run a check through a toolchain wrapper, it recorded 5 before and 84 now.
- The edit ledger now records the files that `git apply`, `patch`, `git checkout --`, and `git restore` change.
  It reads a patch from a file, from a heredoc, or from stdin with `<`, and it resolves the paths against the directory of `git -C`.
  In a subfolder of a repository, it reads the paths of `git apply` as git does: a `diff --git` path from the top of the work tree, and another path from the subfolder.
- After Claude wrote a handoff note, the next tool call could still ask for one.
  A write under `.claude/handoffs/` now counts as the context note.

## [0.18.0] - 2026-10-03

### Breaking

- dotclaude is a mod. The hooks module `hooks/register.mjs` runs the
  PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart,
  UserPromptSubmit, and PreCompact actions with the native events
  `tool.call`, `tool.check`, `agent.spawn`, `turn.step`, `prompt.submit`, and
  `session.compact`. The classic command hooks for these events are removed,
  so a tool call starts no hook process. Where Claude Code does not load
  mods, such as with `--bare`, in safe mode, in an untrusted workspace, or
  with `allowManagedModsOnly`, no guard runs.
- SessionStart, Stop, SubagentStop, TaskCompleted, StopFailure,
  PreModelSwitch, PostModelSwitch, and ConfigChange stay classic command
  hooks, because no native event can do their work. The reasons are in
  `docs/mods.md`.
- The module gets no permission mode. So a guard can ask in auto, `dontAsk`,
  and `bypassPermissions` mode where the classic hook stayed quiet.
- A SessionStart hook adds the working rules to each session, in place of
  the `dotclaude` output style. The rules apply with every output style and
  with no style. The hook adds them again after each compaction, and not on
  `--resume` or in subagents.
- Four optional output styles change only the reply style:
  `dotclaude:Proactive`, `dotclaude:Concise`, `dotclaude:Explanatory`, and
  `dotclaude:Learning`. Default is no output style. No style sets
  `force-for-plugin`, because a forced style overrides your `outputStyle`.
  Run `/dotclaude:setup` to select a style, or set `outputStyle` in
  `/config`. Setup removes the old value `dotclaude:dotclaude`, because
  Claude Code falls back to its default for a name that does not exist.

### Added

- The model is not offered the built-in `general-purpose`, `claude`,
  `Explore`, `Plan`, and `statusline-setup` agents (`agent_guidance`). The
  engine reminders to use the task tools are left out of the request
  (`gate_tasks`).
- The `polish` skill makes a light edit of a named deliverable in place. Only
  the user starts it.
- `scripts/count-tokens.mjs` counts the tokens of the output style and of
  each text that dotclaude injects. It needs `ANTHROPIC_API_KEY`.
- The evals grade the word count and the adverbs of the final reply, and the
  new case `t1-found-defect` checks that Claude fixes and reports a second
  bug.
- After an edit, Claude gets a note when the text that it wrote breaks lines
  at a column, not between sentences or clauses (`context_line_breaks`). The
  hook runs `semlf --hook claude` when `semlf` is on `PATH`, and a built-in
  check otherwise. Both find a word split between two comment lines.
  `/dotclaude:setup integrations semlf` installs `semlf`.
- `apply-settings.mjs --style <name>|Default` selects the output style.
  `Default` removes `outputStyle`. Without the flag, setup keeps the current
  value.
- Two setup switches. `builtin-plugins` turns on Claude Code's
  `you-should-know` plugin and turns off the other built-in plugins that it
  can switch. `skill-descriptions` cuts each skill description in the skill
  listing to 300 characters.
- `docs/usage-habits.md` gives habits that keep the context small and need
  no code, such as `/btw`, `/rewind`, scoped `CLAUDE.md` files, and `/clear`
  with a handoff note.

### Changed

- The output style has no copy of the lean system prompt's rules, and its
  bound is 2,350 tokens. Reports give only the outcome, with no process
  history. Claude fixes each defect that an MRE confirms, uses no adverbs,
  and lets errors reach the caller.
- The subagent conventions name the project's test command from a
  `justfile`, `package.json`, `CLAUDE.md`, or `AGENTS.md`.
- The announced-work check finds more offers and deferrals, such as "if you
  want" and "left as a follow-up". Only a push, publish, or delete question
  is exempt.
- The agent budget gives the full deny text once for each agent, and one
  short line after that.
- The hooks library reaches files, processes, and the environment only
  through an `io` object, with pure path, glob, YAML, and SHA-1 code in place
  of Node and Bun APIs. So the same actions run in the module and in the
  command hooks.
- The status line shows the reset time of each usage limit at all levels,
  not only from 75%. Reset and pace times use the format of Claude Code's
  `/usage`: `3pm`, `3:30pm`, or `Oct 4 at 12pm`. Before the first API
  response of a session, the 5-hour and weekly limits come from the
  `/usage` copy that Claude Code keeps in `~/.claude.json`, when it is less
  than one hour old.
- The cache miss glyph is `✘`, Claude Code's own cross, not `✗`.
- The working rules, the output styles, the hook messages, and the agent and
  skill prompts follow Anthropic's prompting guidance for Opus 5.5 and
  Sonnet 5.5. Each rule gives its reason, and XML tags are lowercase
  `snake_case` with no `source` attribute.
- The global `CLAUDE.md` section that setup writes puts each rule in an XML
  tag, such as `<installed_tools>` and `<compaction_priorities>`, and gives
  its reason. The `# Compact instructions` heading stays, because Claude
  Code's compaction prompt finds summary instructions by a heading. Run
  `/dotclaude:setup` to replace the old section.
- The plugin, marketplace, style, and agent descriptions say what each part
  does, with no name label in front.
- The working rules are about 7 KB (`LIMITS.workingRulesBytes`, warn 7500,
  fail 9000). Each output style is at most 500 tokens
  (`LIMITS.outputStyleTokens`, warn 400).
- dotclaude requires Claude Code 2.1.288. In 2.1.287, the `tool.call` hook
  of the module made each Bash call fail in a subagent with
  `isolation: "worktree"`. 2.1.288 fixes it.
- `/dotclaude:setup` does not write `autoUpdatesChannel`. The default
  channel, `latest`, gets each fix first. The script keeps a channel that
  you set, and it does not remove `"stable"` that an earlier setup wrote.
  To get the default, remove that key yourself.
- The working rules and the subagent conventions tell Claude to use semantic
  line breaks in all text that is not code: each sentence starts on a new
  line, and a long sentence breaks only between clauses. The rules,
  the agents, the skills, and `AGENTS.md` use them now. Markdown lint bounds
  only headings and code blocks to 100 columns.

### Removed

- `hooks/post-tool-use-failure/record-failed-checks.mjs`.
  `record-edits-and-checks.mjs` records a failed check too.

### Fixed

- Two parallel tool calls that change the session ledger keep both changes.
  Before, the save of one action could replace the save of the other.
- A subagent with `isolation: "worktree"` records its edits and checks against
  its worktree. Before, its edits got paths below `.claude/worktrees/`, so
  `gate_verify` did not see them as code edits. A worktree that a
  `WorktreeCreate` hook puts outside the project is the project of its
  subagent too, also after a `cd`.
- The Stop reason for an announced step also names a deferred step, and it
  tells Claude to end the turn again when the work is outside the request.
- When the compaction carry-over is longer than its bound, the cut shortens
  the quoted messages. Before, the cut could remove the instructions after
  them, such as the rule to keep changes that are not Claude's.
- The compaction carry-over puts your newest message in first and drops the
  oldest messages first. Before, the cut removed the newest message first,
  and each saved message stopped at 600 characters. Now it stops at 4000. A cut message keeps its
  start and its end, and the note gives the transcript path for the full
  text.
- Each file list in the compaction carry-over stops at 400 characters and
  gives the count of the other files. Before, long paths could fill the
  bound, and then the cut removed your messages and the instructions.
- When a subagent or a headless session gets a Stop note, the sentence that
  asks for the full report starts on a new line. Before, it came at the end
  of the last line of the note, such as after a closing tag.
- The working rules and the compaction carry-over say that you made each change that no agent made.
  Before, the carry-over said that another session could have made it,
  and told Claude to check the transcript or the diff.
- The tests pass on Linux and Windows.
  The reset-time tests take the text between the date and the time from the ICU data of the runtime,
  as Claude Code's `/usage` does, so `Oct 4, 12pm` is correct too.
  The carry-over cut test does not depend on the length of the temp folder path.
  The glob tests give `globFiles` the platform of the host.
  The hooks module tests give the fake engine a plugin root with the shape of the host,
  because a posix root with Windows folders made each guard action fail open.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.17](docs/changelog/0.17.md) | 0.17.1, [0.17.0](docs/changelog/0.17.0.md) |
| [0.16](docs/changelog/0.16.md) | 0.16.1, 0.16.0 |
| [0.15](docs/changelog/0.15.md) | 0.15.1, 0.15.0 |
| [0.14](docs/changelog/0.14.md) | 0.14.1, 0.14.0 |
| [0.13](docs/changelog/0.13.md) | 0.13.1, 0.13.0 |
| [0.12](docs/changelog/0.12.md) | 0.12.1, 0.12.0 |
| [0.11](docs/changelog/0.11.md) | 0.11.1, 0.11.0 |
| [0.10](docs/changelog/0.10.md) | 0.10.2, 0.10.1, 0.10.0 |
| [0.9](docs/changelog/0.9.md) | 0.9.0 |
| [0.8](docs/changelog/0.8.md) | 0.8.2, 0.8.1, 0.8.0 |
| [0.7](docs/changelog/0.7.md) | 0.7.0 |
| [0.6](docs/changelog/0.6.md) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](docs/changelog/0.5.md) | 0.5.1, 0.5.0 |
| [0.4](docs/changelog/0.4.md) | 0.4.0 |
| [0.3](docs/changelog/0.3.md) | 0.3.0 |
| [0.1 and 0.2](docs/changelog/0.1-0.2.md) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.18.1...HEAD
