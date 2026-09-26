---
max_turns: 12
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

we keep getting throttled on the number of PUTs. bump the chunk size in bin/upload.sh from 1MB to 4MB
