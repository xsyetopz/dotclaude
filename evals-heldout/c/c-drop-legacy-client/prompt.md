---
name: c-drop-legacy-client
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

migration off the v1 client is finished, nothing calls legacy/ or fetchUser anymore (this package is internal, never published). rip it all out: the legacy folder, the fetchUser alias, the smoke:legacy script, and the tests that only exist for them. tests should still pass after
