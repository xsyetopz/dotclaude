# Integrations

Each integration is a CLI or an official plugin.
dotclaude keeps no MCP server for them, because an MCP server adds tool definitions and instructions to each turn.

## CodeGraph

CodeGraph indexes the repository so `codegraph explore` returns a symbol's source with its callers in one call.
dotclaude uses the CodeGraph CLI through Bash and does not keep its MCP server or its prompt hook.
The MCP server sends fixed instructions to the main conversation that say a lookup in a subagent repeats work.
No CodeGraph or Claude Code setting turns these instructions off.
The `prompt-hook` adds up to about 15 KB of CodeGraph output to every prompt, and that text stays in the context.

Claude seldom runs `codegraph` when a rule only tells it to.
Thus the dotclaude hooks module adds the graph to the searches that Claude already runs.
When a `Grep` call or a Bash `rg` or `grep` searches for one symbol name, the result gets the callers and callees of that symbol.
Each symbol gets this once in each context.
Without the MCP server, the index does not update itself.
Thus, before each lookup, the hook runs `codegraph status`, and it runs `codegraph sync` when files changed since the last index.
A sync of 12 changed files takes about 0.6 seconds.
If a sync fails or takes more than 10 seconds, the result says once that the index is stale, and the session does not try the sync again.
The hook does nothing in a project without `.codegraph/`, and it never builds an index.
The plugin option `codegraph` turns it off.

- Install the CLI: `bun i -g @colbymchenry/codegraph`.
- Write the `CLAUDE.md` section: `codegraph install --target=claude --location=global --yes`.
  The install has no flag that skips the MCP entry.
- Remove the MCP entry that the install added: `claude mcp remove codegraph -s user`.
  `codegraph upgrade` runs `codegraph install --refresh`, which can add the entry again.
- Remove the `prompt-hook` entry from `~/.claude/settings.json`.
  `scripts/settings.mjs --apply` does this.
- Index the current project with `codegraph init` in the project root, which creates `.codegraph/`.
  Suggest adding `.codegraph/` to `.gitignore`.

## LSP

The built-in `LSP` tool gives definitions, references, and diagnostics.
It stays off until an official code intelligence plugin is enabled, and each plugin needs its language server on `PATH`.
`scripts/settings.mjs` reads the plugins and their language servers from the `claude-plugins-official` marketplace manifest.
It lists each plugin whose language server is on `PATH` but that is not enabled in the user settings.
For a plugin that is not installed, it gives `/plugin install <plugin>@claude-plugins-official`.
For a plugin that is installed but disabled, it gives `/plugin enable <plugin>@claude-plugins-official`.
A plugin that declares its servers only in its own repository, such as `liquid-lsp`, is not in the list.

## context7

The `ctx7` CLI gives current library documentation in one call, with no MCP server.
The `web-researcher` agent uses it when `ctx7` is on `PATH`, and uses `WebSearch` and `WebFetch` only when `ctx7` is rate-limited or has no match.
In the Upstash benchmark of 100 queries through the Claude Code Agent SDK, `ctx7` used 98.98% fewer input tokens and 34.56% less cost than `WebSearch` and `WebFetch` ([benchmark](https://upstash.com/blog/context7-vs-web-search-benchmark)).
Context7 gives version-matched snippets from the official docs, while a web search returns whole pages and blog posts ([comparison](https://upstash.com/blog/c7-vs-web-search)).

- Install the CLI: `bun i -g ctx7`.
- Find the library ID: `ctx7 library <name> "<question>"`.
- Get the documentation: `ctx7 docs </org/library> "<question>"`.
- Do not run `ctx7 setup --mcp`, because it adds the MCP server.

### API Key

Without a key, Context7 gives a low rate limit: 200 calls a month on 2026-10-05.
A key from the [Context7 dashboard](https://context7.com/dashboard) gives the limit of its plan.
`ctx7` reads the key from `CONTEXT7_API_KEY` before its `ctx7 login` token.
Use the environment variable, because the rate-limit check below can read it.

The user adds the key in a terminal outside Claude Code, so the key never goes into the conversation.
For zsh, the command is below.
For bash, use `~/.bashrc`.

```bash
printf 'Context7 API key: '; read -rs k; echo; echo "export CONTEXT7_API_KEY=$k" >> ~/.zshrc; unset k
```

### Rate-Limit Check

This command prints the status, the quota tier, the remaining calls, and the reset time as a Unix timestamp.
It spends one call.
`HTTP/2 401` shows that Context7 did not accept the key.
`context7-quota-tier: anonymous` with `HTTP/2 200` does not show that the key is not valid, because a valid key can also get the anonymous tier.
To find if Context7 counts the calls on the key, look at the usage of the key in the Context7 dashboard.
`RateLimit-Remaining: 0` or `HTTP/2 429` shows that `ctx7` is rate-limited until `RateLimit-Reset`.

```bash
curl -s -o /dev/null -D - ${CONTEXT7_API_KEY:+-H "Authorization: Bearer $CONTEXT7_API_KEY"} "https://context7.com/api/v2/libs/search?libraryName=react" | grep -i -E '^HTTP|^ratelimit-(remaining|reset)|^retry-after|^context7-quota-tier'
```
