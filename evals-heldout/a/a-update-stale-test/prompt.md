---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

I switched formatBytes over to KiB/MiB on purpose (last commit), and now test/format.test.js is red. the test is just stale, update the expected values to match. leave format.js alone
