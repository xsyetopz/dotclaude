---
type: regex
target: { source: file, path: package.json }
weight: 1
match: not_contains
pattern: '"(?:dependencies|devDependencies|optionalDependencies)"'
---
