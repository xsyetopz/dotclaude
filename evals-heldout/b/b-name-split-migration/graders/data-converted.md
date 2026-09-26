---
type: regex
target: { source: file, path: data/users.json }
pattern: '^(?=[\s\S]*"firstName"\s*:\s*"Edsger")(?=[\s\S]*"lastName"\s*:\s*"Dijkstra")(?=[\s\S]*"firstName"\s*:\s*"Grace")(?=[\s\S]*"lastName"\s*:\s*"Thompson")'
weight: 2
---
