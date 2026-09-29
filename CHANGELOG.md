# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

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

## [0.10.2] - 2026-09-28

### Changed

- The main status line counts only prompt cache misses that something broke,
  for example a model, tool, or system prompt change. It does not count misses
  from idle time past the cache lifetime (`ttl_expired_5m`, `ttl_expired_1h`),
  because they break nothing and the stale-cache notice already covers them.

## [0.10.1] - 2026-09-28

### Added

- Public documentation in `docs/`, from `docs/README.md`. Each page tells what
  each part of dotclaude does and why, and links to the dossier for the
  evidence: hooks, models, agents and skills, working rules, the settings
  profile, the status line, and development.
- The `explain-dotclaude` skill. When you ask why Claude or dotclaude did,
  blocked, or asked about something, Claude answers from the documentation
  with the reason, its source, and how to change it.

### Changed

- The README is a short overview that links to the documentation. The hook
  details, options, settings profile, and development notes moved to
  `docs/`.
- The main status line's `statusLine` setting sets `refreshInterval: 60`, so
  an idle session's clock and cache expiry keep updating between events. Run
  `/dotclaude:apply-settings-profile` (or `apply-statusline.mjs --apply`)
  again to add it to an existing install.

- The main status line uses two rows: where the session works, then what it
  uses. A row that is too wide continues on the next row, so parts are not
  cut off. Past three rows, parts drop by priority, and a limit at 75% or
  more stays.
- The main status line shows more of the session: the folder below the
  project, added directories, the worktree, the `--agent` name, the vim
  mode, the session name, prompt cache misses with the last cause, the spend
  limit, lines added and removed, and the session time.

## [0.10.0] - 2026-09-28

### Added

- A stale-cache notice. When you send a prompt after the main conversation's
  prompt cache expired, and the context is 100k tokens or more, a message
  tells you that this turn reads the whole context uncached, and that a
  `/compact` now does the same. It suggests a handoff note and `/clear` for
  new work. The TTL is 1 hour, or 5 minutes with
  `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` or `FORCE_PROMPT_CACHING_5M=1`. The
  message goes to you only and adds nothing to the context. The `usage_notes`
  option controls it.
- The Bash guard denies a `git commit` whose message has a Claude
  `Co-Authored-By` line when the `attribution` setting (or
  `includeCoAuthoredBy: false`) leaves that line out. Claude Code adds it
  anyway in some sessions
  ([#4287](https://github.com/anthropics/claude-code/issues/4287),
  [#93007](https://github.com/anthropics/claude-code/issues/93007)).
- A status line. The main line shows the folder, the git state, the model
  and effort, the context against the 200k handoff point, the prompt cache's
  expiry and hit ratio, the usage limits, and the pull request. Colors change
  at 75% and 90%, and parts drop by priority on a narrow terminal. The plugin
  sets `subagentStatusLine`: each subagent row shows its context against the
  150k subagent budget. Claude Code leaves `${CLAUDE_PLUGIN_ROOT}` empty in
  that command, so it runs a stub in the config directory that session start
  writes. A plugin cannot set `statusLine`, so
  `/dotclaude:apply-settings-profile` offers it through
  `apply-statusline.mjs`, which writes a stub that session start keeps
  pointing at the current plugin version.
- A nested-instructions hook. When a Bash command reads files in a
  subdirectory with its own `CLAUDE.md`, `.claude/CLAUDE.md`, or
  `CLAUDE.local.md`, the hook adds that file to the context once per session
  or subagent. Claude Code loads these files only for the Read tool
  ([#90450](https://github.com/anthropics/claude-code/issues/90450)). The
  `nested_instructions` option controls it.
- The usage report shows the prompt cache hit rate and the advisor's share of
  cost.
- An open-task check. When Claude ends a turn with tasks still pending or in
  progress, a Stop hook sends it back once to update the task list. The same
  set of open tasks blocks only once, so tasks left open for you do not block
  again. The `task_check` option controls it.
- `just sandbox` runs Claude Code with the checkout as its plugin in a
  separate config directory. It skips onboarding and the trust dialog, and
  it gives your login token to `claude` in its environment only.
  `docs/sandbox.md` tells people and AI agents how to test in it.
  `just sandbox-clean` removes it. `just usage` runs the usage report.

### Changed

- Every message that goes to Claude follows strict ASD-STE100 and Claude's
  prompting best practices: hook output, guard reasons, agent and skill
  prompts, and the system prompt. Each message gives the reason, says what
  to do, and puts code items in backticks. A guard that finds more than one
  problem now writes each reason as its own sentence. `AGENTS.md` has the
  rule for new messages. Agent rules that had no reason now give one.
- Tests check what dotclaude does, not how its messages read: the decision,
  the file effects, and the facts a message carries (paths, IDs, numbers).
  A reworded message no longer breaks a test.
- The dossier uses the official prompt-caching facts: an effort change keeps
  the cache on Opus 5.5 and Fable 5.1, `/model` loses it, and a 1-hour cache
  write costs 2x the input price.
- Subagents are told that Claude Code refuses their writes to `.md` files
  whose names start with `report`, `summary`, `findings`, or `analysis`
  ([#44657](https://github.com/anthropics/claude-code/issues/44657)).
- The usage-note levels (75% and 90%) move to `hooks/lib/_budget.mjs` as
  `USAGE_LEVELS`, shared with the status line.

### Removed

- Headroom support. Headroom compresses tool output with loss, and in this
  repository it dropped words from text that Claude read as exact. Its saving
  is small against a cached context, and all agents needed its retrieve tool.
  The agents, `/dotclaude:setup-integrations`, and the session-start notice no
  longer name it. To remove it from your setup, run `headroom unwrap claude`
  and `claude mcp remove headroom`, and take `headroom wrap` out of your
  `claude` shell function.

### Fixed

- The usage report left out advisor calls, because the call's own `usage`
  does not count them. It now adds each `advisor_message` in
  `usage.iterations`.

## [0.9.0] - 2026-09-28

### Added

- Secret redaction. A new PostToolUse hook runs
  [gitleaks](https://github.com/gitleaks/gitleaks) on the output of every tool
  and replaces each secret that it finds with `[REDACTED:<rule>]` before
  Claude sees it. The rest of the output and its shape stay the same, and
  Claude gets a note that names the rules. A `tail ~/.zshrc` had put an API
  key into the context. gitleaks runs from the temp directory with
  `--ignore-gitleaks-allow`, so a repository's `.gitleaks.toml` or a
  `gitleaks:allow` comment cannot turn redaction off. A run takes about
  30 ms. The `secret_redaction` option (on by default) controls it. Without
  gitleaks on `PATH`, output passes through and session start says so.
- `/dotclaude:setup-integrations` reports the gitleaks version and tells how
  to install it.

### Changed

- The `general-purpose` refusal now gives a route for plans: draft the plan
  in plan mode and have `dotclaude:plan-reviewer` review it. A session had
  sent plan drafting to `dotclaude:implementer`, which ran out of context.
  The implementer description says that it does not draft plans.
- One Headroom proxy recipe everywhere:
  `DOTCLAUDE_LAUNCHER=1 headroom wrap claude --no-mcp --code-memory none --
  --system-prompt-file ~/.claude/dotclaude/system-prompt.md`. It starts the
  proxy, keeps the dotclaude system prompt, and stops the proxy when the
  session ends. The README and the session-start notice told you to start
  `headroom proxy` by hand, which nothing stopped, while the setup skill said
  `headroom wrap claude`. `headroom unwrap claude --keep-mcp` stops a proxy
  that stays after a crash.
- A code comment said that a hook's "ask" lets the user approve any write to
  Claude settings in auto mode. That is true for Bash commands only. For Edit
  or Write on a settings file, Claude Code keeps its classifier in the
  pipeline, and a classifier deny stands. No hook can turn that deny into a
  prompt. To make such an edit in auto mode, state the change in your message
  and retry, approve it in `/permissions` under recently denied, or make the
  edit yourself.

## Older Releases

| Series | Releases |
| --- | --- |
| [0.8](docs/changelog/0.8.md) | 0.8.2, 0.8.1, 0.8.0 |
| [0.7](docs/changelog/0.7.md) | 0.7.0 |
| [0.6](docs/changelog/0.6.md) | 0.6.2, 0.6.1, 0.6.0 |
| [0.5](docs/changelog/0.5.md) | 0.5.1, 0.5.0 |
| [0.4](docs/changelog/0.4.md) | 0.4.0 |
| [0.3](docs/changelog/0.3.md) | 0.3.0 |
| [0.1 and 0.2](docs/changelog/0.1-0.2.md) | 0.2.0, 0.1.0 |

[unreleased]:
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.11.1...HEAD
