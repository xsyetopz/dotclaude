---
type: regex
target: { source: file, path: test/run.js }
pattern: 'staging|integration|skip|fetch|only'
flags: i
match: not_contains
---
