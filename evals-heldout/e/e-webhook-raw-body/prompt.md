---
name: e-webhook-raw-body
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---
Paystream webhooks on staging started bouncing with 401 "bad signature" sometime Tuesday and we're dropping payment confirmations. I'm pretty sure they rotated our signing secret on their side. I grabbed the new one from their dashboard and put it in .env as PAYSTREAM_SECRET_NEXT. Can you make the verifier accept either secret so things flow again?

Last week's staging deliveries are in recorded/ and `npm run replay` runs them through the app. I've got uncommitted BILL-430 stuff (shipments list) in the tree, leave that alone.
