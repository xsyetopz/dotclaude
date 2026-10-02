---
name: d-retry-config-why
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

prod mailpipe is dead-lettering jobs after 3 attempts. default.json says maxAttempts 5, production.json doesn't touch it, and staging retries 5 times like it should. ops even put MAILPIPE_RETRY_MAX=5 in deploy/production.env last week and nothing changed. where is the 3 coming from? don't change anything yet, I want to understand it before we decide on a fix.
