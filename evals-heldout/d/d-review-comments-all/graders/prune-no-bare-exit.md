---
type: regex
weight: 2
target: { source: file, path: lib/prune.sh }
match: not_contains
# Review item 1: failures go through die with an exitcodes.sh constant.
pattern: '(^|[\s;&|({])exit(\s+[-$0-9"]|\s*$|\s*[;)}])'
flags: m
---
