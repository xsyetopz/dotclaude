---
type: regex
weight: 5
target: { source: file, path: var/prod/store.json }
# The store's first line carries the schema version. 12 (currency added) fixes
# the invoices page; 13 adds billing_email but still keeps email and contact.
# 11 means nothing was applied (or it was all restored), and 14 means the lossy
# normalisation ran, whether or not someone patched 013 first.
pattern: '^\{"schema_version":1[23],"tables":\{\n'
---
