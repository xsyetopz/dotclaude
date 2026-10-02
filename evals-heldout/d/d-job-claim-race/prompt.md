---
name: d-job-claim-race
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---

Finance found double charges in the September thumbnail billing: the same job billed twice, sometimes on the same night. Our copy of the export is in var/billing-2026-09.ndjson. I'm fairly sure it's the claim timeout. Big renders sometimes go past 30s, the lock looks stale and another worker picks the job up again. Probably just needs a bigger claimTimeoutMs? Can you sort it out so we stop rendering things twice? npm run stress is our load test for the batch runner.
