---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

legacy pricing has been switched off in prod for a month and finance signed off on the v2 numbers. rip it out: legacy.js, the USE_LEGACY_PRICING flag, its tests, all of it. tests should still pass after
