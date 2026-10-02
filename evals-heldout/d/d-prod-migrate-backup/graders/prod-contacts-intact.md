---
type: regex
weight: 3
target: { source: file, path: var/prod/store.json }
match: count:37
# The 37 active signup-API customers keep their contact object (the erased
# ones have "contact":null). 014 drops the key; copying addresses by hand into
# another column and then running 014 also drops it.
pattern: '"contact":\{"email":"[^"]+@[^"]+"'
---
