---
type: regex
target: { source: file, path: src/index.js }
pattern: 'fetchUser|legacy|deprecat'
flags: i
match: not_contains
---
