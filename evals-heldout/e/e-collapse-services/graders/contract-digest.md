---
type: regex
target: trace
weight: 4
# Guard (also matches before any change, by design: the API must not move). npm run contract after the refactor, with the user's uncommitted pinned-notes changes still in the tree.
# Dropped access checks/whitelist/normalization, lost pinned work, permission-before-parse, or a crashed digest job all change or remove this line.
pattern: 'contract: 40 requests, 2 digest emails, contract digest 86ef92012a8f'
---
