---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

finance moved the accounts export, it's now data/warehouse/accounts_v2.csv (they renamed a bunch of columns and there's a region column now). point the retention report at the new file, add region to each row of the output, and regenerate out/retention.csv
