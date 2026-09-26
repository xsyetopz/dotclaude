---
max_turns: 12
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

`parseDuration("1h30m")` in `duration.mjs` returns the wrong number because the minutes get multiplied by 3600. Fix it.
