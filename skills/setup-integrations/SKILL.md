---
name: setup-integrations
description: Install, check, and configure dotclaude's optional integrations (CodeGraph code-graph MCP, tgrep indexed search, fast-compact tool-output trimming, the Betterleaks scanner behind secret redaction, and Ghidra for reverse engineering). Use when the user asks to set up, install, check, repair, or reconfigure CodeGraph, tgrep, fast-compact, Betterleaks, or Ghidra, or a dotclaude agent reports one missing.
argument-hint: "[status|codegraph|tgrep|fast-compact|betterleaks|ghidra] [what to change]"
context: fork
agent: integration-setup
allowed-tools: Bash(bun *status.mjs*)
---

<task>
Request: $ARGUMENTS

Complete the request for the integrations that it names. With no argument or `status`, report the status below and what is missing, and change nothing.
</task>

<status>
!`bun "${CLAUDE_SKILL_DIR}/scripts/status.mjs"`
</status>

<codegraph>
CodeGraph indexes the repository so `codegraph_explore` returns a symbol's source with its callers in one call.

- Install the CLI: `bun i -g @colbymchenry/codegraph`.
- Register the MCP server for Claude Code: `codegraph install --target=claude --location=global --yes`.
- Index the current project: `codegraph init` in the project root, which creates `.codegraph/`. Suggest adding `.codegraph/` to `.gitignore`.
- `codegraph install` also writes a CodeGraph section (between `<!-- CODEGRAPH_START -->` and `<!-- CODEGRAPH_END -->`) into `~/.claude/CLAUDE.md`. That section tells Claude to use `codegraph_explore` in indexed repositories. dotclaude adds no CodeGraph hook of its own. Check that the section is there after installing.
- `codegraph install` also adds a `codegraph prompt-hook` entry to the `hooks` in `~/.claude/settings.json`. It injects up to about 15 KB of CodeGraph output into every prompt, including background-task notifications and subagent hand-backs. That text stays in the context for the rest of the session. Tell the user to remove that `UserPromptSubmit` entry. Settings edits are the user's to make, so give them the steps.
</codegraph>

<tgrep>
tgrep is indexed text search with ripgrep's flags, faster than `rg` on large repositories. It complements CodeGraph. CodeGraph answers symbol questions (definitions, callers, call paths) for code it parses. tgrep finds any string anywhere, such as config values, error messages, docs, and generated files.

- Install: `brew install tgrep` where Homebrew exists, otherwise `cargo install --git https://github.com/microsoft/tgrep tgrep-cli --locked`.
- Index the current project: `tgrep index .` in the project root, which creates `.tgrep/`. `tgrep serve .` keeps the index fresh in the background. Mention it rather than starting it.
- Ignore the index everywhere. When the status shows `global_ignore.lists_tgrep: false`, append a `.tgrep/` line to the file it names. Create the file and its folder if they do not exist. That file is git's global excludes file, not a Claude Code setting.
- Search: `tgrep -- "<pattern>" .`, with ripgrep flags such as `-i`, `-F`, `-l`, and `--json`.
- dotclaude's global `CLAUDE.md` block names tgrep once it is on `PATH`. Tell the user to re-run `/dotclaude:apply-settings-profile` to refresh that block.
</tgrep>

<fast_compact>
fast-compact (NodarDavituri/fast-compact) adds `/fc`, which cuts old tool output to its start and end in about a second. It saves every cut to a file that Claude can read later. It also has Jev (TypeSafe's decision model) choose which old outputs stay whole. Claude Code's `/compact` stays unaffected.

Before installing, tell the user what dotclaude measured on their transcripts (`docs/dossier/evals.md`). `/fc` keeps more of what the session later needs than `/compact` (83% against 40%). But it leaves 72–91% of the context in place, so every later turn re-reads that much. It is relief for a mid-sized context, not a replacement for compaction. Jev's picks measured no better than keeping the newest outputs whole.

- Install the plugin: `claude plugin marketplace add NodarDavituri/fast-compact`, then `claude plugin install fast-compact@fast-compact`.
- It needs two settings that the user adds to `~/.claude/settings.json`, because settings edits are theirs to make. Give them the exact JSON:
  - `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1"`, an early-access Claude Code feature the plugin's hooks run on.
  - A Jev key. When the status lists `TYPESAFE_API_KEY` among `keys`, have them set `pluginConfigs["fast-compact@fast-compact"].options.provider` to `"typesafe"`. The plugin defaults to OpenRouter (`OPENROUTER_API_KEY`). Never read or print the key.
- Model: the plugin sends `jev-latest`, which TypeSafe accepts. Its bench script defaults to `jev-1.13`, which TypeSafe rejects. When you run the bench against TypeSafe, pass `JEV_BASE_URL=https://api.typesafe.ai/v1/systemone JEV_MODEL=jev-latest`.
- After a restart or `/reload-plugins`, `/fc` should report the model and a cost line. If it reports that it found no key, the key or provider setting is missing.
</fast_compact>

<betterleaks>
dotclaude's secret redaction (the `secret_redaction` option, on by default) runs Betterleaks on every tool output. It replaces each secret that Betterleaks finds with `[REDACTED:<rule>]` before Claude sees it. Without `betterleaks` on `PATH`, tool output goes to Claude without redaction, and session start says so.

- Install: `brew install betterleaks`, `go install github.com/betterleaks/betterleaks@latest`, or a release binary from <https://github.com/betterleaks/betterleaks/releases>.
- It needs no configuration. `BETTERLEAKS_CONFIG` or `GITLEAKS_CONFIG` in the environment changes the rules. A repository's own `.betterleaks.toml` or `.gitleaks.toml` and `betterleaks:allow` or `gitleaks:allow` comments do not disable redaction. Redaction never sends a secret to a live API for validation.
- gitleaks is not part of dotclaude. The user can keep gitleaks for pre-commit hooks. Do not remove it.
</betterleaks>

<ghidra>
Ghidra decompiles and analyzes binaries for reverse engineering. dotclaude uses it in two parts. The MCP server `pyghidra-mcp` comes first. The `ghidra-bridge` CLI is the fallback when the MCP server is missing or a call fails. The `dotclaude:reverse-engineer` agent follows that order.

- Requirements, from the status: Ghidra with `support/analyzeHeadless` under `GHIDRA_INSTALL_DIR`, Java 21 or newer, `uvx` from uv, and Python 3.10 or newer. Installing Ghidra and a Java 21 JDK is the user's step. Give them <https://github.com/NationalSecurityAgency/ghidra/releases>, and tell them to set `GHIDRA_INSTALL_DIR` in their shell profile.
- MCP server: register it only in the reverse-engineering project that the user names, with `claude mcp add --scope project ghidra -- uvx pyghidra-mcp --project-path <absolute path of that project>`. Run the command in that project. Do not register it at user scope or in a plugin `.mcp.json`, because every session would then start Ghidra's Java process.
- CLI fallback: `uv tool install ghidra-ai-bridge`, which installs `ghidra-bridge`. Read `ghidra-bridge --help` for its commands.
- After a restart, `/mcp` in that project lists `ghidra`, and the status shows `mcp: "project"`.
</ghidra>
