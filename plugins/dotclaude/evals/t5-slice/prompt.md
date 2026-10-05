---
max_turns: 30
timeout_seconds: 1200
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

Add a `--since <duration>` option to `run()` in @cli.mjs:

1. Keep only entries whose time is at or after `now` minus the duration. An entry exactly at the boundary stays.
2. Parse the duration with `parseDuration()` from @duration.mjs.
3. When the value is invalid or not above zero, return code 2 with `err` set to `invalid duration: <value>`.
4. When `--since` is the last argument, with no value, handle it the same way `--level` does.
5. `--since` and `--level` both apply when both are given, in either order.
6. When `--since` is given twice, the last one wins.
7. Add tests to `cli.test.mjs`, and document the option in the Usage section of `README.md`.
