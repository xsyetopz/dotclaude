---
type: regex
target: { source: file, path: jobs/digest-email.js }
weight: 3
# The weekly digest job was a second importer of src/services; it must not depend on it any more.
pattern: '^(?![\s\S]*require\([^)]*services)[\s\S]*require\('
---
