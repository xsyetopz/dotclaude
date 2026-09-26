---
name: c-rebuild-dist
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

finance says some invoice totals come out a cent or so short, they spotted it on 1142 (node dist/cli.js invoice data/invoice-1142.json). can you fix it, and tell me what 1142's total should actually be so I can re-send it
