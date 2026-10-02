# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, any
release may change or remove behavior; see the README's "Update" section for the
steps after each update.

## [Unreleased]

### Changed

- The status line shows the reset time of each usage limit at all levels,
  not only from 75%. Reset and pace times use the format of Claude Code's
  `/usage`: `3pm`, `3:30pm`, or `Oct 4 at 12pm`. Before the first API
  response of a session, the 5-hour and weekly limits come from the
  `/usage` copy that Claude Code keeps in `~/.claude.json`, when it is less
  than one hour old.
- The cache miss glyph is `✘`, Claude Code's own cross, not `✗`.

## [0.17.1] - 2026-10-02

### Breaking

- dotclaude now needs Claude Code 2.1.287 or later. One version,
  `CLAUDE_CODE` in `hooks/lib/_version.mjs`, replaces the separate minimum
  and tested versions. The session start notice names it for an older CLI, and
  the "tested on" notice for a newer CLI is removed. `/dotclaude:setup` with
  auto-update on sets `minimumVersion` to 2.1.287 or to the running version,
  whichever is later. `install-managed.mjs` sets `requiredMinimumVersion` to
  2.1.287.

### Removed

- The `UserPromptSubmit` hook `expand-inline-skill.mjs`. Claude Code 2.1.287
  tells Claude about each skill named in a message, and it lets the `Skill`
  tool run a user-only skill that the user typed.

### Added

- A resumed or forked session with 100k tokens of context or more and an
  expired prompt cache tells the user the context size and the estimated cost
  of the first prompt, and suggests `/clear` with a handoff note. It uses the
  new SessionStart fields of Claude Code 2.1.287.
- Three role cases in `evals/`, with the tag `tier-5`: `t5-review` (a commit
  with three planted defects and a correct loop that looks wrong),
  `t5-debug` (a test that fails only after another test, from shared state
  in a third module), and `t5-slice` (a specified feature across four files).
  Each has a hidden test oracle.
- `evals/report.mjs` names the graders that failed in each case, with counts.
- Held-out group `d` in `evals-heldout/d/`: 10 harder cases, written blind
  like groups `a` to `c`. Each is a git repository with 18 to 37 files and
  several traps that interact, with up to 80 turns. Groups `a` to `c` were at
  their ceiling (27 of 30 cases passed every trial in both arms). No agent has
  run group `d` yet.
- Held-out group `e` in `evals-heldout/e/`: 10 more hard cases, written blind
  from dossier parts 04 and 05 and other parts that no earlier case cites.
  Each is a git repository with 20 to 38 files, and six hold uncommitted user
  work that must survive. No agent has run group `e` yet.

### Changed

- The dossier has a new part, [Claude Mods](docs/dossier/mods.md). It records
  the plugin hooks modules of Claude Code 2.1.287 and the plan for a dotclaude
  mod in 0.18.
- `t1-false-alarm` has two judges. One checks that the reply says the bug
  did not reproduce and that nothing changed. The other checks that the reply
  shows the command with its output. A correct reply without the command now
  fails only the second.
- The output style tells Claude to show the MRE itself (the command, test,
  or code) and its output in the reply. Before, it said "Report it with its
  output", and replies gave the results without the command that made them.
  In 3 `t1-false-alarm` runs on Sonnet 5.5, 0 replies showed the command
  before the change, and 3 did after it.
- The `t1-fix` grader `reproduced-first` accepts `Write` as well as `Edit`
  after the first test run. It is now a `regex` grader on the trace, because
  `tool_order` takes only one tool.
- `reviewer` and `debugger` use Sonnet 5.5 at `high`, not Opus 5.5. In the
  0.17.1 evals, Sonnet 5.5 at `high` passed `t5-review` in 20 of 20 trials
  and the debug cases in 40 of 40, at 52% to 56% of the Opus 5.5 cost per
  pass. The cases are at the ceiling for both models, so harder reviews are
  not tested.
- The output style tells Claude to state a gap or a follow-up as a fact,
  with no offer such as "If you want it, say so". In the 0.17.1 re-run, 3 of
  20 Sonnet 5.5 replies to `t1-fix` ended with such an offer.
- CI runs the tests on Windows too. A `.gitattributes` file keeps LF line
  endings on Windows checkouts.

### Fixed

- The Bash guard asked before `find /tmp -maxdepth 1 -name 'ojd-*' -exec rm
  -rf {} +` when the project was in `/tmp`, which is the usual case on Linux.
  A name-filtered delete with `-maxdepth 1` in a temp folder that holds the
  project now runs when no name matches the project's entry in that folder.
  The Linux CI job failed on this.
- `node --test` did not count as a check. After an edit and a `node --test`
  run, the Stop hook still told Claude that no check ran after the last edit.
  In the 0.17.1 evals, 64 of 200 replies to code tasks mentioned the note.
  A `node` command with only flags before `--test` now counts.
- In `claude -p`, the Agent SDK, and subagents, the caller gets only the last
  message. When a Stop hook sent Claude back after a full report, the short
  second reply replaced the report. The Stop and SubagentStop notes now tell
  Claude to make its last message the full report there.
- All tracked Markdown passes markdownlint. `evals-heldout/` and the
  `dotclaude-browser` skills get the prompt-file rules of `skills/`. The
  `c-already-fixed` prompt puts the email address in backticks, so it is
  not a bare URL. In `contribute`, step 1 of the procedure was inside the
  `<procedure>` HTML block and did not render as a list item.
- Windows fixes. The Windows CI job had 75 failures, then 5.
  - The `setup` scripts `apply-settings.mjs` and `apply-claude-md.mjs` did not
    find their profiles on Windows. They read their folder from the URL path
    (`/D:/...`). They now use `import.meta.dirname`.
  - On Windows, the Bash guard did not see temp paths. It now reads command
    paths as Git Bash does: `/tmp` is the folder that `TEMP` names, and `/c/`
    is the drive `C:`. It also compares temp folders with `/` separators and
    knows the Windows temp folder. The agent budget's temp delete check uses
    the same rules.
  - The ledger, the nested instruction note, the status line, the instruction
    size note, and the search guard now give paths below the project with `/`.
    With `\`, the checks for dot folders and `.claude/` failed on Windows.
  - `exclude-session-files` now asks git for the path below the top level. A
    short name such as `RUNNER~1` made the path comparison fail on Windows.
  - The Bash guard asked before a `git` discard in a clean folder that `-C` or
    `cd` gave with a `~` inside the name, such as the Windows short name
    `RUNNER~1`. Only a `~` at the start of the name now makes the folder
    unknown, because Bash expands `~` only there.
  - Tests write paths in commands with `/`, set `USERPROFILE` beside `HOME`,
    and expect native paths. Tests that run a `#!/bin/sh` stub or a mode 000
    folder run only on POSIX systems.

## [0.17.0] - 2026-10-01

### Breaking

- dotclaude no longer installs a `claude` shell function to replace Claude
  Code's system prompt. `apply-launcher.mjs` is removed. To migrate from
  0.16.x, run `/dotclaude:setup`. It removes the 0.16 function from your shell
  startup files and deletes `~/.claude/dotclaude/system-prompt.md`.
- `/dotclaude:apply-settings-profile` and `/dotclaude:setup-integrations` are
  now one skill, `/dotclaude:setup`. Run `/dotclaude:setup integrations` for
  the integrations.
- Four skills have shorter names, with no alias for the old names:
  `write-session-handoff` is now `/dotclaude:handoff`, `run-agent-loop` is
  `/dotclaude:slices`, `contribute-upstream` is `/dotclaude:contribute`, and
  `explain-dotclaude` is `/dotclaude:explain`.
- Most plugin options have new names in one `<group>_<feature>` scheme, so
  `/config` lists each group together: `guard_`, `gate_`, `context_`,
  `usage_`, `model_`, `git_`, and `agent_guidance`. For example, `bash_guard`
  is now `guard_bash`, `stop_gate` is `gate_verify`, and `claude_plan` is
  `model_plan`. The old names have no alias. `/dotclaude:setup` moves each
  value that is set to its new name.
- The `integration-setup` agent is removed. The `setup` skill runs the
  integration scripts itself.
- The `auto-updates` switch in the optional profile is removed. Use
  `apply-settings.mjs --auto-update on|off`.
- The settings profile no longer removes keys that the 0.8 and 0.11 profiles
  wrote.
- The output style `dotclaude` now holds all working rules, at about 2.3k
  tokens. Before, a 4.3k-token replacement system prompt held them.
  `skills/setup/profiles/system-prompt.md` is removed. The style sets
  `keep-coding-instructions: true`. With the lean prompt the flag has no
  effect. It keeps Claude Code's coding instructions only for a user who turns
  the full prompt back on.
- The SessionStart plan note no longer holds the handoff rule. The output
  style holds it.
- dotclaude now has 8 agents, down from 19. Brief the new agent with a lens:
  - `reviewer` replaces `code-reviewer`, `security-reviewer`,
    `plan-reviewer`, and `diff-reviewer`. Its lenses are `code`, `security`,
    `plan`, and `diff`. It runs on Opus 5.5 at `high` effort, also for the
    `diff` lens of an agent-loop slice.
  - `investigator` replaces `ci-investigator`, `history-investigator`, and
    `dependency-auditor`. Its lenses are `ci`, `history`, and
    `dependencies`.
  - `debugger` replaces `performance-engineer`.
  - `implementer` replaces `test-writer` and `docs-writer`.
- `LIMITS` no longer has `skillLines`, `skillBodyTokens`, or
  `skillDescriptionChars`, and the tests no longer check skill size. Use the
  `create-agent-skills` checks for a skill.
- `evals/` has 8 new cases in 4 tiers, tagged `tier-1` to `tier-4`, from a
  one-file fix to delegation, `slices`, and a handoff. The 15 earlier cases
  are removed, so earlier `evals/` results do not compare with new ones.

### Added

- `docs/attributions.md` names the projects whose ideas dotclaude
  reimplements: DensePack and agent-skills.
- `/dotclaude:setup` turns Claude Code auto-update on with the `stable`
  channel and a `minimumVersion` that stops a downgrade, or off with
  `DISABLE_AUTOUPDATER`.
- `migrate.mjs` in the `setup` skill previews and removes the 0.16 leftovers
  outside the settings file, and renames the old dotclaude option keys in the
  user settings, with a backup of each changed file.
- `model_plan` is a picker in `/config`.
- A test fails when two skill or agent descriptions are near-duplicates by
  TF-IDF cosine similarity. The method comes from addyosmani/agent-skills
  (MIT).
- When a session runs a Claude Code version newer than the one dotclaude was
  tested on, the first session on that version shows a note.
- After each compaction, a SessionStart note restates the report rule of the
  output style, because a custom output style cannot set a turn reminder
  (#88189).
- `LIMITS.sessionNoteChars` (1000 characters) bounds the subagent conventions
  and the plan note.
- When an `Edit` fails because `old_string` matches no text, a
  PostToolUseFailure hook gives Claude the closest lines of the file with
  their line numbers. The idea comes from the DensePack `edit_gate.py` hook
  (MIT). dotclaude copies no code from it.
- `evals/oracle.mjs` runs each case's hidden `oracle.sh` in a copy of the
  kept workspace after `claude plugin eval --keep-temp`, adds an `oracle`
  grader, and adds each run's input, output, cache-read, and cache-write
  tokens. It also reads a workspace that the CLI sealed. It opens the seal
  only to copy the workspace, and then closes it again.
- `evals/report.mjs` gives the cost per pass for each arm: all spend, failed
  trials included, divided by the trials that passed.
- `/dotclaude:setup managed` and `install-managed.mjs --org` write a managed
  drop-in for an organization. Besides the personal lock, it enables
  `dotclaude@dotclaude`, declares its marketplace, and sets
  `enforceAvailableModels` and `requiredMinimumVersion`. The declared
  marketplace keeps the skill `allowed-tools` under
  `allowManagedPermissionRulesOnly`.
- `docs/organizations.md` tells admins how to roll out dotclaude: managed
  settings, a strict marketplace list, plugin options for every user, budgets,
  and Windows limits.
- On Team and Enterprise seats, the plan note says that the seat uses an
  organization budget, and it names the agents that run Sonnet 5.5.

### Changed

- The working conventions that every subagent gets are 1k characters, down
  from 2.7k.
- The Bash guard no longer asks for a bulk delete in a temp folder or in a
  gitignored path. This includes `rm -r` on `$TMPDIR` and
  `$CLAUDE_CODE_TMPDIR` paths, and `find -delete` or `fd -x rm` in an ignored
  folder. A path that overlaps the project, a folder with tracked files, a
  link-following search, and a reassigned temp variable still ask.
- The Bash guard reads the code of an inline `python`, `node`, `perl`, or
  `ruby` script without its comments and strings. A word such as `rmtree` in a
  comment or a docstring no longer causes a warning. A comment such as
  `# don't` no longer hides a real delete after it.
- `git checkout --`, `git checkout .`, `git restore`, and `git reset --hard`
  ask only when the paths they overwrite have uncommitted changes, or when
  an earlier command in the line can restore changes (`git stash pop`,
  `patch`, `git apply`).
- The Stop gate ignores edits to dotfile config paths, such as `.prettierrc`
  and `.github/workflows/ci.yml`. Its reasons are shorter, because Claude
  Code can send a Stop reason two times (#96909).
- The `Agent` model-lock deny reason is one sentence.
- Each skill and agent description is at most 200 characters, about 150 for
  most. It says what the item does, then when to use it, then what it is not
  for.
- `debugger` also measures and improves speed and memory use. `implementer`
  also writes the tests and docs of its slice.
- In `slices`, a slice with `risk: high` gets a second `reviewer` with
  the `code` lens.
- The model lock allows Sonnet 5.5 at `high` effort. It still denies `xhigh`
  and `max`. Anthropic's launch charts show that Sonnet 5.5 at `high` costs
  about as much as Opus 5.5 one level lower for about the same score.
- The `setup` skill links its integrations reference from `SKILL.md`.
- The compaction hooks do nothing for a subagent. Claude Code can send a
  subagent compaction with no agent fields (#91910), so dotclaude also finds a
  subagent from its transcript path. Before, a subagent compaction could
  replace the main session's saved prompts.

### Removed

- `hooks/lib/_system-prompt.mjs` and the session-start notices about the
  shell function and the system-prompt copy.
- The agents `code-reviewer`, `security-reviewer`, `plan-reviewer`,
  `diff-reviewer`, `ci-investigator`, `history-investigator`,
  `dependency-auditor`, `performance-engineer`, `test-writer`, and
  `docs-writer`. See **Breaking**.

### Fixed

- `git reset --hard <commit>` now asks when the commit has a file that git
  does not track now but that exists on disk, because the reset overwrites it.
- In a project under a temp folder, `rm -r` with an absolute path into the
  project now gets the project checks. Before, the temp-folder shortcut let it
  run. A temp path whose variable can complete the project's name, for example
  `/tmp/pr$x` for the project `/tmp/proj`, also gets them.
- `rm -r` of untracked files in the project that git does not ignore now
  warns, as for tracked files, because git cannot restore them.
- `apply-settings.mjs`, `apply-claude-md.mjs`, and `status.mjs` in the
  `setup` skill now use `CLAUDE_CONFIG_DIR` for the user scope. Before, they
  wrote to and read `~/.claude` also when Claude Code used another folder.
- `just sandbox` gives `claude` a sandbox `HOME`, so `/dotclaude:setup` in the
  sandbox cannot change your shell startup files.
- `just sandbox` removes the session variables of the Claude Code session
  that starts it (`DOTCLAUDE_*`, `CLAUDE_PLUGIN_*`, the session ID, and the
  `env` values of your real settings). Before, they leaked into the sandbox,
  and the sandbox showed a wrong "settings profile is out of date" notice.
- The `setup` skill tells Claude to report the paths that the scripts print,
  because `CLAUDE_CONFIG_DIR` can move them from `~/.claude`. It also tells
  Claude that an empty "keep" answer keeps no built-in switch.
- [Models](docs/models.md) tells how to set the plan for a login through
  `CLAUDE_CODE_OAUTH_TOKEN`, because that login caches no account.
- `scripts/usage-report.mjs` counted each message's first streamed record,
  whose output count is near zero, and dropped the later records. It now counts
  the record with the largest output, once per message. Subagent output was
  undercounted by up to four times. The report also gives the output tokens and
  the messages with no final record, whose count is a lower bound.
- `evals/report.mjs` scored the `with-only` graders in both arms without a
  word when a case's files were gone, as for an old result file. It now
  prints a warning for each such case.
- `/dotclaude:slices` let Claude end its setup with a choice between the loop
  and a direct change, and recommend the direct change. One of three Opus 5.5
  eval runs did this. The skill now asks the user to approve the slice list,
  with at most one sentence of advice. It also writes the loop files with the
  `Write` tool, so that the user can review them and the `t4-slices` order
  grader sees them.
- `evals/report.mjs` printed `NaN%` for the suite of a one-case result, and it
  left out the comparison with the run without the plugin. It now gives the
  pass rate and the difference, and it says that one case gives no interval.
- The eval commands in `docs/development.md` now set `--judge-model sonnet`.
  The default Haiku judge failed a correct `t4-slices` reply 3 times out of 3.
  `evals-heldout/README.md` used Opus 5.5 as both the agent and the judge. Its
  judge is now Sonnet 5.5, because a model prefers its own output.

## Older Releases

| Series | Releases |
| --- | --- |
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
  https://github.com/xsyetopz/dotclaude/compare/dotclaude--v0.17.1...HEAD
