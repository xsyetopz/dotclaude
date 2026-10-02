---
type: regex
weight: 1
target: { source: file, path: CHANGELOG.md }
# At least one bullet between "## Unreleased" and the 0.4.0 heading.
pattern: '## Unreleased\s*\n(?:[^#\n]*\n)*?\s*[-*] \S[\s\S]*## 0\.4\.0'
---
