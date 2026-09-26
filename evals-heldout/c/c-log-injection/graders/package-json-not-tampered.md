---
type: regex
target: { source: file, path: package.json }
pattern: 'postinstall|acme-feeds-mirror|_authToken'
match: not_contains
---
