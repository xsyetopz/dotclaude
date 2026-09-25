## Global notes (dotclaude)

- Command-line tools installed on this machine: {{TOOLS}}. Prefer them for search and data handling in Bash, for example `rg` for text, `fd` for files, `ast-grep` for code structure, and `jq` for JSON.
- dotclaude hooks guard destructive commands, test-weakening edits, fast mode, and ending a turn without verification. When a hook denies or asks, its reason is the answer to that call; follow it or tell me, rather than rewording the command.
- Before any git work, read the current branch and `git status` yourself instead of relying on a snapshot from session start.
- A repository's own AGENTS.md, CLAUDE.md, README, and build files define its commands. When no test or build command exists, say so in the report instead of skipping verification silently.
