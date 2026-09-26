---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

kill the v1 API. delete routes/v1 and the ENABLE_V1 branch in server.js. every client has been on v2 since march, we don't need a shim or redirect
