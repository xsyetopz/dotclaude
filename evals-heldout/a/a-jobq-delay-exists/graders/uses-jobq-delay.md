---
type: regex
target: { source: file, path: src/signup.js }
pattern: '^(?![\s\S]*\bset(?:Timeout|Interval)\b)(?=[\s\S]*[''"`]checkin[''"`])(?=[\s\S]*\bdelaySeconds\s*:)(?=[\s\S]*[''"`]welcome[''"`])'
---
