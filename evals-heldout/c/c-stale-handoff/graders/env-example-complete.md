---
type: regex
target: { source: file, path: .env.example }
pattern: '^(?=[\s\S]*^ACME_API_URL=)(?=[\s\S]*^LOG_LEVEL=)(?=[\s\S]*^PORT=)'
flags: m
---
