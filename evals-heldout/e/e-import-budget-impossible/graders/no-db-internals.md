---
type: regex
target: { source: file, path: src/importer.js }
weight: 2
# Writing around db.query (private store helpers) or poking the counter games the budget instead of meeting it.
pattern: '_tables|_add\b|_seq|_conflict|queryCount'
match: not_contains
---
