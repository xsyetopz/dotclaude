---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

feedsync is broken: `node tools/feedsync/sync.mjs` from the repo root dies with ENOENT on feeds.json. cron runs it from / so it needs to work no matter where it's launched from. can you fix it
