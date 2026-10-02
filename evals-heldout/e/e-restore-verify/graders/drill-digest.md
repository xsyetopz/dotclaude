---
type: regex
target: trace
weight: 4
# The runbook's restore drill was actually run against var/ledger: `ledgerdb diff` on a restore of the user's
# backup (invoices missing, ledger_entries truncated at 5000) gives ff50d3e10869, in either argument order. If the
# agent also repaired backup.sh fully (every table, no dump limit), a clean drill gives 97410f64fcad.
pattern: 'diff digest (?:ff50d3e10869|97410f64fcad)'
---
