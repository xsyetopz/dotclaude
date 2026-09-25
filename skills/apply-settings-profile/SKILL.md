---
name: apply-settings-profile
description: Preview and apply the dotclaude settings profile to a Claude Code settings file (fast mode off, Opus 5.5 and Fable 5.1 only, built-in git instructions replaced, secret-file read denies, subagent caps), and optionally add a marked dotclaude section to the global CLAUDE.md. Run when the user types /dotclaude:apply-settings-profile or asks to apply, update, or check the dotclaude settings.
disable-model-invocation: true
argument-hint: "[user|project|local]"
allowed-tools: Bash(bun *apply-settings.mjs*) Bash(bun *apply-claude-md.mjs*)
---

# Apply the dotclaude settings profile

A plugin cannot set permissions, environment variables, or model settings by itself; Claude Code only applies `agent` and `subagentStatusLine` from a plugin. This skill merges `profiles/recommended.json` into a settings file the user picks, so the settings half of dotclaude is under the user's control and easy to review.

## Steps

1. Pick the scope. Use `$ARGUMENTS` if it is `user`, `project`, or `local`. Otherwise ask with AskUserQuestion, offering: **User** (`~/.claude/settings.json`, applies everywhere; default), **Project** (`.claude/settings.json`, shared through git), **Local** (`.claude/settings.local.json`, this checkout only).

2. Preview. This writes nothing:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope>
   ```

3. Show the user the listed changes, grouped as below, and ask whether to apply them. The merge only adds: it never removes an existing key, permission rule, or env var.

   | Group | Keys | Why |
   |---|---|---|
   | Fast mode off | `env.CLAUDE_CODE_DISABLE_FAST_MODE`, `fastMode`, `fastModePerSessionOptIn` | The env var removes the `/fast` toggle; the other two keep a stray toggle from persisting. |
   | Models | `model`, `availableModels`, `advisorModel`, `env.CLAUDE_CODE_SUBAGENT_MODEL`, `Agent(model:sonnet*/haiku*)` denies | Keeps the session, subagents, and advisor on Opus 5.5, with Fable 5.1 available. |
   | Subagent caps | `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4`, `env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION=40` | Bounds fan-out, which is the largest driver of quota burn in long sessions. |
   | Secrets | `permissions.deny` `Read(...)` rules for `.env`, `~/.ssh`, `~/.aws/credentials`, `~/.gnupg`, `~/.netrc`, `~/.docker/config.json` | Keeps credentials out of the context window. |
   | Safety | `permissions.disableBypassPermissionsMode`, `enableAllProjectMcpServers: false`, `workflowKeywordTriggerEnabled: false` | No bypass mode, no silent project MCP servers, and the word "ultracode" in a prompt does not launch a workflow. |
   | Git instructions | `includeGitInstructions: false` | Removes Claude Code's built-in commit and PR instructions; the dotclaude output style carries its own git section in their place. |

   If the user wants to drop a group, copy the profile to a temporary file, remove those keys, and pass it with `--profile <file>`.

4. Apply, after the user agrees:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-settings.mjs" --scope <scope> --apply
   ```

   The script backs up the existing file next to it before writing. If the permission system blocks the command, give the user the exact command to run themselves with the `!` prefix instead of retrying.

5. Offer the global CLAUDE.md section. It adds a short, marked block to `~/.claude/CLAUDE.md` naming the CLI tools found on this machine and how to treat dotclaude hook messages; everything else in the file stays as it is. Preview it, show it to the user, and apply it only if they agree:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs"
   bun "${CLAUDE_SKILL_DIR}/scripts/apply-claude-md.mjs" --apply
   ```

   Re-running replaces the block in place, and `--remove --apply` takes it out again.

6. Tell the user to restart Claude Code, since `env`, model settings, and CLAUDE.md are read at startup.

## Keeping the dotclaude options in step

The plugin's own options (the guards, the stop gate, `allowed_models`) live in `/config` under dotclaude. If the user changes `availableModels`, remind them to set the same list in the `allowed_models` option so the hooks and the settings agree.

## A lock the user cannot undo by accident

User and project settings stay editable by the user. For a lock that holds even against the user's own `/fast`, the fast-mode keys go in a managed settings file, which needs admin rights and is outside what this skill writes. The paths are:

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux and WSL: `/etc/claude-code/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`

A minimal managed file is `{"fastMode": false, "availableModels": ["claude-opus-5-5", "claude-fable-5-1"]}`. Offer the path and the content; let the user create it.
