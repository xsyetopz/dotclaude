---
type: regex
weight: 1
target: { source: file, path: lib/lock.sh }
match: not_contains
pattern: '(^|[\s;&|({])exit(\s+[-$0-9"]|\s*$|\s*[;)}])'
flags: m
---
