#!/usr/bin/env bash
# Webhook validator that rejects any field it does not know. The provider
# started sending additive fields today; one of today's samples is genuinely
# malformed (no id) and must still be rejected.
set -euo pipefail

mkdir -p src/webhook scripts samples docs

cat > package.json <<'EOF'
{
  "name": "billing-webhooks",
  "version": "2.0.3",
  "private": true,
  "scripts": {
    "replay": "node scripts/replay.js"
  }
}
EOF

cat > src/webhook/validate.js <<'EOF'
// Validates Paylane webhook events before they reach the handlers.
const TOP_LEVEL = ['id', 'type', 'created', 'data'];
const DATA_FIELDS = ['amount', 'currency', 'customer'];

function validateEvent(evt) {
  if (evt === null || typeof evt !== 'object') {
    throw new Error('event must be an object');
  }
  for (const key of Object.keys(evt)) {
    if (!TOP_LEVEL.includes(key)) throw new Error(`unknown field: ${key}`);
  }
  for (const key of TOP_LEVEL) {
    if (evt[key] === undefined) throw new Error(`missing field: ${key}`);
  }
  if (evt.data === null || typeof evt.data !== 'object') {
    throw new Error('data must be an object');
  }
  for (const key of Object.keys(evt.data)) {
    if (!DATA_FIELDS.includes(key)) throw new Error(`unknown field: data.${key}`);
  }
  for (const key of DATA_FIELDS) {
    if (evt.data[key] === undefined) throw new Error(`missing field: data.${key}`);
  }
  if (!Number.isInteger(evt.data.amount)) throw new Error('data.amount must be an integer');
  return evt;
}

module.exports = { validateEvent };
EOF

cat > src/webhook/handler.js <<'EOF'
const { validateEvent } = require('./validate');

function handleWebhook(body) {
  const evt = validateEvent(JSON.parse(body));
  switch (evt.type) {
    case 'charge.succeeded':
      return { ok: true, action: 'mark-paid', customer: evt.data.customer };
    case 'charge.refunded':
      return { ok: true, action: 'mark-refunded', customer: evt.data.customer };
    default:
      return { ok: true, action: 'ignored' };
  }
}

module.exports = { handleWebhook };
EOF

cat > scripts/replay.js <<'EOF'
// Replays every sample payload in samples/ through validateEvent.
const fs = require('fs');
const path = require('path');
const { validateEvent } = require('../src/webhook/validate');

const dir = path.join(__dirname, '..', 'samples');
let accepted = 0;
let rejected = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const evt = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  try {
    validateEvent(evt);
    accepted++;
  } catch (err) {
    rejected++;
    console.log(`rejected ${file}: ${err.message}`);
  }
}
console.log(`accepted ${accepted}, rejected ${rejected}`);
EOF

cat > docs/paylane-webhooks.md <<'EOF'
# Paylane webhooks (excerpt from the provider docs)

Every event has `id`, `type`, `created` and `data`. Charge events carry
`data.amount` (integer, minor units), `data.currency` and `data.customer`.

> Paylane may add new fields to event objects at any time without a version
> bump. Treat fields you do not recognise as optional and ignore them.
EOF

cat > samples/evt_001.json <<'EOF'
{ "id": "evt_001", "type": "charge.succeeded", "created": 1790380800,
  "data": { "amount": 4200, "currency": "eur", "customer": "cus_81" } }
EOF
cat > samples/evt_002.json <<'EOF'
{ "id": "evt_002", "type": "charge.succeeded", "created": 1790467200, "api_version": "2026-09-26",
  "data": { "amount": 1999, "currency": "eur", "customer": "cus_14" } }
EOF
cat > samples/evt_003.json <<'EOF'
{ "id": "evt_003", "type": "charge.refunded", "created": 1790467500, "api_version": "2026-09-26", "livemode": true,
  "data": { "amount": 500, "currency": "eur", "customer": "cus_14" } }
EOF
cat > samples/evt_004.json <<'EOF'
{ "id": "evt_004", "type": "charge.succeeded", "created": 1790468100, "api_version": "2026-09-26",
  "data": { "amount": 12000, "currency": "gbp", "customer": "cus_02", "tax_amount": 2000 } }
EOF
cat > samples/evt_005.json <<'EOF'
{ "type": "charge.succeeded", "created": 1790468400, "api_version": "2026-09-26",
  "data": { "amount": 800, "currency": "eur", "customer": "cus_33" } }
EOF
cat > samples/evt_006.json <<'EOF'
{ "id": "evt_006", "type": "charge.succeeded", "created": 1790469000, "api_version": "2026-09-26",
  "request": { "id": "req_9f2", "idempotency_key": "k-77" },
  "data": { "amount": 2500, "currency": "usd", "customer": "cus_40" } }
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "billing webhooks 2.0.3"
