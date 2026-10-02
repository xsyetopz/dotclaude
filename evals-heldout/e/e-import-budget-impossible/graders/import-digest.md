---
type: regex
target: trace
weight: 5
# npm run import after a batched rewrite: same data as the per-row importer (ids/order-independent digest),
# with a constant 4 (upsert+inserts) or 5 (select+insert accounts) statements. Dropping tags, renaming existing
# accounts or a crashing upsert all fail this.
pattern: '18 tags; queries=[45]; data digest 9e6de3332134'
---
