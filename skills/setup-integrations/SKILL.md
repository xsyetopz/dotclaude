---
name: setup-integrations
description: Check, install, and configure dotclaude's optional integrations (CodeGraph code-graph MCP, Headroom context compression, and the OpenAI Codex CLI with dotclaude's worker and review profiles), or change their configuration on request. Use when the user asks to set up, install, check, repair, or reconfigure CodeGraph, Headroom, or Codex, or when a dotclaude agent reports one of them missing.
argument-hint: "[status|codegraph|headroom|codex] [what to change]"
context: fork
agent: integration-setup
allowed-tools: Bash(bun *status.mjs*)
---

<task>
Request: $ARGUMENTS

Carry out the request for the integrations it names; with no argument, or `status`, report the status below and what is missing, and change nothing.
</task>

<status>
!`bun "${CLAUDE_SKILL_DIR}/scripts/status.mjs"`
</status>

<codegraph>
CodeGraph indexes the repository so `codegraph_explore` returns a symbol's source with its callers in one call.

- Install the CLI: `bun i -g @colbymchenry/codegraph`.
- Register the MCP server for Claude Code: `codegraph install --target=claude --location=global --yes`.
- Index the current project: `codegraph init` in the project root, which creates `.codegraph/`. Suggest adding `.codegraph/` to `.gitignore`.
- `codegraph install` also adds a `codegraph prompt-hook` entry to the `hooks` in `~/.claude/settings.json`, which injects CodeGraph search results into every prompt, including background-task notifications and subagent hand-backs. dotclaude replaces it with a lighter hook that runs only on prompts the user types and lists the indexed symbols the prompt names (file and line, no source), so tell the user to remove that hook entry to avoid both running. Settings edits are the user's to make; give them the steps.
</codegraph>

<headroom>
Headroom compresses large tool output and keeps the originals retrievable through its MCP tools.

- Install the CLI: `uv tool install --python 3.13 "headroom-ai[all]"`.
- Register the MCP server for Claude Code: `headroom mcp install --agent claude`. Its tools appear as `mcp__headroom__headroom_retrieve`, `mcp__headroom__headroom_compress`, and `mcp__headroom__headroom_stats`.
- The proxy mode (`headroom wrap claude`) routes all Claude Code traffic through a local proxy by setting `ANTHROPIC_BASE_URL`. Set it up only when the request explicitly asks for the proxy; otherwise mention it as an option, since it changes how every session reaches the API.
</headroom>

<codex>
dotclaude runs Codex as bounded GPT-6 Luna workers and a read-only reviewer, through profile files that inherit `$CODEX_HOME/config.toml`.

- Install the CLI: `bun i -g @openai/codex`. Logging in opens a browser, so the user runs `! codex login` themselves.
- Preview, then install, the profiles and base defaults:

  ```bash
  bun "${CLAUDE_SKILL_DIR}/scripts/configure-codex.mjs"
  bun "${CLAUDE_SKILL_DIR}/scripts/configure-codex.mjs" --apply
  ```

  This writes `dotclaude-luna.config.toml` (the worker: Luna at high effort, workspace-write sandbox, no approvals, no subagents, goals, apps, browser, or skills catalog) and `dotclaude-review.config.toml` (read-only reviewer: Astra on Pro plans, Sol on Plus), and sets `service_tier = "default"` and `[features] fast_mode = false` in `config.toml`, keeping every other key. It reads the ChatGPT plan from the Codex login; `--plan plus|prolite|pro` overrides it.
- The same run builds three model catalogs from `$CODEX_HOME/models_cache.json` (`scripts/build-codex-catalog.mjs`): `dotclaude-catalog-interactive.json`, `-worker.json`, and `-review.json`. Each copies every cached model and replaces the GPT-6 base instructions with dotclaude's text (`codex/templates/base-<audience>.md` plus a per-model note), with persistent-mode and multi-agent role text emptied. `model_catalog_json` points `config.toml` at the interactive catalog and each profile at its own; the profiles also set `include_collaboration_mode_instructions = false` and `include_apps_instructions = false`.
- A catalog replaces Codex's model list, and while a config has a `model_catalog_json` line Codex stops fetching models. Setup therefore fetches the current list itself, by running `codex debug models` under a temporary `CODEX_HOME` that holds only a link to the user's login, and falls back to `models_cache.json` when that fails. Models OpenAI adds or changes later appear after the next run of setup. When setup warns that it could not fetch the list, have the user run `! codex login`, then re-run setup. `codex review` uses Codex's built-in review prompt, so there the reviewer's `developer_instructions` carries dotclaude's review stance; the review catalog applies to `codex exec -p dotclaude-review "<prompt>"`.
- To go back to Codex's own instructions, remove the `model_catalog_json` line from `config.toml` or the profile.
- Check that both profiles load: `command codex -p dotclaude-luna debug prompt-input ok >/dev/null && command codex -p dotclaude-review debug prompt-input ok >/dev/null && echo ok`.
- To change a setting the user asks for (for example a different reasoning effort for workers), check the key name with `command codex --help` or the installed profile, change that one line in the installed profile file with `sd`, and re-run the load check. Tell the user that re-running this setup restores dotclaude's defaults (the script keeps a backup of the file it replaces).
</codex>
