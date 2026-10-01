---
name: setup
description: Sets up dotclaude and migrates from 0.16, with settings, auto-update, status line, and integrations. Use after an install or update. Not for plugin options.
disable-model-invocation: true
argument-hint: "[user|project|local] | managed | integrations [name] [what to change]"
allowed-tools: Bash(bun *apply-settings.mjs*) Bash(bun *apply-claude-md.mjs*) Bash(bun *apply-statusline.mjs*) Bash(bun *install-managed.mjs*) Bash(bun *migrate.mjs*) Bash(bun *status.mjs*)
---

<task>
Set up dotclaude for the user. Claude Code applies only `agent` and `subagentStatusLine` from a plugin, so a plugin cannot set permissions, environment variables, or model settings itself. This skill merges `profiles/recommended.json` into a settings file that the user picks, and it removes what dotclaude 0.16 installed outside that file. The user reviews each change before it is written.

If `$ARGUMENTS` starts with `integrations`, do only `<integrations>` below. If `$ARGUMENTS` starts with `managed`, do only `<managed_settings>` below, in the organization mode.
</task>

<procedure>

1. Find the 0.16 leftovers. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/migrate.mjs"
   ```

   dotclaude 0.16 added a `claude` function to the shell startup files and kept a system-prompt copy in `~/.claude/dotclaude/`. The function replaced Claude Code's system prompt. 0.17 puts its rules in the `dotclaude` output style, so the function is no longer necessary. 0.17 also renamed most plugin options, and the script moves each value that is set to its new name. If the preview finds nothing, skip the migration question in step 4.

2. Pick the scope. Use `$ARGUMENTS` if it is `user`, `project`, or `local`. Otherwise, ask the user and offer these scopes: **User** (`~/.claude/settings.json`, applies everywhere, the default), **Project** (`.claude/settings.json`, shared through git), **Local** (`.claude/settings.local.json`, this checkout only). When `CLAUDE_CONFIG_DIR` is set, the scripts use that directory in place of `~/.claude`. Give the user the paths that the scripts print, because those are the files that changed.

3. Preview the profile. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope>
   ```

   Show the user the listed changes, grouped as below. Do not ask yet. Step 4 asks once for all choices.

   | Fast mode off | `env.CLAUDE_CODE_DISABLE_FAST_MODE=1`, `fastMode: false`, `fastModePerSessionOptIn: true`, `ultracode: false` | The env var removes the `/fast` toggle. The others keep a stray toggle, or ultracode's `xhigh` orchestration, from persisting. With `workflowKeywordTriggerEnabled: false`, ultracode starts only when the user picks `/effort ultracode`. No setting disables it alone. The `xhigh` cap does not block it. |
   | Models | `model`, `availableModels`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL`, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`, `Agent(model:fable*)` deny (the `Agent` tool sends a model alias, never a full ID) | Keeps the session and advisor on Opus 5.5. Sonnet 5.5 runs built-in subagents that set no model of their own, such as dotclaude's `implementer` and low-judgment agents. Fable 5.1 runs only the main conversation (a fresh Fable context costs about 2.5x an Opus one). Haiku 4.5 runs Claude Code's background tasks. On Pro or a standard Team seat with extra usage off, `availableModels` excludes Fable, because those plans run it on usage credits. |
   | Lean system prompt | `env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1` | Claude Code's shorter built-in prompt, which Claude Code already uses in some sessions. It sends about 6.6k fewer tokens on every request, mostly from condensed auto-memory instructions. The tools stay the same. |
   | Background usage | `autoCompactWindow: 150000` on every plan, `promptSuggestionEnabled: false`, `awaySummaryEnabled: false`, `crossSessionInbound: "hold"` | Every request re-reads the whole context. Compacting at 150k instead of the default (about 967k on current models) keeps each turn smaller. The value is sized for Pro and applies on every plan. Prompt suggestions send an extra request after every response. Session recap sends one when you are away. Cross-session messages start idle turns. Each re-reads the context. `/recap` still works on demand. |
   | Effort cap | `maxEffortLevel: xhigh` | The cap blocks `max` because of its usage. The claude.ai effort picker warns that `max` uses about 5.5x usage on Opus 5.5 and 3.5x on Fable 5.1 (as of 2026-09-26). `xhigh` stays for the rare hard turn. The lowest cap across settings scopes applies. |
   | Subagent and workflow bounds | `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=5`, `env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=5`, `workflowSizeGuideline: medium`, `env.CLAUDE_CODE_FORK_SUBAGENT=0`, `Agent(general-purpose)` deny | Subagents were 55% of one measured Max 20x week, and parallel agents spend a Pro 5-hour window several times faster. Five at once is the community figure. A cap of three caused 50 of 77 measured `Agent` errors. A value that you set stays. The workflow env var hard-caps agents running at once in a workflow. The size guideline only advises Claude how many to plan. Workflows stay enabled. Forks are off, because fork mode forces every subagent into the background. A background agent's report wakes the main conversation for extra full turns. The deny removes `general-purpose` from the agent list that Claude sees. The plugin's hook refuses that agent, but in one week Claude asked for it 244 times, because the list still named it. |
   | Task list | `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | The task-list tools are off by default on Opus 5.5, and dotclaude's rules rely on them. |
   | Search scope | `env.CLAUDE_CODE_GLOB_NO_IGNORE=false` | The `Glob` tool lists gitignored files by default. In Claude Code 2.1.283, it runs `rg --files --no-ignore`. So a pattern such as `**/*.swift` returns everything under build output and dependency directories. The `Grep` tool already skips them. This env var comes from the Claude Code source, not from the docs. |
   | Feedback off | `env.DISABLE_FEEDBACK_COMMAND=1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `env.DISABLE_ERROR_REPORTING=1` | Removes `/feedback`, `/bug`, `/share`, and the `SendFeedback` tool (about 5.5 KB sent on every request). Also removes the session-quality survey and error reports. Telemetry itself stays on, because `DISABLE_TELEMETRY` and `DO_NOT_TRACK` also stop feature-flag fetching. That removes the advisor tool and the marking of large pastes. |
   | Secrets | `permissions.deny` `Read(...)` rules for `.env`, `.env.local`, `.env.production`, `.env.*.local`, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json` | Keeps credentials out of the context window. |
   | Safety | `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false` | No bypass mode, no silent project MCP servers, and the word "ultracode" in a prompt does not start a workflow. |
   | Contribution approval | `permissions.ask` rules for `gh pr create`, `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment`, `gh discussion create`, and `gh discussion comment` | Each one speaks for the user in public. An ask rule shows a permission prompt for each call, and it wins over an allow rule. dotclaude's Bash guard also asks before a push or write to a repository that the user does not own, and denies contributions to projects that forbid AI. |
   | Git instructions | `includeGitInstructions: false` | Removes Claude Code's built-in commit and PR instructions. The `dotclaude` output style carries its own git rules. The `git_attribution` option keeps the commit trailer and PR footer. A session note keeps the Claude Code 2.1.286 instruction to run a user or project `verify` or `simplify` skill, and `/code-review medium` when `includeCodeReviewSuggestion` is true, before each commit. |
   | Schema | `$schema` | Lets editors check and complete the file against the published settings schema. |

   The merge adds keys and rules and removes nothing, with one exception. It replaces the model policy instead of merging it, because dotclaude owns it. `availableModels` becomes the profile's list. The merge removes `Agent(model:...)` deny rules that the profile does not carry. The preview names every removal.

   If the user wants to drop a group, copy the profile to a temporary file. Remove those keys, and pass the file with `--profile <file>`.

   Then list the built-in switches from `profiles/optional.json`. The preview includes them all. Each one removes a Claude Code feature, so ask which to keep:

   | Switch | Removes | Why |
   | --- | --- | --- |
   | `artifact` | the `Artifact` tool | about 34 KB on every request. It publishes pages to claude.ai |
   | `workflows` | the `Workflow` tool and workflow skills | about 5.4 KB per request. Workflows start many agents |
   | `loops` | the cron tools and `ScheduleWakeup` | about 4.6 KB per request. Each `/loop` wake-up is a full turn |
   | `report-findings` | `ReportFindings` | about 2.2 KB per request. Only Claude Code's `/code-review` uses it |
   | `advisor` | the advisor tool | each call reads the whole conversation without the cache |
   | `explore-plan` | the `Explore` and `Plan` agents | they run on the main model, and dotclaude's agents cover them |
   | `bundled-skills` | Claude Code's bundled skills and workflows | their entries in the per-turn skill listing |
   | `auto-memory` | auto memory | its index in every session and its memory writes |
   | `refusal-retry` | the automatic retry after a refusal | an extra request |

   Pass the ones the user keeps as `--skip name,name` in both the preview and the apply command. An empty answer means that the user keeps none, so pass no `--skip`. If an earlier run applied a switch that the user now skips, the switch stays in the settings file. It stays there until the user removes its key.

   At user scope, the preview also turns on Claude Code's auto-update. It sets `autoUpdatesChannel: "stable"` and `minimumVersion` to the running or tested Claude Code version, whichever is newer. A higher `minimumVersion` that the user set stays. It removes `env.DISABLE_AUTOUPDATER`. `--auto-update off` writes `env.DISABLE_AUTOUPDATER: "1"` instead. The script does not remove `env.DISABLE_UPDATES`, because an administrator can set it. It prints a note when it finds it. Project and local scope do not change these keys. A Homebrew install picks its channel by cask name (`claude-code` is stable), not by this setting.

4. Run the previews of steps 5 and 6 (they write nothing), and show them. Then ask one `AskUserQuestion` call with these questions, each with the recommended option first:

   - Remove the 0.16 `claude` function and its prompt copy (only if step 1 found them).
   - Apply the profile, or drop some groups.
   - Claude Code auto-update: on with the stable channel, or off (only at user scope). `stable` is Claude Code's slower release channel. `minimumVersion` stops a downgrade when `stable` is behind the running version. Each update starts a session with a cold prompt cache.
   - Which built-in switches to keep (multi-select).
   - Which extras to install (multi-select): the global `CLAUDE.md` section, the status line, and the managed-settings lock.

   Then run the apply command of each item that the user picked, without a second question in text. dotclaude's Bash guard shows a permission prompt for each `--apply`, and that prompt is the approval of the write. A second question for the same write teaches the user to approve without reading.

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/migrate.mjs" --apply
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope> [--skip name,...] [--auto-update off] --apply
   ```

   Each script backs up a file next to itself before it writes. A second run changes nothing. If the user declines a prompt, stop. If something blocks the command anyway, give the user the exact command to run with the `!` prefix. Do not retry, because a block is the user's decision.

5. The global `CLAUDE.md` section. It adds a short, marked block to `~/.claude/CLAUDE.md` that names:

   - the CLI tools found on this machine
   - reading the branch and `git status` before git work
   - that a repository's own files define its commands
   - a `# Compact instructions` section that tells the compaction summary what to keep word for word

   If the file has no top-level heading, it also adds a `# CLAUDE.md` heading at the top. It leaves everything else as it is. Preview it in step 4, and apply it if the user picked it:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs" --apply
   ```

   A second run replaces the block in place. `--remove --apply` removes the block again.

6. The dotclaude status line. It replaces the user's `statusLine` setting, so show the current command from the preview in step 4:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-statusline.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-statusline.mjs" --apply
   ```

   The line shows these items:

   - the folder
   - the git branch with changed files and ahead/behind counts
   - the model and effort
   - the context against the 117k compaction point
   - when the prompt cache goes cold, and its hit ratio
   - the 5-hour and weekly limits

   Colors change at 75% and 90%. Without plan limits, it shows the session's estimated cost. The plugin also sets `subagentStatusLine` through a stub that session start writes. Each subagent row then shows its context against its context budget: 100k, or 150k for the reviewers. `--remove --apply` removes the status line again.

7. If the user picked the managed-settings lock, follow `<managed_settings>` below.

8. Offer the integrations. Run `bun "${CLAUDE_SKILL_DIR}/scripts/status.mjs"` and tell the user which integrations are missing. Do not install one unless the user asks for it.

9. Tell the user to restart Claude Code, because Claude Code reads `env`, model settings, managed settings, and `CLAUDE.md` at startup. If the migration removed the shell function, also tell them to open a new terminal. An open terminal keeps the old function until then.
</procedure>

<integrations>

1. Run the status script first and after every change. Base each step on what it reports, not on assumptions:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/status.mjs"
   ```

2. With no integration named, or with `status`, report the status and what is missing, and change nothing.

3. For each integration that the request names, read its section in [`references/integrations.md`](references/integrations.md) and follow it. That file holds the install steps and the checks for each integration.

Rules for these changes:

- Use only the commands in `references/integrations.md` and the tools' own `--help` output. These tools change often, so a flag that you remember can be out of date. If a command fails or a flag is missing, stop that integration and report the exact error, because a workaround can leave the setup half changed.
- Leave credential files (`.env`, tokens) unread. Each value that you read goes into the transcript, so the secret stops being private. A login that needs the user's browser is the user's step: give them the exact `! <command>` line.
- Keep sandboxes, approvals, and hook trust on. A flag that bypasses them removes the user's control over what runs.
- Do not change settings files for an integration. Give the user the exact JSON and the steps.
- Anything outside the request (another integration, an optional setting) is a suggestion for your report, not an action.

Report, for each integration that you changed: the commands that you ran, the files and keys that changed, the status after the change, and the steps that the user must do (a login, a restart, a command that a guard blocked).
</integrations>

<plugin_options>
The plugin's own options (the guards, the stop gate, `model_allowed`) are in `/config` under dotclaude. If the user changes `availableModels`, remind them to set the same list in the `model_allowed` option. Then the hooks and the settings allow the same models.
</plugin_options>

<managed_settings>
User and project settings stay editable, so a stray `/fast` or a later edit can undo them. Offer the managed drop-in in step 4 as an optional self-lock. It is a managed settings file that the user cannot change or remove without admin rights. It sets only `maxEffortLevel: "xhigh"`, `fastMode: false`, `fastModePerSessionOptIn: true`, and the four `availableModels`. Say plainly that undoing it later also takes admin rights, and install it only if the user wants that.

In the organization mode, an admin installs dotclaude for every user of the computer. Add `--org` to each `install-managed.mjs` command below. The drop-in then also enables `dotclaude@dotclaude`, declares its marketplace, sets `enforceAvailableModels`, and sets `requiredMinimumVersion`. It sets no `strictKnownMarketplaces` and no `permissions`, because those depend on the organization. Point the admin to `docs/organizations.md` in the plugin for those keys and for plugin options for every user.

The script writes `managed-settings.d/50-dotclaude.json` inside the managed settings directory (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux and WSL). Claude Code merges `managed-settings.json` first and then every `*.json` in `managed-settings.d/` in alphabetical order. So the drop-in leaves any existing `managed-settings.json` untouched. The script names any keys the two share. On Windows (`C:\Program Files\ClaudeCode\`) it prints the path and content for the user to create from an administrator shell.

1. Show the dry run, which needs no admin rights and writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs"
   ```

2. If the user wants the lock, run it through `sudo -A`. The `Bash` tool has no terminal for the `sudo` password prompt. So `scripts/askpass.sh` asks for the password in a desktop dialog. It uses `osascript` on macOS, and `zenity`, `kdialog`, or `ssh-askpass` on Linux. The command names Bun by absolute path because `sudo` resets `PATH` on Linux:

   ```bash
   SUDO_ASKPASS="${CLAUDE_SKILL_DIR}/scripts/askpass.sh" sudo -A "$(command -v bun)" "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs" --apply
   ```

   The user approves twice. dotclaude's Bash guard shows a permission prompt for the command, and the dialog asks for the admin password. If the user declines either one, stop and do not retry. If no dialog is available, the script says so. In that case, give the user the same command without `SUDO_ASKPASS=…` and `-A`. Do the same when the user prefers their own terminal.

   If a different `50-dotclaude.json` is already there, the script shows old and new and asks before overwriting. Without a terminal, it refuses unless given `--yes`. First show the user the current file and the new content. Pass `--yes` only after the user agrees to replace it. It keeps a backup outside `managed-settings.d/`, so Claude Code never reads it. An invalid managed JSON file stops Claude Code from starting. The script checks the new file before moving it into place.
</managed_settings>
