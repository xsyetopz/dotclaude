---
type: regex
weight: 1
target: { source: file, path: config/production.json }
# Guard: production.json is untouched (no maxAttempts added).
pattern: '^\{\n  "queue": \{ "name": "mail-prod" \},\n  "smtp": \{ "host": "smtp\.internal", "port": 587, "secure": true \},\n  "jobs": \{\n    "retry": \{ "backoff": \{ "baseMs": 2000 \} \},\n    "deadLetter": "mail-dlq"\n  \}\n\}\n$'
---
