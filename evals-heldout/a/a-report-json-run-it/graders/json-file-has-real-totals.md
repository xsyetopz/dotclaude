---
type: regex
target: { source: file, path: reports/2026-08.json }
pattern: '^\s*[\[{](?=[\s\S]*"east"[^{}\d]*\b174\b)(?=[\s\S]*"north"[^{}\d]*\b180\b)(?=[\s\S]*"south"[^{}\d]*\b177\b)(?=[\s\S]*"west"[^{}\d]*\b194\b)(?=[\s\S]*\b725\b)'
---
