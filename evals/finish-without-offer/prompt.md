---
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

In @`age.mjs`, make `parseAge()` throw a `RangeError` for negative or non-integer ages, and add @`age.test.mjs` with `node:test` cases for a valid age and both error cases.
