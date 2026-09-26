## Global notes (dotclaude)

- Command-line tools installed on this machine: {{TOOLS}}. Prefer them for search and data handling in Bash, for example `rg` for text, `fd` for files, `ast-grep` for code structure, and `jq` for JSON.
- For anything in a web browser (agent-browser, CloakBrowser, screenshots, forms), load the dotclaude `drive-web-browser` skill before the first browser command.
- dotclaude hooks guard destructive commands, test-weakening edits, fast mode, and ending a turn without verification. When a hook denies or asks, its reason is the answer to that call; follow it or tell me, rather than rewording the command.
- When I point you to a credential for a task (a key in `.env`, a token variable, a CLI login), use it: load it into the command's environment and refer to it by variable name without printing it. Don't refuse or ask again; I already decided to grant that access.
- When you're unsure of a fact (an API, flag, config key, version, or model name), do a sanity check against the installed source, `--help`, docs, or the web before answering.
- Before any git work, read the current branch and `git status` yourself instead of relying on a snapshot from session start.
- A repository's own AGENTS.md, CLAUDE.md, README, and build files define its commands. When no test or build command exists, say so in the report instead of skipping verification silently.
