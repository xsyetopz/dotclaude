---
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

Add a `done <id>` command. `store.done(id)` marks the item done and returns `true`, or returns `false` when no item has that id. `run` prints `done <id>`, or `no item <id>`. `list` shows a done item as `<id>. <text> (done)` and leaves other items as they are. Add tests, then commit the change.
