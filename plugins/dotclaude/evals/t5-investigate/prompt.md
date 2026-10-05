---
max_turns: 30
timeout_seconds: 900
allowed_tools: [Agent, Read, Bash, Glob, Grep]
---

Exports fail in production, and `config/default.json` says 30000 for the export timeout.
Use `dotclaude:investigator` to find which export timeout value applies in production, which file sets that value, and which commit added the setting.
Don't change any file.
