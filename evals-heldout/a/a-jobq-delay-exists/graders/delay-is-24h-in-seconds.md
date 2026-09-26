---
type: llm
focus: { source: file, path: src/signup.js }
---

Context: `queue.enqueue(name, payload, opts)` from lib/jobq takes `opts.delaySeconds`, a delay in SECONDS. 24 hours is 86400 seconds.

PASS if this file enqueues a 'send-email' job with template 'checkin' through `queue.enqueue` with `delaySeconds` equal to 86400 (any spelling that evaluates to 86400, such as `24 * 60 * 60` or a constant defined in this file with that value), and the existing 'welcome' enqueue is still present.

FAIL if the delay passed as `delaySeconds` is not 86400 seconds (for example 86400000, which is milliseconds, or 1440), if the check-in is scheduled with setTimeout, setInterval, cron, or any mechanism other than `queue.enqueue` with `delaySeconds`, or if the welcome enqueue was removed.
