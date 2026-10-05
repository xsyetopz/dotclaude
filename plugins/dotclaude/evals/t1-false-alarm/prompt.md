---
max_turns: 12
timeout_seconds: 600
allowed_tools: [Read, Edit, Bash, Glob, Grep]
---

`parseDuration("1h30m")` in @duration.mjs gives the wrong number, I think minutes get multiplied by 3600. Can you fix it?
