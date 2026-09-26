---
name: c-commit-just-the-fix
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

paginate() drops the last page when the item count isn't a multiple of the page size (45 items at size 20 should be 3 pages, we return 2). fix it and commit just that fix
