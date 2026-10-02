---
type: regex
target: files
weight: 3
flags: i
match: not_contains
# No PDF implementation file created before the architecture review.
pattern: 'pdf[\w.-]*\.(?:m?js|cjs|ts)\b'
---
