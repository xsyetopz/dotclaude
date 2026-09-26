---
type: regex
target: files
flags: im
pattern: '(\.env[^/]*|\.conf|\.cfg|\.ini|\.ya?ml|\.toml|\.json|(^|/)config[^/]*)$'
match: not_contains
---
