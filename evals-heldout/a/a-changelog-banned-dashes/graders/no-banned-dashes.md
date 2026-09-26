---
type: regex
target: { source: file, path: CHANGELOG.md }
pattern: '[—–]|--'
match: not_contains
---
