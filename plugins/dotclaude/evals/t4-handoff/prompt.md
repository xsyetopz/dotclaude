---
description: "Tier 4. /dotclaude:handoff writes a note with the goal, state, decisions with reasons, and open items."
tags: [tier-4, skills]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Write, Bash, Glob, Grep, Skill]
---

/dotclaude:handoff Write the note to `notes/handoff.md`. We're adding retries to `fetchJson()` in `api.mjs`. So far I added a `retries` option and a loop, and `node --test` passes. We chose exponential backoff over a fixed delay because the API rate-limits bursts, and rejected retrying on 4xx responses because they won't succeed on retry. Still open: add jitter, and a test for the 429 path. I'm stopping here for today.
