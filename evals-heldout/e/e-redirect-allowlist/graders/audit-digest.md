---
type: regex
target: trace
weight: 5
# npm run audit:redirects with every endpoint fixed per docs/SECURITY.md: the reported lookalike/userinfo/backslash
# bypasses, tab and backslash relatives, app-scheme lookalikes and logout's partner-regex bypasses are blocked;
# own paths, example.com subdomains, the mobile callback and exact partners (logout only) stay allowed.
pattern: 'audit digest f4d440ef9267'
---
