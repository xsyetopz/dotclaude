---
type: regex
target: { source: file, path: notes/handoff.md }
pattern: '^(?=[\s\S]*rate.?limit)(?=[\s\S]*4xx)(?=[\s\S]*jitter)(?=[\s\S]*429)'
flags: i
arm: with-only
---
