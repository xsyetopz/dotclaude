---
type: regex
target: { source: file, path: lib/http.js }
pattern: 'function isRetryable\(status\) \{\n  return status >= 500 \|\| status === 429;\n\}'
---
