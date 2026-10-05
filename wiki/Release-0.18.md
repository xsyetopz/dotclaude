# Release 0.18

Release 0.18 turned dotclaude into a mod.
A hooks module now runs most guards in the Claude Code process, so a tool call starts no hook process.
The working rules moved from an output style to a SessionStart hook.
0.18.1 cut them to 5.1 KB, because a public benchmark showed that a long rule set costs more.
It requires Claude Code 2.1.288.
In 2.1.287, the `tool.call` hook of the module made each Bash call fail in a subagent with `isolation: "worktree"`.
A version in parentheses marks a change from a later patch of this line.
An entry with no version comes from 0.18.0.

## Breaking

- dotclaude is a mod.
  - The hooks module `hooks/register.mjs` runs the PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, UserPromptSubmit, and PreCompact actions.
    It uses the native events `tool.call`, `tool.check`, `agent.spawn`, `turn.step`, `prompt.submit`, and `session.compact`.
  - The classic command hooks for these events are removed.
  - Where Claude Code does not load mods, no guard runs.
    Examples are `--bare`, safe mode, an untrusted workspace, and `allowManagedModsOnly`.
  - SessionStart, Stop, SubagentStop, TaskCompleted, StopFailure, PreModelSwitch, PostModelSwitch, and ConfigChange stay classic command hooks, because no native event can do their work.
    The reasons are in [Claude Mods](Claude-Mods).
  - The module gets no permission mode.
    So a guard can ask in auto, `dontAsk`, and `bypassPermissions` mode where the classic hook stayed quiet.
- A SessionStart hook adds the working rules to each session, in place of the `dotclaude` output style.
  The rules apply with every output style and with no style.
  The hook adds them again after each compaction, and not on `--resume` or in subagents.
- Four optional output styles change only the reply style: `dotclaude:Proactive`, `dotclaude:Concise`, `dotclaude:Explanatory`, and `dotclaude:Learning`.
  Default is no output style.
  No style sets `force-for-plugin`, because a forced style overrides the `outputStyle` of the user.
  Run `/dotclaude:setup` to select a style, or set `outputStyle` in `/config`.
  Setup removes the old value `dotclaude:dotclaude`, because Claude Code falls back to its default for a name that does not exist.

## Added

- The model is not offered the built-in `general-purpose`, `claude`, `Explore`, `Plan`, and `statusline-setup` agents (`agent_guidance`).
  The engine reminders to use the task tools are left out of the request (`gate_tasks`).
- The `polish` skill makes a light edit of a named deliverable in place.
  Only the user starts it.
- After an edit, Claude gets a note when the text that it wrote breaks lines at a column (`context_line_breaks`).
  The note asks for breaks between sentences or clauses.
  The hook runs `semlf --hook claude` when `semlf` is on `PATH`, and a built-in check otherwise.
  Both find a word split between two comment lines.
  `/dotclaude:setup integrations semlf` installs `semlf`.
  The option is off by default (0.18.1), because semantic line breaks are a project convention.
- `apply-settings.mjs --style <name>|Default` selects the output style.
  `Default` removes `outputStyle`.
  Without the flag, setup keeps the current value.
- Two setup switches.
  `builtin-plugins` turns on the `you-should-know` plugin of Claude Code and turns off the other built-in plugins that it can switch.
  `skill-descriptions` cuts each skill description in the skill listing to 300 characters.
- `scripts/count-tokens.mjs` counts the tokens of the output style and of each text that dotclaude injects.
  It needs `ANTHROPIC_API_KEY`.
- The new eval case `t1-found-defect` checks that Claude fixes and reports a second bug.
- `docs/usage-habits.md` gave habits that keep the context small and need no code.
  0.20.0 removed it.
  Examples are `/btw`, `/rewind`, scoped `CLAUDE.md` files, and `/clear` with a handoff note.

## Changed

- Working rules (0.18.0, 0.18.1).
  - The working rules are 5.1 KB, down from about 7 KB and from 8.4 KB in an earlier draft (0.18.1).
    The warn level of their bound is 5,500 bytes (`LIMITS.workingRulesBytes`).
  - A public benchmark measured that a rule set of about 3,100 tokens cost about 25% more than one of about 800 tokens.
  - The rules no longer list forbidden behaviors or ask for a forced objection.
    They no longer ask for a minimal reproducible example in each reply, or for four compactions to occur.
    They no longer run a self-check loop before each reply.
  - The rules and the subagent conventions no longer tell Claude to treat tool results as data.
    Claude then reported harness reminders as prompt injection.
    They tell Claude to treat a correction as new state and to report other defects with their evidence.
    They tell Claude to ask first when a wrong reading of the request is expensive to undo.
  - The rules, the output styles, the hook messages, and the agent and skill prompts follow the prompting guidance of Anthropic.
    The guidance is for Opus 5.5 and Sonnet 5.5.
    Each rule gives its reason, and XML tags are lowercase `snake_case` with no `source` attribute.
  - The rules and the subagent conventions tell Claude to use semantic line breaks in all text that is not code.
    Each sentence starts on a new line, and a long sentence breaks only between clauses.
    The rules, the agents, the skills, and `AGENTS.md` use them now.
    Markdown lint bounds only headings and code blocks to 100 columns.
  - The output style has no copy of the rules of the lean system prompt.
    Reports give only the outcome, with no process history.
    Claude fixes each defect that an MRE proves, uses no adverbs, and lets errors reach the caller.
    Each output style is at most 500 tokens (`LIMITS.outputStyleTokens`, warn 400).
  - The working rules and the compaction carry-over say that the user made each change that no agent made.
    Before, the carry-over said that another session could have made it, and told Claude to check the transcript or the diff.
- Compaction (0.18.1).
  - Before a compaction, the summary request tells Claude to keep these items.
    They are the requests and constraints of the user in the own words of the user.
    They are also the decisions and the rejected approaches with their reasons, and the current state.
    It also keeps the open items, and exact paths, commands, errors, and numbers.
    After four compactions of the main session, the summary starts from the latest handoff note and gives its path.
    `context_compact_carryover` controls it.
  - The global `CLAUDE.md` profile no longer has a `# Compact instructions` section, because the compaction hook sends the same priorities.
    The section that setup writes puts each rule in an XML tag, such as `<installed_tools>` and `<compaction_priorities>`, and gives its reason.
    Run `/dotclaude:setup` to replace the old section.
- Subagents.
  - The subagent conventions name the project test command from a `justfile`, `package.json`, `CLAUDE.md`, or `AGENTS.md`.
    They also name the test command that a build file implies, such as `cargo test`, `go test ./...`, `make test`, `./gradlew test`, `dotnet test`, or `swift test` (0.18.1).
  - The conventions are shorter (0.18.1).
    An agent that cannot edit files (`investigator`, `web-researcher`, `test-runner`) gets no lines about fixes or checks.
  - A subagent report longer than 6,000 characters (10,000 for `reviewer` and `investigator`) is refused once (0.18.1).
    The refusal lists the parts to keep and asks for long detail in a file.
    The second report always passes.
    The subagent conventions give the same limit in `<report_budget>`.
  - The `reviewer` diff lens asks for the defects in the slice, if any, and no longer says that the slice has one (0.18.1).
    The `implementer` adds tests and docs only when the brief or the practice of the repository needs them.
    The `debugger` no longer asks for a measurement of each value that it is sure of.
  - The agent budget gives the full deny text once for each agent, and one short line after that.
- Gates and notes.
  - The `verify` gate reads only the edit ledger, not the words of the reply, because a reply can be in any language (0.18.1).
    It blocks once on an edit with no later check, and once on a failed last check after an edit.
    An edit with no check passes when the project root shows no tests.
    That means no test command in a `justfile`, `package.json`, `CLAUDE.md`, or `AGENTS.md`.
    It also means no build file such as `Cargo.toml`, `go.mod`, `pyproject.toml`, or a `Makefile` with a `test` target.
  - The engine reminder after five API calls with no text asks for one sentence, or for no message (0.18.1).
    The sentence gives a fact, a failure, or a change of plan.
    The engine text asked Claude to say what it does, and 93 of 189 messages that only named the next step came after it.
  - The usage note at 90% asks for the handoff note first, with no condition (0.18.1).
    The context note no longer asks Claude to check if it wrote the handoff note.
    The Fable 5.1 note no longer says that the model batches tool calls less, because no measurement supports it.
- Status line.
  - It shows the reset time of each usage limit at all levels, not only from 75%.
    Reset and pace times use the format of `/usage` in Claude Code: `3pm`, `3:30pm`, or `Oct 4 at 12pm`.
    Before the first API response of a session, the 5-hour and weekly limits come from the `/usage` copy that Claude Code keeps in `~/.claude.json`.
    This applies when the copy is less than one hour old.
  - The cache miss glyph is `✘`, the own cross of Claude Code, not `✗`.
  - It shows `⇊N/4` before the handoff point, and only `⇊N` in red from it, such as `⇊7` (0.18.1).
    `⇊7/4` read as a limit that did not hold.
- The hooks library reaches files, processes, and the environment only through an `io` object.
  Pure path, glob, YAML, and SHA-1 code replaces Node and Bun APIs.
  So the same actions run in the module and in the command hooks.
- `/dotclaude:setup` does not write `autoUpdatesChannel`.
  The default channel, `latest`, gets each fix first.
  The script keeps a channel that the user sets, and it does not remove `"stable"` that an earlier setup wrote.
  To get the default, remove that key by hand.
- The plugin, marketplace, style, and agent descriptions say what each part does, with no name label in front.
- The comments of `MAIN_CONTEXT_TOKENS` and `SUBAGENT_CONTEXT_TOKENS` give the measurements from 2026-09-29 to 2026-10-03 (0.18.1).
  The values do not change.

## Removed

- `hooks/post-tool-use-failure/record-failed-checks.mjs`.
  `record-edits-and-checks.mjs` records a failed check too.
- The announced-work Stop hook `finish-announced-work` (0.18.1).
  It read English phrases in the last paragraph, and by its own count most of its blocks were wrong.
- The held-out evals (`evals-heldout/`) and the reply graders `word-count` and `adverbs` (0.18.1).
  Their regex graders came from failure reports, which are not an acceptance suite.
  The `evals/` cases that a command grades stay.
- The tests that pinned prose (0.18.1): the skill description collision test, and the checks of numbers and phrases in the docs and styles.

## Fixed

- Ledger and gate fixes.
  - Two parallel tool calls that change the session ledger keep both changes.
    Before, the save of one action could replace the save of the other.
  - A subagent with `isolation: "worktree"` records its edits and checks against its worktree.
    Before, its edits got paths below `.claude/worktrees/`, so `gate_verify` did not see them as code edits.
    A worktree that a `WorktreeCreate` hook puts outside the project is the project of its subagent too, also after a `cd`.
  - The edit ledger did not record many check commands, so the `verify` gate asked for a check that ran (0.18.1).
    It now records Gradle and Maven tasks such as `:app:jvmTest` and `spotlessCheck`, and runner options such as `bunx --bun`.
    It also records package scripts such as `release:check`, `swift-format lint`, and scripts with `check`, `verify`, `test`, or `lint` in the name.
    It also records project commands such as `ojd check`.
    Of 60,129 logged Bash commands, the check-like commands that it missed went from 3,099 to 1,546.
  - The edit ledger did not record a check that a wrapper script runs, for example `x27.sh swift test` or `zsh run.sh cargo test` (0.18.1).
    It now also reads the command after a `.sh`, `.bash`, or `.zsh` script.
    Of 87 logged commands that run a check through a toolchain wrapper, it recorded 5 before and 84 now.
  - The edit ledger records the files that `git apply`, `patch`, `git checkout --`, and `git restore` change (0.18.1).
    It reads a patch from a file, from a heredoc, or from stdin with `<`, and it resolves the paths against the directory of `git -C`.
    In a subfolder of a repository, it reads the paths of `git apply` as git does.
    A `diff --git` path starts at the top of the work tree, and another path starts at the subfolder.
  - After Claude wrote a handoff note, the next tool call could still ask for one (0.18.1).
    A write under `.claude/handoffs/` now counts as the context note.
  - In the hooks module, each assistant row counted as one turn, so the turn count of a subagent was too high (0.18.1).
    A run of assistant rows counts as one turn now.
- The search guard denied `grep -r` on a file or a directory when an ignored directory such as `build/` was next to it (0.18.1).
  Only an ignored directory inside the target counts now.
- Compaction carry-over.
  - When the carry-over is longer than its bound, the cut shortens the quoted messages.
    Before, the cut could remove the instructions after them, such as the rule to keep changes that are not Claude's.
  - It puts the newest message of the user in first and drops the oldest messages first.
    Before, the cut removed the newest message first, and each saved message stopped at 600 characters.
    Now it stops at 4000.
    A cut message keeps its start and its end, and the note gives the transcript path for the full text.
  - Each file list stops at 400 characters and gives the count of the other files.
    Before, long paths could fill the bound, and then the cut removed the messages of the user and the instructions.
- In a subagent or a headless session, the request for the full report in a Stop note starts on a new line.
  Before, it came at the end of the last line of the note.
  Before, it came at the end of the last line of the note, such as after a closing tag.
- The tests pass on Linux and Windows.
  - The reset-time tests take the text between the date and the time from the ICU data of the runtime, as `/usage` does.
    So `Oct 4, 12pm` is right too.
  - The carry-over cut test does not depend on the length of the temp folder path.
  - The glob tests give `globFiles` the platform of the host.
  - The hooks module tests give the fake engine a plugin root with the shape of the host.
    Before, a posix root with Windows folders made each guard action fail open.

Previous: [Release 0.17](Release-0.17) · Next: [Release 0.19](Release-0.19)
