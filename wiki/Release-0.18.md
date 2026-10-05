# Release 0.18

Released 2026-10-03.
dotclaude became a mod, and the working rules moved to a SessionStart hook and shrank to 5.1 KB in 0.18.1.
A version in parentheses marks a later patch of this line, and an entry with no version comes from 0.18.0.

> **Note:** This line requires Claude Code 2.1.288.
> In 2.1.287, the `tool.call` hook of the module made each Bash call fail in a subagent with `isolation: "worktree"`.

## Breaking

- Mod: a hooks module `hooks/register.mjs` runs most guards in the Claude Code process, so a tool call starts no hook process.
  - It runs the PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, UserPromptSubmit, and PreCompact actions.
    It uses the native events `tool.call`, `tool.check`, `agent.spawn`, `turn.step`, `prompt.submit`, and `session.compact`.
  - The classic command hooks for these events are removed.
  - Where Claude Code does not load mods, no guard runs.
    Examples are `--bare`, safe mode, an untrusted workspace, and `allowManagedModsOnly`.
  - SessionStart, Stop, SubagentStop, TaskCompleted, StopFailure, PreModelSwitch, PostModelSwitch, and ConfigChange stay classic command hooks, because no native event can do their work.
    The reasons are in [Claude Mods](Claude-Mods).
  - The module gets no permission mode.
    So a guard can ask in auto, `dontAsk`, and `bypassPermissions` mode where the classic hook stayed quiet.
- Working rules: a SessionStart hook adds them to each session, in place of the `dotclaude` output style.
  They apply with every output style and with no style.
  The hook adds them again after each compaction, and not on `--resume` or in subagents.
- Output styles: four optional styles change only the reply style.
  They are `dotclaude:Proactive`, `dotclaude:Concise`, `dotclaude:Explanatory`, and `dotclaude:Learning`.
  - Default is no output style, and no style sets `force-for-plugin`, because a forced style overrides the `outputStyle` of the user.
  - Run `/dotclaude:setup` to select a style, or set `outputStyle` in `/config`.
    Setup removes the old value `dotclaude:dotclaude`, because Claude Code falls back to its default for a name that does not exist.

## Added

- `agent_guidance`: the model is not offered the built-in `general-purpose`, `claude`, `Explore`, `Plan`, and `statusline-setup` agents.
  `gate_tasks` leaves the engine reminders to use the task tools out of the request.
- `polish` skill: makes a light edit of a named deliverable in place, and only the user starts it.
- `context_line_breaks`: after an edit, Claude gets a note when the text that it wrote breaks lines at a column.
  - The note asks for breaks between sentences or clauses.
    The hook runs `semlf --hook claude` when `semlf` is on `PATH`, and a built-in check otherwise.
    Both find a word split between two comment lines.
  - `/dotclaude:setup integrations semlf` installs `semlf`.
  - The option is off by default (0.18.1), because semantic line breaks are a project convention.
- `apply-settings.mjs --style <name>|Default`: selects the output style.
  `Default` removes `outputStyle`, and without the flag setup keeps the current value.
- Setup switch `builtin-plugins`: turns on the `you-should-know` plugin of Claude Code and turns off the other built-in plugins that it can switch.
- Setup switch `skill-descriptions`: cuts each skill description in the skill listing to 300 characters.
- `scripts/count-tokens.mjs`: counts the tokens of the output style and of each text that dotclaude injects (needs `ANTHROPIC_API_KEY`).
- Eval case `t1-found-defect`: checks that Claude fixes and reports a second bug.
- `docs/usage-habits.md` (removed in 0.20.0): habits that keep the context small and need no code, such as `/btw`, `/rewind`, scoped `CLAUDE.md` files, and `/clear` with a handoff note.

## Changed

- Working rules size (0.18.1): 5.1 KB, down from about 7 KB and from 8.4 KB in an earlier draft.
  The warn level of the bound is 5,500 bytes (`LIMITS.workingRulesBytes`).
  A public benchmark measured that a rule set of about 3,100 tokens cost about 25% more than one of about 800 tokens.
- Working rules dropped: the lists of forbidden behaviors, the forced objection, the minimal reproducible example in each reply, the four compactions, and the self-check loop before each reply.
- Working rules, tool results: the rules and the subagent conventions no longer tell Claude to treat tool results as data.
  They tell Claude to treat a correction as new state and to report other defects with their evidence.
  They tell Claude to ask first when a wrong reading of the request is expensive to undo.
- Prompting guidance: the rules, the output styles, the hook messages, and the agent and skill prompts follow the guidance of Anthropic for Opus 5.5 and Sonnet 5.5.
  Each rule gives its reason, and XML tags are lowercase `snake_case` with no `source` attribute.
- Semantic line breaks: the rules and the subagent conventions tell Claude to use them in all text that is not code.
  The rules, the agents, the skills, and `AGENTS.md` use them now, and Markdown lint bounds only headings and code blocks to 100 columns.
- Output style: it has no copy of the rules of the lean system prompt.
  Reports give only the outcome, Claude fixes each defect that an MRE proves, uses no adverbs, and lets errors reach the caller.
  Each output style is at most 500 tokens (`LIMITS.outputStyleTokens`, warn 400).
- Unknown changes: the working rules and the compaction carry-over say that the user made each change that no agent made.
- Compaction (0.18.1), `context_compact_carryover`: the summary request tells Claude to keep these items.
  - The requests and constraints of the user in the own words of the user.
  - The decisions and the rejected approaches with their reasons, and the current state.
  - The open items, and exact paths, commands, errors, and numbers.
  - After four compactions of the main session, the summary starts from the latest handoff note and gives its path.
- Global `CLAUDE.md` profile: it no longer has a `# Compact instructions` section, because the compaction hook sends the same priorities.
  The section that setup writes puts each rule in an XML tag, such as `<installed_tools>` and `<compaction_priorities>`, and gives its reason.
  Run `/dotclaude:setup` to replace the old section.
- Subagent test command (0.18.1): the conventions name the project test command from a `justfile`, `package.json`, `CLAUDE.md`, or `AGENTS.md`.
  They also name the command that a build file implies, such as `cargo test`, `go test ./...`, `make test`, `./gradlew test`, `dotnet test`, or `swift test`.
- Subagent conventions (0.18.1): an agent that cannot edit files (`investigator`, `web-researcher`, `test-runner`) gets no lines about fixes or checks.
- Subagent report bound (0.18.1): a report longer than 6,000 characters (10,000 for `reviewer` and `investigator`) is refused once.
  The refusal lists the parts to keep and asks for long detail in a file.
  The second report always passes.
  The conventions give the same limit in `<report_budget>`.
- Agent prompts (0.18.1): the `reviewer` diff lens asks for the defects in the slice, if any, and no longer says that the slice has one.
  The `implementer` adds tests and docs only when the brief or the practice of the repository needs them.
  The `debugger` no longer asks for a measurement of each value that it is sure of.
- Agent budget: gives the full deny text once for each agent, and one short line after that.
- `verify` gate (0.18.1): reads only the edit ledger, not the words of the reply, because a reply can be in any language.
  - It blocks once on an edit with no later check, and once on a failed last check after an edit.
  - An edit with no check passes when the project root shows no tests.
    That means no test command in a `justfile`, `package.json`, `CLAUDE.md`, or `AGENTS.md`, and no build file such as `Cargo.toml`, `go.mod`, `pyproject.toml`, or a `Makefile` with a `test` target.
- Engine reminder after five API calls with no text (0.18.1): it asks for one sentence, or for no message.
  The sentence gives a fact, a failure, or a change of plan.
  The engine text asked Claude to say what it does, and 93 of 189 messages that only named the next step came after it.
- Notes (0.18.1): the usage note at 90% asks for the handoff note first, with no condition.
  The context note no longer asks Claude to check if it wrote the handoff note.
  The Fable 5.1 note no longer says that the model batches tool calls less, because no measurement supports it.
- Status line reset times: the status line shows the reset time of each usage limit at all levels, not only from 75%.
  - Reset and pace times use the format of `/usage` in Claude Code: `3pm`, `3:30pm`, or `Oct 4 at 12pm`.
  - Before the first API response of a session, the 5-hour and weekly limits come from the `/usage` copy in `~/.claude.json`, when the copy is less than one hour old.
- Status line cache miss glyph: `✘`, the own cross of Claude Code, not `✗`.
- Status line handoff point (0.18.1): the line shows `⇊N/4` before it, and only `⇊N` in red from it, such as `⇊7`.
  `⇊7/4` read as a limit that did not hold.
- Hooks library: it reaches files, processes, and the environment only through an `io` object.
  Pure path, glob, YAML, and SHA-1 code replaces Node and Bun APIs, so the same actions run in the module and in the command hooks.
- `/dotclaude:setup`: does not write `autoUpdatesChannel`, because the default channel, `latest`, gets each fix first.
  The script keeps a channel that the user sets, and it does not remove `"stable"` that an earlier setup wrote.
  To get the default, remove that key by hand.
- Descriptions: the plugin, marketplace, style, and agent descriptions say what each part does, with no name label in front.
- `MAIN_CONTEXT_TOKENS` and `SUBAGENT_CONTEXT_TOKENS` (0.18.1): the comments give the measurements from 2026-09-29 to 2026-10-03, and the values do not change.

## Removed

- `hooks/post-tool-use-failure/record-failed-checks.mjs`: `record-edits-and-checks.mjs` records a failed check too.
- `finish-announced-work` Stop hook (0.18.1): it read English phrases in the last paragraph, and by its own count most of its blocks were wrong.
- Held-out evals (`evals-heldout/`) and the reply graders `word-count` and `adverbs` (0.18.1): their regex graders came from failure reports, which are not an acceptance suite.
  The `evals/` cases that a command grades stay.
- Tests that pinned prose (0.18.1): the skill description collision test, and the checks of numbers and phrases in the docs and styles.

## Fixed

- Ledger, parallel calls: two tool calls that change the session ledger keep both changes.
  Before, the save of one action could replace the save of the other.
- Ledger, worktree subagents: a subagent with `isolation: "worktree"` records its edits and checks against its worktree.
  Before, its edits got paths below `.claude/worktrees/`, so `gate_verify` did not see them as code edits.
  A worktree that a `WorktreeCreate` hook puts outside the project is the project of its subagent too, also after a `cd`.
- Ledger, check commands (0.18.1): it missed many, so the `verify` gate asked for a check that ran.
  It now records Gradle and Maven tasks such as `:app:jvmTest` and `spotlessCheck`, runner options such as `bunx --bun`, package scripts such as `release:check`, `swift-format lint`, and scripts with `check`, `verify`, `test`, or `lint` in the name.
  It also records project commands such as `ojd check`.
  Of 60,129 logged Bash commands, the check-like commands that it missed went from 3,099 to 1,546.
- Ledger, wrapper scripts (0.18.1): it missed a check that a wrapper script runs, for example `x27.sh swift test` or `zsh run.sh cargo test`.
  It now also reads the command after a `.sh`, `.bash`, or `.zsh` script.
  Of 87 logged commands that run a check through a toolchain wrapper, it recorded 5 before and 84 now.
- Ledger, patch edits (0.18.1): it records the files that `git apply`, `patch`, `git checkout --`, and `git restore` change.
  It reads a patch from a file, from a heredoc, or from stdin with `<`, and it resolves the paths against the directory of `git -C`.
  In a subfolder of a repository, it reads the paths of `git apply` as git does.
  A `diff --git` path starts at the top of the work tree, and another path starts at the subfolder.
- Handoff note (0.18.1): after Claude wrote one, the next tool call could still ask for one.
  A write under `.claude/handoffs/` now counts as the context note.
- Subagent turns (0.18.1): in the hooks module, each assistant row counted as one turn, so the turn count of a subagent was too high.
  A run of assistant rows counts as one turn now.
- Search guard (0.18.1): it denied `grep -r` on a file or a directory when an ignored directory such as `build/` was next to it.
  Only an ignored directory inside the target counts now.
- Carry-over bound: when it is longer than its bound, the cut shortens the quoted messages.
  Before, the cut could remove the instructions after them, such as the rule to keep changes that are not Claude's.
- Carry-over order: the newest user message goes in first, and the oldest drop first.
  Before, the newest dropped first, and each saved message stopped at 600 characters.
  Now it stops at 4000, and a cut message keeps its start and its end, and the note gives the transcript path for the full text.
- File lists: each stops at 400 characters and gives the count of the other files.
  Before, long paths could fill the bound, and then the cut removed the messages of the user and the instructions.
- Stop note: in a subagent or a headless session, the request for the full report starts on a new line.
  Before, it came at the end of the last line of the note, such as after a closing tag.
- The tests pass on Linux and Windows.
  - The reset-time tests take the text between the date and the time from the ICU data, as `/usage` does, so `Oct 4, 12pm` is right too.
  - The carry-over cut test does not depend on the length of the temp folder path.
  - The glob tests give `globFiles` the platform of the host.
  - The hooks module tests give the fake engine a plugin root with the shape of the host.
    Before, a posix root with Windows folders made each guard action fail open.

Previous: [Release 0.17](Release-0.17) · Next: [Release 0.19](Release-0.19)
