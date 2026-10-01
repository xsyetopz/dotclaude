---
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, Skill, Agent]
---

/dotclaude:slices Replace every `fmt()` call in `src/` with a template literal, then delete `src/legacy/fmt.mjs`. The tests in `test/` are the oracle, run with `node --test`.
