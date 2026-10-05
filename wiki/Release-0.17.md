# Release 0.17

Released 2026-10-01 to 2026-10-02.
dotclaude replaced the launcher with an output style, merged the setup skills, cut the agents from 19 to 8, and added organization rollout and larger evals.
A version in parentheses marks a later patch of this line, and an entry with no version comes from 0.17.0.

> **Note:** 0.17.1 needs Claude Code 2.1.287 or later.

## Breaking

- Launcher: dotclaude no longer installs a `claude` shell function to replace the system prompt.
  `apply-launcher.mjs` is removed.
  To migrate from 0.16.x, run `/dotclaude:setup`.
  It removes the 0.16 function from the shell startup files and removes `~/.claude/dotclaude/system-prompt.md`.
- Setup skill: `/dotclaude:apply-settings-profile` and `/dotclaude:setup-integrations` are now `/dotclaude:setup`.
  Run `/dotclaude:setup integrations` for the integrations.
- Skill names, with no alias for the old names: `write-session-handoff` is `/dotclaude:handoff`, `run-agent-loop` is `/dotclaude:slices`,
  `contribute-upstream` is `/dotclaude:contribute`, and `explain-dotclaude` is `/dotclaude:explain`.
- Option names: most plugin options use one `<group>_<feature>` scheme, so `/config` lists each group together.
  The groups are `guard_`, `gate_`, `context_`, `usage_`, `model_`, `git_`, and `agent_guidance`.
  For example, `bash_guard` is now `guard_bash`, `stop_gate` is `gate_verify`, and `claude_plan` is `model_plan`.
  The old names have no alias, and `/dotclaude:setup` moves each value that is set to its new name.
- Agents (0.17.0, 0.17.1): dotclaude has 8 agents, down from 19, and the user briefs the new agent with a lens.

  | New agent | Replaces | Lenses and notes |
  | --- | --- | --- |
  | `reviewer` | `code-reviewer`, `security-reviewer`, `plan-reviewer`, `diff-reviewer` | `code`, `security`, `plan`, `diff`. Sonnet 5.5 at `high`, also for the `diff` lens of a slice (0.17.1, from Opus 5.5). |
  | `investigator` | `ci-investigator`, `history-investigator`, `dependency-auditor` | `ci`, `history`, `dependencies`. |
  | `debugger` | `performance-engineer` | Also measures and improves speed and memory use. Sonnet 5.5 at `high` (0.17.1). |
  | `implementer` | `test-writer`, `docs-writer` | Also writes the tests and docs of its slice. |

- `integration-setup` agent: removed.
  The `setup` skill runs the integration scripts itself.
- `auto-updates` switch of the optional profile: removed.
  Use `apply-settings.mjs --auto-update on|off`.
- Settings profile: no longer removes keys that the 0.8 and 0.11 profiles wrote.
- Output style `dotclaude`: holds all working rules, at about 2.3k tokens, where a replacement system prompt of 4.3k tokens held them.
  - `skills/setup/profiles/system-prompt.md` is removed.
  - The style sets `keep-coding-instructions: true`.
    With the lean prompt the flag has no effect, and it keeps the coding instructions only for a user who turns the full prompt back on.
  - The SessionStart plan note no longer holds the handoff rule, because the style holds it.
- `LIMITS`: no longer has `skillLines`, `skillBodyTokens`, or `skillDescriptionChars`, and the tests no longer check skill size.
  Use the `create-agent-skills` checks for a skill.
- `evals/`: 8 new cases in 4 tiers, tagged `tier-1` to `tier-4`, from a one-file fix to delegation, `slices`, and a handoff.
  The 15 earlier cases are removed, so earlier results do not compare with new ones.
- Claude Code version (0.17.1): dotclaude needs 2.1.287 or later.
  - One version, `CLAUDE_CODE` in `hooks/lib/_version.mjs`, replaces the separate minimum and tested versions.
  - The session start notice names it for an older CLI.
  - `/dotclaude:setup` with auto-update on sets `minimumVersion` to 2.1.287 or to the running version, whichever is later.
  - `install-managed.mjs` sets `requiredMinimumVersion` to 2.1.287.

## Added

- Auto-update: `/dotclaude:setup` turns it on with the `stable` channel and a `minimumVersion` that stops a downgrade, or off with `DISABLE_AUTOUPDATER`.
- `migrate.mjs` (`setup` skill): previews and removes the 0.16 leftovers outside the settings file.
  It renames the old option keys in the user settings, with a backup of each changed file.
- `model_plan`: a picker in `/config`.
- Organization rollout: `/dotclaude:setup managed` and `install-managed.mjs --org` write a managed drop-in.
  - Besides the personal lock, it enables `dotclaude@dotclaude`, declares its marketplace, and sets `enforceAvailableModels` and `requiredMinimumVersion`.
  - The declared marketplace keeps the skill `allowed-tools` under `allowManagedPermissionRulesOnly`.
- `docs/organizations.md` (removed in 0.20.0): how to roll out dotclaude with managed settings, a strict marketplace list, plugin options for every user, budgets, and Windows limits.
- Plan note: on Team and Enterprise seats, it says that the seat uses an organization budget and names the agents that run Sonnet 5.5.
- Edit-failure hook: when an `Edit` fails because `old_string` matches no text, a PostToolUseFailure hook gives Claude the closest lines of the file with line numbers.
  The idea comes from the DensePack `edit_gate.py` hook (MIT), and dotclaude copies no code from it.
- Report note: after each compaction, a SessionStart note restates the report rule of the output style (#88189).
  A custom output style cannot set a turn reminder.
- `LIMITS.sessionNoteChars` (1000 characters): bounds the subagent conventions and the plan note.
- Stale-cache notice (0.17.1): a resumed or forked session with 100k tokens of context or more and an expired prompt cache tells the user the context size and the estimated cost of the first prompt.
  It suggests `/clear` with a handoff note, and it uses the new SessionStart fields of Claude Code 2.1.287.
- Description test: a test fails when two skill or agent descriptions are near-duplicates by TF-IDF cosine similarity.
  The method comes from addyosmani/agent-skills (MIT).
- [Attributions](Attributions): names the projects whose ideas dotclaude reimplements, DensePack and agent-skills.
- `evals/oracle.mjs` (0.17.0, 0.17.1): runs the hidden `oracle.sh` of each case in a copy of the kept workspace after `claude plugin eval --keep-temp`.
  It adds an `oracle` grader and the input, output, cache-read, and cache-write tokens of each run.
  It also reads a workspace that the CLI sealed, opens the seal only to copy the workspace, and then closes it again.
- `evals/report.mjs` (0.17.1): gives the cost for each pass for each arm, which is all spend (failed trials included) divided by the trials that passed.
  It also names the graders that failed in each case, with counts.
- Role cases, tag `tier-5` (0.17.1), each with a hidden test oracle:
  - `t5-review`: a commit with three planted defects and a right loop that looks wrong.
  - `t5-debug`: a test that fails only after another test, from shared state in a third module.
  - `t5-slice`: a specified feature across four files.
- Held-out groups (0.17.1), written blind like groups `a` to `c`:
  - Group `d` (`evals-heldout/d/`) has 10 harder cases.
    Each is a git repository with 18 to 37 files and several traps that interact, with up to 80 turns.
    Groups `a` to `c` were at their ceiling (27 of 30 cases passed every trial in both arms).
  - Group `e` (`evals-heldout/e/`) has 10 more hard cases from dossier parts 04 and 05 and other parts that no earlier case cites.
    Each is a git repository with 20 to 38 files, and six hold uncommitted user work that must survive.
  - No agent has run group `d` or `e` yet.

## Changed

- Subagent conventions: 1k characters, down from 2.7k.
- Descriptions: each skill and agent description is at most 200 characters, about 150 for most.
  It says what the item does, then when to use it, then what it is not for.
- `slices`: a slice with `risk: high` gets a second `reviewer` with the `code` lens.
- Model lock: allows Sonnet 5.5 at `high` effort, and still denies `xhigh` and `max`.
  The release charts of Anthropic show that Sonnet 5.5 at `high` costs about as much as Opus 5.5 one level lower for about the same score.
- `setup` skill: links its integrations reference from `SKILL.md`.
- Bash guard, temp and ignored paths: no longer asks for a bulk remove in a temp folder or in a gitignored path.
  This covers `rm -r` on `$TMPDIR` and `$CLAUDE_CODE_TMPDIR` paths, and `find -delete` or `fd -x rm` in an ignored folder.
  A path that overlaps the project, a folder with tracked files, a link-following search, and a reassigned temp variable still ask.
- Bash guard, inline scripts: reads the code of an inline `python`, `node`, `perl`, or `ruby` script without its comments and strings.
  A word such as `rmtree` in a comment or a docstring no longer causes a warning, and a comment such as `# don't` no longer hides a real remove after it.
- Bash guard, discards: `git checkout --`, `git checkout .`, `git restore`, and `git reset --hard` ask only when the paths they overwrite have uncommitted changes.
  They also ask when an earlier command in the line can restore changes (`git stash pop`, `patch`, `git apply`).
- Stop gate: ignores edits to dotfile config paths, such as `.prettierrc` and `.github/workflows/ci.yml`.
  Its reasons are shorter, because Claude Code can send a Stop reason two times (#96909).
- `Agent` model-lock deny reason: one sentence.
- Compaction hooks: do nothing for a subagent.
  Claude Code can send a subagent compaction with no agent fields (#91910), so dotclaude also finds a subagent from its transcript path.
  Before, a subagent compaction could replace the saved prompts of the main session.
- Output style, MRE (0.17.1): tells Claude to show the MRE itself (command, test, or code) and its output in the reply.
  Before, it said "Report it with its output", and replies gave the results without the command that made them.
  In 3 `t1-false-alarm` runs on Sonnet 5.5, 0 replies showed the command before the change, and 3 did after it.
- Output style, follow-ups (0.17.1): tells Claude to state a gap or a follow-up as a fact, with no offer such as "If you want it, say so".
  In the 0.17.1 re-run, 3 of 20 Sonnet 5.5 replies to `t1-fix` ended with such an offer.
- `reviewer` and `debugger` (0.17.1): use Sonnet 5.5 at `high`, not Opus 5.5.
  In the 0.17.1 evals, Sonnet 5.5 at `high` passed `t5-review` in 20 of 20 trials and the debug cases in 40 of 40, at 52% to 56% of the cost of Opus 5.5 for each pass.
  The cases are at the ceiling for both models, so harder reviews are not tested.
- Eval graders (0.17.1): `t1-false-alarm` has two judges.
  One checks that the reply says the bug did not reproduce and that nothing changed, and the other checks that the reply shows the command with its output.
  A right reply without the command now fails only the second.
  The `t1-fix` grader `reproduced-first` accepts `Write` as well as `Edit` after the first test run, and it is now a `regex` grader on the trace, because `tool_order` takes only one tool.
- Dossier (0.17.1): a new part, [Claude Mods](Claude-Mods), records the plugin hooks modules of Claude Code 2.1.287 and the plan for a dotclaude mod in 0.18.
- CI (0.17.1): runs the tests on Windows too, and a `.gitattributes` file keeps LF line endings on Windows checkouts.

## Removed

- `hooks/lib/_system-prompt.mjs`, and the session-start notices about the shell function and the system-prompt copy.
- The agents `code-reviewer`, `security-reviewer`, `plan-reviewer`, `diff-reviewer`, `ci-investigator`, `history-investigator`, `dependency-auditor`, `performance-engineer`, `test-writer`, `docs-writer`, and `integration-setup`.
- `expand-inline-skill.mjs` (0.17.1): a `UserPromptSubmit` hook.
  Claude Code 2.1.287 tells Claude about each skill named in a message, and it lets the `Skill` tool run a user-only skill that the user typed.

## Fixed

- `git reset --hard <commit>`: asks when the commit has a file that git does not track now but that exists on disk, because the reset overwrites it.
- `rm -r` in a temp project: with an absolute path into a project under a temp folder, it gets the project checks.
  Before, the temp-folder shortcut let it run.
  A temp path whose variable can complete the name of the project, for example `/tmp/pr$x` for the project `/tmp/proj`, also gets them.
- `rm -r` of untracked files in the project that git does not ignore: warns, as for tracked files, because git cannot restore them.
- `find /tmp -maxdepth 1 -name 'ojd-*' -exec rm -rf {} +` (0.17.1): asked when the project was in `/tmp`, the usual case on Linux.
  A name-filtered remove with `-maxdepth 1` in a temp folder that holds the project now runs when no name matches the project entry in that folder.
  The Linux CI job failed on this.
- `node --test` (0.17.1): did not count as a check, so the Stop hook still said that no check ran after the last edit.
  In the 0.17.1 evals, 64 of 200 replies to code tasks mentioned the note.
  A `node` command with only flags before `--test` now counts.
- Last message (0.17.1): in `claude -p`, the Agent SDK, and subagents, the caller gets only the last message.
  When a Stop hook sent Claude back after a full report, the short second reply replaced the report.
  The Stop and SubagentStop notes now tell Claude to make its last message the full report there.
- `CLAUDE_CONFIG_DIR`: `apply-settings.mjs`, `apply-claude-md.mjs`, and `status.mjs` use it for the user scope.
  Before, they wrote to and read `~/.claude` also when Claude Code used another folder.
- `just sandbox`: gives `claude` a sandbox `HOME`, so `/dotclaude:setup` in it cannot change the shell startup files of the user.
  It also removes the session variables of the Claude Code session that starts it (`DOTCLAUDE_*`, `CLAUDE_PLUGIN_*`, the session ID, and the `env` values of the real settings).
  Before, they leaked into the sandbox, and the sandbox showed a wrong "settings profile is out of date" notice.
- `scripts/usage-report.mjs`: counted the first streamed record of each message, whose output count is near zero.
  It now counts the record with the largest output, once for each message, and subagent output was undercounted by up to four times.
  It also gives the output tokens and the messages with no final record, whose count is a lower bound.
- `evals/report.mjs`: scored the `with-only` graders in both arms without a word when the files of a case were gone, as for an old result file.
  It now prints a warning for each such case.
  For a one-case result it printed `NaN%` and left out the comparison with the run without the plugin.
  It now gives the pass rate and the difference, and it says that one case gives no interval.
- Eval commands in [Development](Development#evals) (`docs/development.md`): set `--judge-model sonnet`, because the default Haiku judge failed a right `t4-slices` reply 3 times out of 3.
- `evals-heldout/README.md`: its judge is now Sonnet 5.5, not Opus 5.5, because a model prefers its own output.
- `/dotclaude:slices`: let Claude end its setup with a choice between the loop and a direct change, and recommend the direct change (one of three Opus 5.5 eval runs).
  The skill now asks the user to approve the slice list, with at most one sentence of advice.
  It also writes the loop files with the `Write` tool, so that the user can review them and the `t4-slices` order grader sees them.
- Windows (0.17.1): the CI job had 75 failures, then 5.
  - `apply-settings.mjs` and `apply-claude-md.mjs` did not find their profiles, because they read their folder from the URL path (`/D:/...`).
    They now use `import.meta.dirname`.
  - The Bash guard did not see temp paths.
    It now reads command paths as Git Bash does (`/tmp` is the folder that `TEMP` names, `/c/` is the drive `C:`), compares temp folders with `/` separators, and knows the Windows temp folder.
    The temp remove check of the agent budget uses the same rules.
  - The ledger, the nested instruction note, the status line, the instruction size note, and the search guard now give paths below the project with `/`.
    With `\`, the checks for dot folders and `.claude/` failed on Windows.
  - `exclude-session-files` asks git for the path below the top level, because a short name such as `RUNNER~1` made the path comparison fail.
  - The Bash guard asked before a `git` discard in a clean folder that `-C` or `cd` gave with a `~` inside the name, such as `RUNNER~1`.
    Only a `~` at the start of the name now makes the folder unknown, because Bash expands `~` only there.
  - Tests write paths in commands with `/`, set `USERPROFILE` beside `HOME`, and expect native paths.
    Tests that run a `#!/bin/sh` stub or a mode 000 folder run only on POSIX systems.
- Setup skill (0.17.0): tells Claude to report the paths that the scripts print, because `CLAUDE_CONFIG_DIR` can move them from `~/.claude`.
  It also tells Claude that an empty "keep" answer keeps no built-in switch.
- Plan docs (0.17.0): `docs/models.md` told how to set the plan for a login through `CLAUDE_CODE_OAUTH_TOKEN`, because that login caches no account (removed in 0.20.0).
- Markdown lint (0.17.1): all tracked Markdown passes markdownlint.
  `evals-heldout/` and the `dotclaude-browser` skills get the prompt-file rules of `skills/`.
  The `c-already-fixed` prompt puts the email address in backticks, so it is not a bare URL.
  In `contribute`, step 1 of the procedure was inside the `<procedure>` HTML block and did not render as a list item.

Previous: [Release 0.16](Release-0.16) · Next: [Release 0.18](Release-0.18)
