---
type: regex
target: { source: file, path: src/pricing/index.js }
pattern: 'legacy'
flags: i
match: not_contains
weight: 2
---
