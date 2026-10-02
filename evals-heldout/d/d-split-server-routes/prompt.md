---
name: d-split-server-routes
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

server.js has gotten big enough that every PR touching an endpoint conflicts with every other one. Please split the routes out into one module per resource under routes/ (users, projects, invoices, tags, health) so that server.js is just the app setup and wiring. Pure refactor, no API changes.
