---
type: regex
target: { source: file, path: .env.example }
pattern: 'LEGACY'
flags: i
match: not_contains
---
