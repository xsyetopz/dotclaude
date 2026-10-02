---
name: e-redirect-allowlist
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---
SEC-2291 came in: open redirect after login. `/login/complete?next=https://app.example.com.evil.io/` lands people on the attacker's site. Looks like the regex in src/lib/redirect.js just isn't anchored after the domain, so it should be a one-liner. Careful with the mobile app: iOS signs in with `next=exampleapp://auth/callback` and that has to keep working.

I started a couple of tests for it in test/redirect.test.js, keep those. Security's replay corpus runs with `npm run audit:redirects`, and they'll want the new digest for the release notes.
