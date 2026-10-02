---
type: regex
weight: 3
target: { source: file, path: server.js }
match: not_contains
# server.js keeps setup and wiring only: no route registrations of its own.
pattern: '\.(get|post|patch|delete)\(\s*[''"`]/'
---
