---
# No leftover fullName, no {version, data} envelope, no per-row schema version.
type: regex
target: { source: file, path: data/users.json }
pattern: 'fullName|version'
flags: i
match: not_contains
---
