---
name: apply-settings-profile
description: Preview and apply the dotclaude settings profile to a Claude Code settings file (fast mode off; Opus 5.5, Fable 5.1, and Haiku 4.5 with the Sonnet alias mapped to Opus; built-in git instructions replaced; secret-file read denies; subagent caps), and optionally add a marked dotclaude section to the global CLAUDE.md. Run when the user types /dotclaude:apply-settings-profile or asks to apply, update, or check the dotclaude settings.
disable-model-invocation: true
argument-hint: "[user|project|local]"
allowed-tools: Bash(bun *apply-settings.mjs*) Bash(bun *apply-claude-md.mjs*)
---

<task>
Apply the dotclaude settings profile to a settings file the user picks. A plugin cannot set permissions, environment variables, or model settings by itself; Claude Code only applies `agent` and `subagentStatusLine` from a plugin. This skill merges `profiles/recommended.json` into the chosen settings file, so the settings half of dotclaude stays under the user's control and is easy to review.
</task>

<procedure>
1. Pick the scope. Use `$ARGUMENTS` if it is `user`, `project`, or `local`. Otherwise ask with AskUserQuestion, offering: **User** (`~/.claude/settings.json`, applies everywhere; default), **Project** (`.claude/settings.json`, shared through git), **Local** (`.claude/settings.local.json`, this checkout only).

2. Preview. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope>
   ```

3. Show the user the listed changes, grouped as below, and ask whether to apply them.

   | Group | Keys | Why |
   |---|---|---|
   | Fast mode off | `env.CLAUDE_CODE_DISABLE_FAST_MODE=1`, `fastMode: false`, `fastModePerSessionOptIn: true`, `ultracode: false` | The env var removes the `/fast` toggle; the others keep a stray toggle from persisting and keep ultracode's xhigh orchestration off. |
   | Models | `model`, `availableModels`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL`, `env.ANTHROPIC_DEFAULT_SONNET_MODEL`, `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`, `Agent(model:claude-sonnet*)` deny | Keeps the session, subagents, and advisor on Opus 5.5, with Fable 5.1 available and Haiku 4.5 for web research and Claude Code's background tasks. Anything that asks for the `sonnet` alias runs on Opus 5.5. |
   | Subagent caps | `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=6`, `env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION=40` | Bounds fan-out, which is the largest driver of quota burn in long sessions; past about six parallel agents, rate limits make agents retry and burn context. |
   | Task list | `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | The task-list tools are off by default on Opus 5.5, and the dotclaude output style relies on them. |
   | Secrets | `permissions.deny` `Read(...)` rules for `.env`, `.env.local`, `.env.production`, `.env.*.local`, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json` | Keeps credentials out of the context window. |
   | Safety | `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false` | No bypass mode, no silent project MCP servers, and the word "ultracode" in a prompt does not launch a workflow. |
   | Git instructions | `includeGitInstructions: false` | Removes Claude Code's built-in commit and PR instructions; the dotclaude output style carries its own git section in their place. |

   The merge adds keys and rules and removes nothing, with one exception: the model policy is replaced rather than merged, because dotclaude owns it. `availableModels` becomes the profile's list, and `Agent(model:...)` deny rules the profile does not carry are removed. The preview names every removal.

   If the user wants to drop a group, copy the profile to a temporary file, remove those keys, and pass it with `--profile <file>`.

4. Apply, after the user agrees:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope> --apply
   ```

   The script backs up the existing file next to it before writing. If the permission system blocks the command, give the user the exact command to run themselves with the `!` prefix instead of retrying, since a block is the user's decision.

5. Offer the global CLAUDE.md section. It adds a short, marked block to `~/.claude/CLAUDE.md` naming the CLI tools found on this machine and how to treat dotclaude hook messages; everything else in the file stays as it is. Preview it, show it to the user, and apply it only if they agree:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs" --apply
   ```

   Re-running replaces the block in place, and `--remove --apply` takes it out again.

6. Tell the user to restart Claude Code, since `env`, model settings, and CLAUDE.md are read at startup.
</procedure>

<plugin_options>
The plugin's own options (the guards, the stop gate, `allowed_models`) live in `/config` under dotclaude. If the user changes `availableModels`, remind them to set the same list in the `allowed_models` option, so the hooks and the settings agree on which models are allowed.
</plugin_options>

<managed_settings>
User and project settings stay editable by the user. For a lock that holds even against the user's own `/fast`, the fast-mode keys go in a managed settings file, which needs admin rights and is outside what this skill writes. The paths are:

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux and WSL: `/etc/claude-code/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`

A minimal managed file is `{"fastMode": false, "availableModels": ["claude-opus-5-5", "claude-fable-5-1", "claude-haiku-4-5"]}`. Offer the path and the content, and let the user create the file, since writing it takes admin rights.
</managed_settings>
