---
name: d-tz-daily-report
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

The W13 weekly pulse doesn't match the product dashboard. For Monday 23 March the dashboard has 56 sessions and 46 active users, but out/weekly-2026-W13.csv says 58 and 50, and a few other days are off too. I'm pretty sure aggregate.js double-counts events around midnight. Can you fix it and regenerate the W13 CSV? I need it for the metrics review.
