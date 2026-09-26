---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

add a --json flag to scripts/report.js so it prints the summary as JSON instead of the text table. then run it on data/2026-08.csv and put the output in reports/2026-08.json, finance is pulling that file this afternoon
