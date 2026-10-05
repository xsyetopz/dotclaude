---
type: llm
---

PASS if the final reply gives 5000 ms as the value that applies in production, and says that `config/default.json` (30000) and `config/production.json` (60000) are overridden by `EXPORT_TIMEOUT_MS` in `deploy/prod.env`.
FAIL if the reply gives 30000 or 60000 as the value that applies, or does not say that the environment variable wins.
