---
name: apply-settings-profile
description: Preview and apply the dotclaude settings profile (models, fast mode off, effort cap, secret-file denies, git instructions, agent bounds) to a Claude Code settings file, with optional managed-settings and global `CLAUDE.md` additions. Run when the user types /dotclaude:apply-settings-profile or asks to apply, update, or check the dotclaude settings.
disable-model-invocation: true
argument-hint: "[user|project|local]"
allowed-tools: Bash(bun *apply-settings.mjs*) Bash(bun *apply-claude-md.mjs*) Bash(bun *install-managed.mjs*)
---

<task>
Apply the dotclaude settings profile to a settings file the user picks. Claude Code applies only `agent` and `subagentStatusLine` from a plugin, so a plugin cannot set permissions, environment variables, or model settings itself. This skill merges `profiles/recommended.json` into the chosen file, keeping the settings half of dotclaude under the user's control and easy to review.
</task>

<procedure>

1. Pick the scope. Use `$ARGUMENTS` if it is `user`, `project`, or `local`. Otherwise ask the user, offering: **User** (`~/.claude/settings.json`, applies everywhere; default), **Project** (`.claude/settings.json`, shared through git), **Local** (`.claude/settings.local.json`, this checkout only).

2. Preview. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope>
   ```

3. Show the user the listed changes, grouped as below, and ask whether to apply them.

   | Group | Keys | Why |
   | --- | --- | --- |
   | Fast mode off | `env.CLAUDE_CODE_DISABLE_FAST_MODE=1`, `fastMode: false`, `fastModePerSessionOptIn: true`, `ultracode: false` | The env var removes the `/fast` toggle; the others keep a stray toggle, or ultracode's xhigh orchestration, from persisting. With `workflowKeywordTriggerEnabled: false`, ultracode starts only when the user picks `/effort ultracode`; no setting disables it alone, and the `xhigh` cap does not block it. |
   | Models | `model`, `availableModels`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL`, `env.ANTHROPIC_DEFAULT_SONNET_MODEL`, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`, `Agent(model:claude-sonnet*)` deny | Keeps the session, subagents, and advisor on Opus 5.5, with Fable 5.1 available and Haiku 4.5 for web research and Claude Code's background tasks. Anything asking for the `sonnet` alias runs on Opus 5.5. |
   | Effort cap | `maxEffortLevel: xhigh` | `max` is blocked because the claude.ai effort picker warns it uses about 5.5x usage on Opus 5.5 and 3.5x on Fable 5.1 (as of 2026-09-26); `xhigh` stays for the rare hard turn. The lowest cap across settings scopes applies. |
   | Subagent and workflow bounds | `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=6`, `env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=6`, `workflowSizeGuideline: medium` | Fan-out is the largest driver of quota burn in long sessions, and past about six parallel agents rate limits make agents retry and burn context. The workflow env var hard-caps agents running at once in a workflow; the size guideline only advises Claude how many to plan. Workflows stay enabled. |
   | Task list | `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | The task-list tools are off by default on Opus 5.5, and the dotclaude output style relies on them. |
   | Feedback off | `env.DISABLE_FEEDBACK_COMMAND=1`, `env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `env.DISABLE_ERROR_REPORTING=1` | Removes `/feedback`, `/bug`, `/share`, and the SendFeedback tool (about 5.5 KB sent on every request), the session-quality survey, and error reports. Telemetry itself stays on, because `DISABLE_TELEMETRY` and `DO_NOT_TRACK` also stop feature-flag fetching, which removes the advisor tool and the marking of large pastes. |
   | Tools | `permissions.deny` `AskUserQuestion` | Removes the multiple-choice question tool, about 4.9 KB sent on every request; Claude asks in plain text instead. |
   | Secrets | `permissions.deny` `Read(...)` rules for `.env`, `.env.local`, `.env.production`, `.env.*.local`, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json` | Keeps credentials out of the context window. |
   | Safety | `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false` | No bypass mode, no silent project MCP servers, and the word "ultracode" in a prompt does not launch a workflow. |
   | Git instructions | `includeGitInstructions: false` | Removes Claude Code's built-in commit and PR instructions; the dotclaude output style carries its own git section. |
   | Schema | `$schema` | Lets editors validate and complete the file against the published settings schema. |

   The merge adds keys and rules and removes nothing, except that the model policy is replaced rather than merged, because dotclaude owns it: `availableModels` becomes the profile's list, and `Agent(model:...)` deny rules the profile does not carry are removed. The preview names every removal.

   If the user wants to drop a group, copy the profile to a temporary file, remove those keys, and pass it with `--profile <file>`.

4. Apply, after the user agrees:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope> --apply
   ```

   The script backs up the existing file next to it before writing. If the permission system blocks the command, give the user the exact command to run with the `!` prefix instead of retrying, since a block is the user's decision.

5. Offer the global `CLAUDE.md` section. It adds a short, marked block to `~/.claude/CLAUDE.md` naming the CLI tools found on this machine, when to load the `drive-web-browser` skill, reading the branch and `git status` before git work, and that a repository's own files define its commands. It also adds a `# CLAUDE.md` heading at the top if the file has no top-level heading, and leaves everything else as it is. Preview it, show it to the user, and apply it only if they agree:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs" --apply
   ```

   Re-running replaces the block in place, and `--remove --apply` takes it out again.

6. Offer the optional managed-settings lock described in `<managed_settings>` below.

7. Tell the user to restart Claude Code, since `env`, model settings, managed settings, and `CLAUDE.md` are read at startup.
</procedure>

<plugin_options>
The plugin's own options (the guards, the stop gate, `allowed_models`) live in `/config` under dotclaude. If the user changes `availableModels`, remind them to set the same list in the `allowed_models` option, so the hooks and the settings agree on which models are allowed.
</plugin_options>

<managed_settings>
User and project settings stay editable, so a stray `/fast` or a later edit can undo them. After the profile is applied, offer the managed drop-in as an optional self-lock: a managed settings file the user cannot change or remove without admin rights, setting only `maxEffortLevel: "xhigh"`, `fastMode: false`, `fastModePerSessionOptIn: true`, and the three `availableModels`. Say plainly that undoing it later also takes admin rights, and install it only if the user wants that.

The script writes `managed-settings.d/50-dotclaude.json` inside the managed settings directory (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux and WSL). Claude Code merges `managed-settings.json` first and then every `*.json` in `managed-settings.d/` in alphabetical order, so the drop-in leaves any existing `managed-settings.json` untouched; the script names any keys the two share. On Windows (`C:\Program Files\ClaudeCode\`) it prints the path and content for the user to create from an administrator shell.

1. Show the dry run, which needs no admin rights and writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs"
   ```

2. If the user wants the lock, give them the command the dry run printed to run in their own terminal, since `sudo` needs one for its password prompt. It names Bun by absolute path because `sudo` resets `PATH` on Linux:

   ```bash
   sudo "$(command -v bun)" "${CLAUDE_SKILL_DIR}/scripts/install-managed.mjs" --apply
   ```

   Claude never runs `sudo`, because admin rights are the user's to grant. If a different `50-dotclaude.json` is already there, the script shows old and new and asks before overwriting (without a terminal it refuses unless given `--yes`), keeping a backup outside `managed-settings.d/` so Claude Code never reads it. A managed file that is not a valid JSON object stops Claude Code from starting, so the script validates the new file before moving it into place.
</managed_settings>
