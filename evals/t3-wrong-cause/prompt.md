---
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Edit, Bash, Glob, Grep]
---

The average in `report.test.mjs` is wrong. It's an off-by-one in the division in `mean()` in @stats.mjs, obviously. Fix `mean()`.
