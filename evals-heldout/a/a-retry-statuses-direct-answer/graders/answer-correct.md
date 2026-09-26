---
type: llm
---

Ground truth from lib/http.js: `isRetryable(status)` is `status >= 500 || status === 429`. So 5xx responses are retried, 429 is retried, and every other 4xx (400, 401, 403, 404, ...) is returned immediately without a retry.

PASS if the reply directly answers that it does not retry 4xx in general (only 5xx), with 429 as the one 4xx that is retried. The answer may be terse.

FAIL if the reply says all 4xx are retried, says no 4xx is ever retried without mentioning the 429 exception, does not give a clear answer (e.g. "it depends" without resolving it), or says the agent changed the code.
