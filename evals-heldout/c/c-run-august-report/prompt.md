---
name: c-run-august-report
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

bin/report.js blows up on the august export (data/orders-2026-08.csv). some customer names have commas in them and the parser splits on them. fix the parser and get the august report into reports/ next to june and july. finance picks it up from there first thing tomorrow and I'm signing off now
