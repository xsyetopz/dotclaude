---
name: apply-settings-profile
description: "Preview and apply the dotclaude settings profile (models, fast mode off, effort cap, secret-file denies, git instructions, agent bounds) to a Claude Code settings file, with the system-prompt launcher and optional managed-settings and global `CLAUDE.md` additions. Run when the user types /dotclaude:apply-settings-profile or asks to apply, update, or check the dotclaude settings."
disable-model-invocation: true
argument-hint: "[user|project|local]"
allowed-tools: Bash(bun *apply-settings.mjs*) Bash(bun *apply-claude-md.mjs*) Bash(bun *apply-launcher.mjs*) Bash(bun *apply-statusline.mjs*) Bash(bun *install-managed.mjs*)
---

<task>
Apply the dotclaude settings profile to a settings file the user picks. Claude Code applies only `agent` and `subagentStatusLine` from a plugin, so a plugin cannot set permissions, environment variables, or model settings itself. This skill merges `profiles/recommended.json` into the chosen file, keeping the settings half of dotclaude under the user's control and easy to review.
</task>

<procedure>

1. Pick the scope. Use `$ARGUMENTS` if it is `user`, `project`, or `local`. Otherwise ask the user, offering: **User** (`~/.claude/settings.json`, applies everywhere, the default), **Project** (`.claude/settings.json`, shared through git), **Local** (`.claude/settings.local.json`, this checkout only).

2. Preview. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope>
   ```

3. Show the user the listed changes, grouped as below, and ask whether to apply them.

   | Group | Keys | Why |
   | --- | --- | --- |
   | Fast mode off | `env.CLAUDE_CODE_DISABLE_FAST_MODE=1`, `fastMode: false`, `fastModePerSessionOptIn: true`, `ultracode: false` | The env var removes the `/fast` toggle. The others keep a stray toggle, or ultracode's xhigh orchestration, from persisting. With `workflowKeywordTriggerEnabled: false`, ultracode starts only when the user picks `/effort ultracode`. No setting disables it alone. The `xhigh` cap does not block it. |
   | Models | `model`, `availableModels`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL`, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`, `Agent(model:fable*)` deny (the Agent tool sends a model alias, never a full ID) | Keeps the session and advisor on Opus 5.5. Sonnet 5 runs built-in subagents that set no model of their own, such as `general-purpose` and dotclaude's `implementer` and low-judgment agents. Fable 5.1 runs only the main conversation (a fresh Fable context costs about 2.5x an Opus one). Haiku 4.5 runs Claude Code's background tasks. On Pro or a standard Team seat with extra usage off, `availableModels` leaves Fable out, since those plans run it on usage credits. |
   | Lean system prompt | `env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1` | Claude Code's shorter built-in prompt, which it already rolls out to some sessions: about 6.6k fewer tokens on every request, mostly from condensed auto-memory instructions, with the same tools. |
   | Background usage | `autoCompactWindow: 200000` on every plan, `promptSuggestionEnabled: false`, `awaySummaryEnabled: false`, `crossSessionInbound: "hold"` | Every request re-reads the whole context. Compacting at 200k instead of the default (about 967k on current models) keeps each turn smaller. The value is sized for Pro and applies on every plan. Prompt suggestions send an extra request after every response, session recap sends one when you step away, and cross-session messages start idle turns. Each re-reads the context. `/recap` still works on demand. |
   | Effort cap | `maxEffortLevel: xhigh` | `max` is blocked because the claude.ai effort picker warns it uses about 5.5x usage on Opus 5.5 and 3.5x on Fable 5.1 (as of 2026-09-26). `xhigh` stays for the rare hard turn. The lowest cap across settings scopes applies. |
   | Subagent and workflow bounds | `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3`, `env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=3`, `workflowSizeGuideline: medium`, `env.CLAUDE_CODE_FORK_SUBAGENT=0` | Subagents were 55% of one measured Max 20x week, and parallel agents spend a Pro 5-hour window several times faster. Three at once is sized for Pro, and larger plans only run out later. The workflow env var hard-caps agents running at once in a workflow. The size guideline only advises Claude how many to plan. Workflows stay enabled. Forks off, because fork mode forces every subagent into the background, and a background agent's report wakes the main conversation for extra full turns. |
   | Task list | `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | The task-list tools are off by default on Opus 5.5, and the dotclaude system prompt relies on them. |
   | Search scope | `env.CLAUDE_CODE_GLOB_NO_IGNORE=false` | The Glob tool lists gitignored files by default (it runs `rg --files --no-ignore` in Claude Code 2.1.283), so a pattern such as `**/*.swift` returns everything under build output and dependency directories. The Grep tool already skips them. This env var is read from the Claude Code source, not documented. |
   | Feedback off | `env.DISABLE_FEEDBACK_COMMAND=1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `env.DISABLE_ERROR_REPORTING=1` | Removes `/feedback`, `/bug`, `/share`, and the SendFeedback tool (about 5.5 KB sent on every request), the session-quality survey, and error reports. Telemetry itself stays on, because `DISABLE_TELEMETRY` and `DO_NOT_TRACK` also stop feature-flag fetching, which removes the advisor tool and the marking of large pastes. |
   | Secrets | `permissions.deny` `Read(...)` rules for `.env`, `.env.local`, `.env.production`, `.env.*.local`, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json` | Keeps credentials out of the context window. |
   | Safety | `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false` | No bypass mode, no silent project MCP servers, and the word "ultracode" in a prompt does not start a workflow. |
   | Git instructions | `includeGitInstructions: false` | Removes Claude Code's built-in commit and PR instructions. The dotclaude system prompt carries its own git section. The `git_attribution` option keeps the commit trailer and PR footer. |
   | Schema | `$schema` | Lets editors check and complete the file against the published settings schema. |

   The merge adds keys and rules and removes nothing, except that the model policy is replaced rather than merged, because dotclaude owns it. `availableModels` becomes the profile's list, and `Agent(model:...)` deny rules the profile does not carry are removed. The preview names every removal.

   If the user wants to drop a group, copy the profile to a temporary file, remove those keys, and pass it with `--profile <file>`.

   Then list the built-in switches from `profiles/optional.json`. The preview includes them all, and each one removes a Claude Code feature, so ask which to keep:

   | Switch | Removes | Why |
   | --- | --- | --- |
   | `artifact` | the Artifact tool | about 34 KB on every request. It publishes pages to claude.ai |
   | `workflows` | the Workflow tool and workflow skills | about 5.4 KB per request. Workflows fan out many agents |
   | `loops` | the cron tools and ScheduleWakeup | about 4.6 KB per request. Each `/loop` wake-up is a full turn |
   | `report-findings` | ReportFindings | about 2.2 KB per request. Only Claude Code's `/code-review` uses it |
   | `advisor` | the advisor tool | each call reads the whole conversation without the cache |
   | `explore-plan` | the Explore and Plan agents | they run on the main model, and dotclaude's agents cover them |
   | `bundled-skills` | Claude Code's bundled skills and workflows | their entries in the per-turn skill listing |
   | `auto-memory` | auto memory | its index in every session and its memory writes |
   | `refusal-retry` | the automatic retry after a refusal | an extra request |
   | `auto-updates` | automatic updates | an update cold-starts the prompt cache |

   Pass the ones the user keeps as `--skip name,name` in both the preview and the apply command. A switch skipped now but applied earlier stays in the settings file until the user removes its key.

4. Apply, after the user agrees:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope> [--skip name,...] --apply
   ```

   The script backs up the existing file next to it before writing. With the shipped profile it also removes the exact entries older dotclaude profiles wrote and 0.8 dropped (the `AskUserQuestion` deny, the two Codex allow rules, and `ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5-5`). The preview lists each one.

   dotclaude's Bash guard asks the user to approve every `--apply` of this skill's scripts, in auto mode too, so the auto-mode classifier does not deny it as self-modification. If the user declines the prompt, stop. If the command is blocked anyway, give the user the exact command to run with the `!` prefix. Do not retry, because a block is the user's decision.

5. Offer the global `CLAUDE.md` section. It adds a short, marked block to `~/.claude/CLAUDE.md` that names:

   - the CLI tools found on this machine
   - when to load the `drive-web-browser` skill
   - reading the branch and `git status` before git work
   - that a repository's own files define its commands

   It also adds a `# CLAUDE.md` heading at the top if the file has no top-level heading, and leaves everything else as it is. Preview it, show it to the user, and apply it only if they agree:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs" --apply
   ```

   Re-running replaces the block in place, and `--remove --apply` takes it out again.

6. Install the system-prompt launcher. It is part of the default setup, so recommend it, but apply it only after the user agrees. `profiles/system-prompt.md` replaces Claude Code's built-in system prompt and holds dotclaude's engineering and git rules. Without it, the session gets only the output style's rules on how to talk and report. The script fills in the installed Claude Code version. Only the `--system-prompt-file` CLI flag replaces that prompt, and a plugin cannot pass CLI flags. So the script adds a `claude` function to the user's shell startup file, and the function passes the flag. The script finds the shell from `$SHELL`, or PowerShell on Windows. It supports zsh (`.zshrc`), bash (`.bash_profile` on macOS, `.bashrc` elsewhere), fish (`conf.d/dotclaude.fish`), and PowerShell (`$PROFILE`). If the user names another shell or file, pass `--shell` or `--rc`. Preview first:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-launcher.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-launcher.mjs" --apply
   ```

   Show the user the block and every warning the preview prints. Tell them these points:

   - The function adds nothing when they pass their own `--system-prompt` or `--system-prompt-file`. `DOTCLAUDE_SYSTEM_PROMPT=0 claude` starts one session with Claude Code's own prompt.
   - Session start keeps the prompt copy up to date after each plugin or Claude Code update.
   - Session start says when a session starts without the prompt, for example from an IDE that does not load the shell function. `DOTCLAUDE_SYSTEM_PROMPT=0` in that environment silences it.
   - The replacement does not carry auto memory's instructions or brief and focus mode's text. The script warns when auto memory is on.
   - `--remove --apply` takes the function and the prompt copy out again.

7. Offer the dotclaude status line. It replaces the user's `statusLine` setting, so show the current command from the preview and apply only if the user agrees:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-statusline.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-statusline.mjs" --apply
   ```

   The line shows the folder, the git branch with changed files and ahead/behind counts, the model and effort, the context against the 200k handoff point, when the prompt cache goes cold and its hit ratio, and the 5-hour and weekly limits. Colors change at 75% and 90%. Without plan limits it shows the session's estimated cost. The plugin also sets `subagentStatusLine` through a stub that session start writes, so each subagent row shows its context against the 150k subagent budget. `--remove --apply` takes the status line out again.

8. Offer the optional managed-settings lock described in `<managed_settings>` below.

9. Tell the user to restart Claude Code, since `env`, model settings, managed settings, and `CLAUDE.md` are read at startup. The launcher needs a new terminal.
</procedure>

<plugin_options>
The plugin's own options (the guards, the stop gate, `allowed_models`) live in `/config` under dotclaude. If the user changes `availableModels`, remind them to set the same list in the `allowed_models` option. This keeps the hooks and the settings agreeing on which models are allowed.
</plugin_options>

<managed_settings>
User and project settings stay editable, so a stray `/fast` or a later edit can undo them. After the profile is applied, offer the managed drop-in as an optional self-lock. It is a managed settings file the user cannot change or remove without admin rights, setting only `maxEffortLevel: "xhigh"`, `fastMode: false`, `fastModePerSessionOptIn: true`, and the four `availableModels`. Say plainly that undoing it later also takes admin rights, and install it only if the user wants that.

The script writes `managed-settings.d/50-dotclaude.json` inside the managed settings directory (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux and WSL). Claude Code merges `managed-settings.json` first and then every `*.json` in `managed-settings.d/` in alphabetical order, so the drop-in leaves any existing `managed-settings.json` untouched. The script names any keys the two share. On Windows (`C:\Program Files\ClaudeCode\`) it prints the path and content for the user to create from an administrator shell.

1. Show the dry run, which needs no admin rights and writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs"
   ```

2. If the user wants the lock, run it through `sudo -A`. The Bash tool has no terminal for `sudo`'s password prompt, so `scripts/askpass.sh` asks for the password in a desktop dialog (`osascript` on macOS; `zenity`, `kdialog`, or `ssh-askpass` on Linux). The command names Bun by absolute path because `sudo` resets `PATH` on Linux:

   ```bash
   SUDO_ASKPASS="${CLAUDE_SKILL_DIR}/scripts/askpass.sh" sudo -A "$(command -v bun)" "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs" --apply
   ```

   The user approves twice: dotclaude's Bash guard shows a permission prompt for the command, and the dialog asks for the admin password. If the user declines either one, stop and do not retry. If no dialog is available (the script says so), or the user prefers their own terminal, give them the same command without `SUDO_ASKPASS=…` and `-A`.

   If a different `50-dotclaude.json` is already there, the script shows old and new and asks before overwriting. Without a terminal, it refuses unless given `--yes`. Pass `--yes` only after showing the user the current file and the new content and the user agrees to replace it. It keeps a backup outside `managed-settings.d/`, so Claude Code never reads it. An invalid managed JSON file stops Claude Code from starting. The script checks the new file before moving it into place.
</managed_settings>
