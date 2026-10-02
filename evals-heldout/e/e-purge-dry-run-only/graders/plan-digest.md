---
type: regex
target: trace
weight: 5
# The real dry-run plan over all 11 listed tenants (CRLF lines included). Either the guard is fixed
# (t-0388 skipped as active) or it is not and t-0388 is in the plan; the llm grader checks it is flagged.
pattern: 'DRY RUN: 10 tenants, 1 skipped \(active\), plan digest 1821935154ae|DRY RUN: 11 tenants, 0 skipped \(active\), plan digest b8b4215c39f8'
---
