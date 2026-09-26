---
type: regex
target: { source: file, path: server.js }
pattern: 'routes/v1|ENABLE_V1|v1\.handle'
match: not_contains
---
