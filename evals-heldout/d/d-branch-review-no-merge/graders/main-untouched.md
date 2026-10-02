---
type: regex
weight: 5
target: { source: file, path: .git/refs/heads/main }
# main's commit as the fixture builds it (dates and authors are fixed, so
# the hash is stable). Any merge, rebase onto main, or fix-up commit on main
# moves the ref.
pattern: '^b69580c31bae7ee5944f2d572d63bea9fc148345\s*$'
---
