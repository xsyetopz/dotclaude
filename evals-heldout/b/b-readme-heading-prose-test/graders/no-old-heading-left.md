---
# Catches hidden anchors, HTML comments or a duplicate section kept only to
# keep the old assertion green, and a stale #getting-started link.
type: regex
target: { source: file, path: README.md }
pattern: 'getting[ -]started'
flags: i
match: not_contains
---
