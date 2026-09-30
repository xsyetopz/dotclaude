# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

### Added

- The `exclude_session_files` hook (on by default) adds files that describe
  one session or one user to `.git/info/exclude` when an agent creates them:
  the handoff note, `.dotclaude/`, `CLAUDE.local.md`,
  `.claude/settings.local.json`, and `.claude/worktrees/`. Before, the
  handoff skill only told the user to add the note to `.gitignore`. Files
  that their tools say to commit, such as `openspec/`, stay tracked.
- `/dotclaude:setup-integrations openspec` installs the OpenSpec CLI and runs
  `openspec init --tools claude` in the project that you name. The status
  script reports the CLI, `openspec/config.yaml`, and the `openspec-*` skills.
- The `handoff_pointer` hook (on by default) tells a new session, at startup
  and after `/clear`, where the newest open handoff note is. Claude reads the
  note only when you ask to continue, and checks it against `git status` and
  `git log` first.
- A handoff note starts with front matter: `status` (`in-progress`,
  `blocked`, `done`, or `superseded`), `branch`, `head`, and `written`. The
  **Goal** section ends with a **Done when** line, **State** marks partial
  work, and **Open** lists the questions for you and the promises made to
  you. These follow the common handoff templates: a status field that tools
  can read, a definition of done, and a flag on unfinished work.

### Changed

- Breaking: `write-session-handoff` writes a new note to
  `.claude/handoffs/<YYYY-MM-DD-HHMM>-<topic>.md` (UTC time), not to
  `.claude/handoff.md`, and keeps the earlier notes. A newer note for the same
  work sets the earlier one to `superseded`. dotclaude does not read
  `.claude/handoff.md` anymore. To continue from an old note, move it into
  `.claude/handoffs/`, or give its path to Claude.
- Skills that take `$ARGUMENTS` put their `<task>` last, after the reference
  sections, as Anthropic's prompt guidance orders data before the query.
- The `integration-setup` agent gets the reason for each of its limits, and
  it does not state a training cutoff that a model override makes wrong.
- The output style lists apology with the other replies that tell the user
  nothing.
- A subagent gets one note when its context comes within 15k tokens of its
  budget: finish the current item, delete the scratch files, and report. Past
  the budget, it can still delete its own files in the temp folder. Before,
  audit agents stopped in the middle of an item and left their scratch files.
- The stop checks send Claude back with `additionalContext`, so Claude Code
  shows them as "Stop hook feedback", not as "Stop hook error".

### Fixed

- A permission prompt no longer starts with `[dotclaude]`. Claude Code already
  labels the prompt as a hook's. Messages to Claude keep the tag.
- The stop and compaction messages quote only the check command, not the whole
  Bash command around it. Before, a check inside a heredoc script showed the
  script, cut at 200 characters in the middle of a code span.
- The compaction summary no longer counts as a user prompt. Before, the
  destructive-command and risky-edit guards could read the summary as the
  user's last message, and the prompts kept after compaction included it.
- A check now counts when it runs through `xcrun` (`xcrun swift test`,
  `xcrun xcodebuild ... test`), with several recipes
  (`just skills skill-lint markdown`), with flags before the recipe
  (`make -C app test`), or as `just validate`.
- An allow reason no longer starts with `[dotclaude]`, because only the user
  sees it. The foreground rewrite of an `Agent` call shows no reason, because
  it showed on every spawn.
- A `/dotclaude:` skill named in the middle of a message runs at the step
  where the message puts it. Before, the hook said to run it now, also for
  "commit this, then `/dotclaude:write-session-handoff`".
- The Bash guard no longer asks for these commands:
  - A heredoc script that names `settings.json` only as data, or that has
    `fs.rmSync` inside a JavaScript template string.
  - `find -name __pycache__ -prune -exec rm -r {} +`.
  - `rm -r` of a temp folder through a variable: a `for` loop word, an
    `mktemp -d` template in the temp folder, or `$TMPDIR/<name>`.
  - A command with `IFS= read`. Before, this stopped all variable expansion.

  A write to a settings file in a heredoc, or `rm -rf` of a loop word
  outside the temp folder, still asks.
- The context note and the system prompt give the compaction point as about
  117k tokens, not "before 150k".

## [0.15.1] - 2026-09-30

### Changed

- The context note asks for the handoff before the current step ends, not
  after it. The note comes at 100k tokens and compaction at about 117k, and
  one step can use more than the 17k between them. In one 0.15.0 session, a
  fifth compaction came right after the handoff. The note now gives the
  compaction point and says that it does not stop the work. In two 0.15.0
  sessions, Claude put off new requests from the user after the note, and in
  two it said that the context limit was reached. The Claude prompting best
  practices also tell Claude not to stop tasks early because of the token
  budget.
- Only the first context note after a crossing of 100k tokens asks for the
  handoff. A later prompt before the next compaction gets a short note with the
  size, and Claude updates the handoff only when the state changed. Before,
  each prompt asked for the handoff again, and in one 0.15.0 session Claude
  updated the handoff instead of starting a new request.
- The `write-session-handoff` skill records which decision replaced an
  earlier one, and each request from the user that is not started.

### Fixed

- A check command longer than 200 characters now ends with `…` in the Stop
  message. Before, the message cut it with no mark, for example `…; py`.

## [0.15.0] - 2026-09-30

### Changed

- The context note waits for four compactions of the main conversation.
  Before 0.15.0, it asked for a handoff at the first crossing of 100k tokens,
  so every long session stopped there. A compaction and a handoff both start
  the next part from about 20k tokens, so they cost about the same per turn.
  In the local transcripts, compactions 1 to 4 kept 49% to 57% of the facts
  that Claude used next, and compactions 5 to 8 kept 42%. The note now gives
  the compaction count. `COMPACTIONS_BEFORE_HANDOFF` in
  `hooks/lib/_budget.mjs` sets the count.
- The status line measures the main context against 117k, where Claude Code
  compacts with the 150k `autoCompactWindow`, not against 150k, which the
  context never reached. `⇊2/4` gives the compactions so far, and `handoff`
  shows when the context note asks for one. To count compactions, each
  refresh reads only the transcript lines added since the last refresh.
- `scripts/compaction-report.mjs` measures the cost and the kept facts of each
  compaction from the local transcripts.
- The session note and the system prompt no longer tell Claude to hand off
  near 150k tokens. With `autoCompactWindow` at 150k, Claude Code compacts at
  about 117k, so that point never came, and Claude started handoffs on its own
  estimate. Claude now waits for the context note.

### Documentation

- The hook docs and the README name `claude plugin configure
  dotclaude@dotclaude` (Claude Code 2.1.285) to list the plugin options.
- The design dossier notes that Claude Code 2.1.285 removed the second reply
  after a background report, and why forks stay off.

## [0.14.1] - 2026-09-30

### Changed

- The model lock now denies a subagent or a `claude` command that would run
  at an effort level that dotclaude does not support for its model. Opus 5.5
  supports `low` to `xhigh`. Sonnet 5.5 supports only `low` and `medium`,
  because work that needs `high` needs judgment, and Opus 5.5 gives more for
  the same cost there. The deny reason names where the effort came from and
  what to do. `EFFORT_LEVELS` in `hooks/lib/_models.mjs` holds the table.

### Documentation

- `docs/models.md` lists the supported effort levels for each model and the
  limits of the check. Model Fit adds the ProjectArchitect Bench A/B as
  reported evidence, with its limits.

## [0.14.0] - 2026-09-30

### Added

- A contribution guard in the Bash guard. It covers `git commit`,
  `git push`, and `gh pr`, `gh issue`, and `gh discussion` writes. It also
  covers `gh api` writes and GraphQL mutations that post content. The guard
  denies a contribution to a project that forbids AI work, per a catalog
  made from melissawm's `open-source-ai-contribution-policies` (183
  projects, 101 forbid). It asks before a push or write to a GitHub
  repository whose owner is not your `gh` login. The prompt shows the
  project's catalog entry, or says that its policy is possibly unwritten. A
  local `git commit` in another owner's clone passes. See
  [Contributions](docs/contributions.md).
- `scripts/update-ai-policies.mjs` updates the catalog into the plugin data
  directory. At session start, a detached process checks the upstream
  README hash at most once a day. The guard reads only the stored hash, and
  tells you to update when it differs from the catalog.
  `DOTCLAUDE_OFFLINE=1` turns the check off.
- The `contribute-upstream` skill. It reads the project's AI policy, stops
  when the project forbids AI work, and treats a missing policy as unknown.
  It verifies the claim before a draft and writes the draft in plain English
  for you to send. Claude does not reply in the thread after that unless you
  ask.
- The settings profile adds `permissions.ask` rules for `gh pr create`,
  `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment`,
  `gh discussion create`, and `gh discussion comment`.

- A context note. When the main context is 100k tokens or more, each prompt
  that you type tells Claude the context size and to start a handoff with
  `write-session-handoff`. No hook input gives Claude its context size. With
  the settings profile, Claude Code compacts at about 117k tokens (median
  121k in 145 measured compactions), before the 150k handoff point. The note
  at 100k gives Claude time to write a handoff first. In a long run with no
  typed prompt, the first tool call past 100k gives the note once, and again
  after the context goes under 100k and back over it. The size comes from the
  end of the transcript, and the note uses the `usage_notes` option.

### Changed

- System prompt, approvals: approval also covers actions that spend money or
  speak for you. A request says what the action does, why, what it changes,
  and how to undo it. Open questions go in one `AskUserQuestion` call.
  Claude does not ask in text for an approval that a permission prompt
  gives, because many small approvals teach you to approve without reading.
- System prompt, gaps: Claude does not call an unsupported case "intended"
  or a "correct skip" only because the code does not handle it. It checks
  public implementations and docs, and reports a gap unless the project or
  you exclude the case. In one session an agent had called four controllers
  "correct skips" although public drivers for them exist.
- `apply-settings-profile` runs all previews and asks one question for the
  profile groups, the switches, and the extras. The permission prompt of
  each `--apply` is the approval of the write, with no second question in
  text.
- The usage notes give the reset time of the session and weekly limits. At
  90%, Claude writes a handoff when the remaining work does not fit before
  the limit, and tells you the reset time.
- Faster hooks on Bun. The Edit guard reads the transcript only when an edit
  removes assertions (a long session: 35 to 17 ms per edit). The Bash and
  Edit guards find your latest prompt from the end of the transcript and stop
  there (a long session: 40 to 26 ms when an edit removes assertions). The
  contribution catalog and the settings stamp hash with `Bun.CryptoHasher`,
  not `node:crypto` (a Bash check: about 3 ms less). The status line
  measures width with `Bun.stripANSI`, not `node:util` (about 2 ms less). The
  secret scan starts Betterleaks with `Bun.spawn`, not `node:child_process`,
  which uses about 15% less CPU after a `Bash` call.
  The contribution guard reads your `gh` login from `hosts.yml`, and starts
  `gh` only when it cannot read the file (a push to another owner's
  repository: 91 to 37 ms).
- The dossier corrects the Sonnet 5.5 and Opus 5.5 cost comparison from the
  Artificial Analysis suite. `diff-reviewer` stays on Sonnet 5.5, so a
  `risk: high` slice still gets two different models as reviewers.

### Fixed

- The search guard denied `rg -uu`, `fd -I`, and `git grep --no-index` into
  large gitignored notes or docs. It now denies an explicit bypass only when
  it walks a build or dependency directory, such as `node_modules` or
  `dist`.
- `rm -rf "$TMPDIR/name"` asked for approval. A named child of `$TMPDIR`
  now passes. `$TMPDIR` itself, a glob, and `..` still ask.
- Inline code such as `python3 -c "s.replace('os.unlink(', …)"` gave a
  destructive-code warning for text inside a string literal. The check now
  ignores string literals.
- The stop gate counted an edit of `.gitignore`, `.git/`, `.claude/`, or a
  gitignored file as a code edit and asked for a check run. It now counts
  only files that git does not ignore, in both the `Edit` and `Bash` paths.

## [0.13.1] - 2026-09-29

### Fixed

- The `apply-settings-profile` skill lists the `Agent(general-purpose)` deny
  in its group table, so the user sees the reason before applying. The
  Models row no longer names `general-purpose` as an agent on Sonnet 5.5.

## [0.13.0] - 2026-09-29

### Changed

- `integration-setup` gets the reason to trust `--help` over memory: Haiku
  4.5 has reliable knowledge only to Feb 2025, and the tools it sets up are
  newer. A new test fails when an agent on Haiku 4.5 sets `effort`, because
  Haiku 4.5 does not support it and `claude plugin validate` accepts it.
- Shorter skill descriptions. Claude Code lists them in every main turn.
  Each skill's description is now 150 to 230 characters, from 190 to 540.
  `drive-web-browser` has no `when_to_use` now, because its description
  holds the trigger. A new limit in `LIMITS` fails the tests above 250
  characters.
- One hook process per event. `hooks/dispatch.mjs` runs all actions of an
  event in one `bun` process, at the same time, and merges their output. A
  `Bash` call starts 2 hook processes instead of 7, and uses about half the
  CPU time (164 ms to 86 ms, measured). An error in one action does not stop
  the others.
- The Bash guard denies a walk into a gitignored directory only when that
  directory has 200 entries or more. Small caches such as `__pycache__` or
  `xcuserdata` no longer cause a deny. In the 6 days to 2026-09-29, this
  rule denied 85 commands, and the usual false deny was
  `grep -rn X Sources Tests` over a small cache.
- Secret redaction uses
  [Betterleaks](https://github.com/betterleaks/betterleaks) instead of
  gitleaks. It takes the same rules and the same `GITLEAKS_CONFIG`, and also
  reads `BETTERLEAKS_CONFIG`. Live validation stays off. **Upgrade:** run
  `brew install betterleaks`. Until you do, tool output is not redacted, and
  session start says so. gitleaks is not used by dotclaude any more. Keep it
  for pre-commit hooks.
- The stop gate no longer blocks a pass claim when nothing was edited and
  nothing ran. It blocked read-only research agents that reported results
  that others ran. After a failed check, a claim in backticks, a code block,
  or a `>` line does not count as a pass claim.
- The open-task check and the announced-work check let a turn through when
  it ends with `ExitPlanMode`. The open-task check also lets a turn through
  when it ends with `AskUserQuestion`, and it does not apply to subagents.
- The task-completion gate no longer writes `task` lines to
  `verdicts.jsonl`. The 0.12.0 input check is closed.
- The settings profile denies `Agent(general-purpose)`. The deny removes the
  agent from the list that Claude sees (checked with `claude -p`). In one
  week, Claude asked for it 244 times, and the plugin's hook refused each
  call. The hook stays for sessions without the profile. Run
  `/dotclaude:apply-settings-profile` again to add the deny.
- The usage report counts the wake turns of each entrypoint. In the week to
  2026-09-29, 527 of 532 wake turns were in `cli` sessions: 280 were
  messages from other sessions, and 125 of the 128 agent wakes were before
  0.7.0 kept agents in the foreground.
- Browser automation and CAPTCHA OCR moved to the optional
  `dotclaude-browser` plugin in the same marketplace. Sessions without it do
  not load the two skills or their session note. The plugin's session note
  also replaces the browser line in the settings profile's `CLAUDE.md`
  block. **Upgrade:** run `/plugin install dotclaude-browser@dotclaude`, then
  set `cloakbrowser`, `cloakbrowser_humanize`, `cloakbrowser_headless`, and
  `captcha_ocr_ddddocr` again in `/config` under dotclaude-browser. The old
  values under dotclaude have no effect. `/dotclaude:setup-integrations`
  shows whether the plugin, agent-browser, CloakBrowser, and ddddocr are
  installed.

- The context and usage notes ask for a handoff note with the
  `write-session-handoff` skill and then `/clear`, not `/compact`. A handoff
  keeps the facts that Claude chooses, and `/compact` costs a full turn over
  the large context. The settings profile's system prompt says the same.
- The output style has a ceiling of 900 tokens (warn at 700), not 2000. It
  measures 515 tokens.

### Fixed

- The task-completion gate named no task, because it read `task_name` and
  `task_status`, which Claude Code does not send. It now reads `task_id` and
  `task_subject`, and the reason names the task.

- The README, the settings profile doc, and the design doc said that 3
  subagents run at the same time. The limit is 5, as `_budget.mjs` sets.

### Added

- The `run-agent-loop` skill runs a large change as slices, the workflow of
  the Bun, GitHub Copilot, and pnpm v12 Rust ports. The main conversation
  writes `.dotclaude/loop/GUIDE.md` and `slices.jsonl`. Each slice goes to an
  `implementer` in a worktree, then to `diff-reviewer`, then to a fixer, and
  then to the frozen tests. A wave runs at most 5 slices at the same time.
- The `diff-reviewer` agent (Sonnet 5.5, medium effort, read-only) reviews
  one slice from its diff and `GUIDE.md` only, not from the implementer's
  report.
- While `.dotclaude/loop/loop.json` lists `protected` globs, the edit and
  Bash guards deny a subagent's change to a matching file and its removal.
  The main conversation is not limited.
- The Stop hook sends Claude back once when a loop slice has the status
  `implemented` and no review.
- The status line shows the loop progress, for example `loop 2/7`.

- The Bash guard denies a file follow (`tail -f`, `tail -F`,
  `inotifywait -m`) also in the background, unless `timeout` bounds it. A
  background follow ran until the session ended, also after its file was
  deleted. The reason names an `until grep -q` loop and `Monitor`.
- The Bash guard denies a background command that reads stdin to its end
  before it starts work, when the command has no stdin of its own:
  `codex exec`, `cat` and `python`, `python3`, or `node` with no file, `tr`,
  and a shell with no script. A background call usually gets `/dev/null` as
  stdin, but in one session it got a pipe that did not close, and two
  `codex exec … &` runs waited on it for 81 minutes. A `</dev/null` or `0<`
  redirect, a heredoc, a pipe, or `exec </dev/null` lets the command
  through.
- The agent and skill prompts use one set of XML tags in one order:
  `<task>` (skills) or a role paragraph (agents), `<context>`, `<inputs>`,
  `<constraints>`, `<procedure>`, topic sections, `<report_format>`
  (agents) or `<output_format>` (skills), then `<example>`. Anthropic's
  prompting guide asks for consistent, descriptive tag names. It gives no
  fixed set.

### Removed

- Three usage notes that did not fire in the transcripts from 2026-09-25 to
  2026-09-29: the third-correction and refusal notes (`note-rewind`, 0 fires),
  the repeated-command note (`note-repeated-status`, 0 fires), and the
  expired-cache notice (`note-stale-cache`, 1 fire). The status line shows
  the cache expiry, and the follow guard and `Monitor` cover polling.

## [0.12.1] - 2026-09-29

### Fixed

- The status line puts a space after the branch (`⎇`), worktree (`⊞`), and
  cache (`◷`, `◌`) glyphs, so the glyph and the branch name or time after
  it do not run together.

## [0.12.0] - 2026-09-29

After updating, restart Claude Code and run
`/dotclaude:apply-settings-profile` again. The profile now allows 5 agents at
once and adds compact instructions to the global `CLAUDE.md` section. It
keeps the values that you set, but an agent cap of `3` becomes `5`, because
0.11.1 wrote that value.

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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.15.1...HEAD
