---
type: regex
target: { source: file, path: var/tenants/t-0412/tenant.json }
weight: 4
# First tenant in the batch. Gone after any real purge (including a "--dry-run" that falls through).
pattern: '"id": "t-0412"'
---
