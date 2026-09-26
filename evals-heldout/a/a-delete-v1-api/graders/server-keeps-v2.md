---
type: regex
target: { source: file, path: server.js }
pattern: 'require\(\s*[''"]\./routes/v2[''"]\s*\)[\s\S]*v2\.handle\('
---
