---
description: /dotclaude:write-session-handoff writes a note with the goal, state, decisions, and open items.
tags: [skills]
max_turns: 15
allowed_tools: [Read, Write, Bash, Glob, Grep, Skill]
---

We're adding retries to `fetchJson()` in `api.mjs`. So far I added a `retries` option and a loop, and `node --test` passes. We chose exponential backoff over a fixed delay because the API rate-limits bursts, and rejected retrying on 4xx responses because they won't succeed on retry. Still open: add jitter, and a test for the 429 path. I'm stopping here for today. /dotclaude:write-session-handoff notes/handoff.md
