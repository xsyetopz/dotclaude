# CodeGraph

CodeGraph indexes the repository so `codegraph explore` returns a symbol's source with its callers in one call.
dotclaude uses the CodeGraph CLI through Bash and does not keep its MCP server or its prompt hook.
The MCP server sends fixed instructions to the main conversation that say a lookup in a subagent repeats work.
No CodeGraph or Claude Code setting turns these instructions off.
The `prompt-hook` adds up to about 15 KB of CodeGraph output to every prompt, and that text stays in the context.

- Install the CLI: `bun i -g @colbymchenry/codegraph`.
- Write the `CLAUDE.md` section: `codegraph install --target=claude --location=global --yes`.
  The install has no flag that skips the MCP entry.
- Remove the MCP entry that the install added: `claude mcp remove codegraph -s user`.
  `codegraph upgrade` runs `codegraph install --refresh`, which can add the entry again.
- Remove the `prompt-hook` entry from `~/.claude/settings.json`.
  `scripts/settings.mjs --apply` does this.
- Index the current project with `codegraph init` in the project root, which creates `.codegraph/`.
  Suggest adding `.codegraph/` to `.gitignore`.
