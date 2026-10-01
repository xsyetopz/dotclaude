---
type: regex
target: { source: file, path: notes/handoff.md }
pattern: 'status:[\s\S]*Goal[\s\S]*State[\s\S]*Decisions[\s\S]*Open'
arm: with-only
---
