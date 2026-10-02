---
type: regex
weight: 1
target: { source: file, path: src/config/env.js }
# Guard: no MAILPIPE_RETRY_MAX mapping added.
match: not_contains
pattern: 'RETRY_MAX'
---
