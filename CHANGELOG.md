# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

### Added

- The stop gate also runs when Claude marks a task completed. After a code
  edit with no check run after it, the gate keeps the task open once and
  tells Claude to run the tests, build, or lint. The `stop_gate` option
  turns this off too.
- The Bash guard and the edit guard write each deny and ask to
  `verdicts.jsonl` in the plugin data directory, one JSON line each, with
  the target cut to 200 characters. The log shows which rules fire too
  often. It moves to `verdicts.1.jsonl` above about 1 MB.
- `scripts/usage-report.mjs` also counts the main sessions by entrypoint
  (`cli`, `claude-vscode`, `sdk-cli`, `sdk-py`), the usage-limit hits, the
  `Skill` calls by skill, and the guard verdicts per rule from
  `verdicts.jsonl`. `--verdicts FILE` reads a different verdict log.
- When you approve an ask and the tool runs, the guards do not ask again
  in that session for the same command, or the same edit, with the same
  reason. The guard then makes no decision, so your permission rules
  still apply. A deny is never remembered.
- The stop gate sends Claude back once when the last paragraph of its reply
  announces the next step or offers work, such as "Next I'll ..." or "Should
  I ...?". Claude then does the work, or ends the turn again when only you
  can decide. A step that is public or hard to reverse, such as a push or a
  release, and a turn that `AskUserQuestion` ended, pass.
- Each `TaskCompleted` call adds a `task` line to `verdicts.jsonl` with the
  names of its input fields, because the hooks docs do not pin that input
  yet.
- `scripts/usage-report.mjs` reports the cache write on the first call
  after a prompt while the cache is warm, with and without hook context in
  the history (`firstCallAfterPrompt`). On one week of sessions, the write
  was 2.2% of the context with hook context and 1.6% without, so hook
  context did not rewrite the cached prefix
  ([#83913](https://github.com/anthropics/claude-code/issues/83913)).
- Two usage notes for you. On your third correction in a row, a note
  suggests a rewind to before the failed attempts, or a handoff and
  `/clear`. After a reply that stopped with a refusal, a note says to start
  a new session, because the refusal stays in the context. The
  `usage_notes` option turns them off.
- The Bash guard denies a full re-read of a file that the same agent
  already read in full, when the file did not change. This covers a plain
  `cat`, a `Read` after a `cat`, and a `cat` after a `Read`. Claude Code
  already skips a `Read` after a `Read`. A partial `Read`, a piped `cat`,
  and a read after compaction pass.
- A usage note for Claude: on the third identical Bash command in a row
  with identical output in one agent, it says to change the approach or
  wait with `Monitor`. The `usage_notes` option turns it off.
- The Bash guard denies a foreground command that does not end by itself
  or runs for a long time: a `dev`, `serve`, or `watch` script, `--watch`,
  `tail -f`, and Ghidra's `analyzeHeadless`. The reason says to run the
  same command with `run_in_background`. A shell `&` or a `timeout`
  wrapper passes.
- The global `CLAUDE.md` section of the settings profile has a
  `# Compact instructions` section. It tells the compaction summary to keep
  your requests in your own words, decisions with their reasons, and exact
  paths, commands, and errors.
- A subagent that `SendMessage` resumes gets no second copy of the working
  conventions. Claude Code fires `SubagentStart` again on a resume
  ([#80489](https://github.com/anthropics/claude-code/issues/80489)), and
  the agent already has the text.
- With 5 subagents running, an `Agent` call is denied before Claude Code
  refuses it. The reason tells Claude to wait for a report and then send the
  next wave. The count comes from `SubagentStart` and `SubagentStop`. An
  agent with no activity for 10 minutes no longer counts, because an
  interrupted agent can end without `SubagentStop`. The
  `subagent_guidance` option turns this off.
- The Bash guard asks before `git add` stages a file with an ELF, Mach-O,
  or PE header, because a committed binary stays in the history.
- `/dotclaude:setup-integrations` sets up Ghidra. It registers the MCP
  server `pyghidra-mcp` in the reverse-engineering project only, and it
  installs the `ghidra-bridge` CLI as the fallback. The status reports
  `uvx`, Python 3.10 or newer, `GHIDRA_INSTALL_DIR` with `analyzeHeadless`,
  Java 21, the `ghidra` MCP entry, and the CLI.
- A `reverse-engineer` agent on Opus 5.5 with effort `high` analyzes a
  binary, protocol, or file format with Ghidra. It uses the `ghidra` MCP
  tools first and the `ghidra-bridge` CLI only when they are missing or
  fail, and its report names the path. For matching work, it pins the
  SHA-256 of the input, compares bytes and relocations, and keeps an
  iteration log. It does not analyze the Claude Code binary.
- `scripts/usage-report.mjs` counts the dotclaude agent runs that reached
  their turn-limit reserve. For each agent type, it gives the median files
  and list items in the brief of those runs and of the other runs. On one
  week, most capped briefs named one behavior, and long runs passed the
  100k context bound near turn 20. So the `implementer` limit stays 80.
- The 5-hour and weekly limits on the status line show their pace, as
  CodexBar does. `▲12%→12:46` is a deficit: usage runs 12 points ahead of
  an even rate, and at this rate the limit is used up at 12:46. `▼30%` is a
  reserve. The pace shows after 3% of the window is gone.

### Changed

- The main status line is more compact. One-column glyphs replace words:
  `⎇` for the branch, `⊞` for the worktree, `◷` and `◌` for a warm and cold
  cache, `✗` for cache misses, and `▲` and `▼` for a limit deficit and
  reserve. The warm cache shows the minutes until it expires, not the clock
  time. The context bar has 5 cells, not 8.
- The status line does not count a cache miss after a model switch, because
  a new model starts a new cache. Claude Code already keeps the first call
  and the call after a compaction out of its miss count.
  `scripts/usage-report.mjs` counts full cache rewrites on the first call,
  after a compaction, and after a model switch as expected, apart from the
  rewrites that nothing explains.
- The settings profile and the usage bounds allow 5 agents at once, not 3.
  Five is the community figure, and a cap of 3 caused 50 of 77 measured
  `Agent` errors. When you apply the profile, a value of `3` that 0.11.1
  wrote becomes `5`, and any other value that you set stays. 0.12.0 removes
  and renames no profile value, so a settings file that 0.11.1 wrote keeps
  all its other values. A test applies the profile to a real 0.11.1 output.

### Fixed

- Files that a Bash command writes now get the same checks as the `Edit`
  and `Write` tools. Before, `cat > tests/a.test.mjs <<'EOF'` could remove
  every assertion, and a heredoc could write broken YAML frontmatter, with
  no question. The checks cover redirects, `tee`, `sed -i`, `sd`, `cp`,
  `mv`, and file writes in inline interpreter code. A new file under a
  build directory does not get the generated-file warning. The `edit_guard`
  option turns these checks off.
- The Bash guard asks before snapshot updates through a package script, such
  as `npm test -- -u` or `pnpm test -u`. Before, only direct runner calls
  asked. The reason now tells Claude to find the cause of a failing test
  before it updates the snapshots.
- The stop gate counts a Python write through a `Path` variable as an edit,
  such as `p = pathlib.Path("src/a.cs")` and then `p.write_text(s)`. Before,
  Claude could edit code this way and stop with no check run.
- The Bash guard expands a glob in a search path, as the shell does, before
  it looks for ignored directories. Before, `grep -rn x docs/*.md` was
  denied because `docs/` has ignored directories, although the glob names
  only files. `grep -r x *` is still denied when `*` matches an ignored
  directory.
- The Bash guard resolves paths after `cd ~/dir` against your home
  directory. Before, `cd ~/.claude/projects && find .` was checked as if it
  ran in the project, and the guard denied it for the project's ignored
  directories. After `cd $DIR`, the guard now treats the directory as
  unknown and does not guess the project root.
- The Bash guard no longer treats a backtick in Python, Node, Bun, or Deno
  code as a shell command. Before, a Python heredoc that wrote Markdown with
  code spans, such as a CHANGELOG entry, was checked string by string as
  shell commands and could be denied. Backticks still count in Perl, Ruby,
  and PHP, where they run a shell.

## [0.11.1] - 2026-09-29

After updating, restart Claude Code. You do not need to run
`/dotclaude:apply-settings-profile` again, because the settings profile did
not change.

### Changed

- The reminder for agents on Sonnet 5.5 (`implementer`, `docs-writer`, and
  `mechanical-worker`) also tells them to write only in the files that the
  brief names, to put scratch files in the system temp folder, and to report
  defects outside the brief, not fix them. In one user's test of 35 bug-fix
  tasks, both models fixed 34, but Sonnet 5.5 wrote outside its assigned
  folder 4 times and Opus 5.5 0 times.
- The model documentation (`docs/models.md` and the Plans And Models dossier
  page) gives this reason. It also gives the reported cost data: Sonnet 5.5
  costs less per task than Opus 5.5 only at `low` and `medium` effort. This
  is why the Sonnet 5.5 agents stay at `medium`.

### Fixed

- The `[unreleased]` compare link at the end of the CHANGELOG starts from the
  latest release, not 0.8.1. `just bump` now moves it to the new version.

## [0.11.0] - 2026-09-29

Requires Claude Code 2.1.284 or later, the first release with Sonnet 5.5.
After updating, run `claude update` if you need to, restart Claude Code, and
run `/dotclaude:apply-settings-profile` again.

### Added

- Session start tells you when Claude Code is older than 2.1.284, from
  `claude --version` of the running binary, and says to run `claude update`.

### Changed

- The settings profile compacts at 150k tokens, not 200k. The system prompt,
  the session notes, and the status line use the same handoff point. From
  2026-09-28 to 2026-09-29, main-conversation calls past 150k were 13% of the
  cost.
- A subagent's tool calls are refused past 100k tokens of context, not 150k.
  With the 150k bound, 34 of 69 `implementer` runs still passed 100k, and
  subagent calls from 100k to 150k were 9% of the cost. `code-reviewer`,
  `security-reviewer`, and `plan-reviewer` keep 150k, because a split review
  loses the view across files and writes it to the cache again. The injected
  context budget and the subagent status line row show each agent's bound.
- The system prompt and the `implementer` description ask for one small slice
  for each `implementer`, with larger work split across new agents.
- Sonnet 5.5 (`claude-sonnet-5-5`) replaces Sonnet 5 everywhere: the
  `implementer`, `docs-writer`, and `mechanical-worker` agents, the profile's
  `CLAUDE_CODE_SUBAGENT_MODEL` and `availableModels`,
  the managed drop-in, and the default `allowed_models`. The prices are the
  same. Re-applying the profile removes `claude-sonnet-5` from
  `availableModels`. If you set `allowed_models` yourself, replace
  `claude-sonnet-5` with `claude-sonnet-5-5`.
- `mechanical-worker` runs at `medium` effort, not `low`. Anthropic
  recalibrated Sonnet 5.5's effort levels and gives `medium` as the start for
  well-specified agentic coding. At `low`, it sometimes reports a change as
  done without a check.
- `test-runner` runs on Haiku 4.5, not Sonnet 5 at `low` effort. It runs one
  command and copies the failure lines, which needs no judgment, and Haiku
  costs half as much per token. It starts without `CLAUDE.md` and without
  the CodeGraph MCP tool, and its report copies each error line exactly.
- The reminder for agents on Sonnet 5.5 also asks for a real check before a
  code change is reported as done. A syntax-only check, or a command that did
  not start, does not count.

## Older Releases

| Series | Releases |
| --- | --- |
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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.11.1...HEAD
