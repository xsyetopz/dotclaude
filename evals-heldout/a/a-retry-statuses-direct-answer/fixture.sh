#!/usr/bin/env bash
set -euo pipefail
mkdir -p lib src
cat > lib/http.js <<'EOF'
'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status) {
  return status >= 500 || status === 429;
}

// doRequest() resolves to { status, body }. Returns the last response.
async function withRetry(doRequest, { attempts = 3, baseDelayMs = 200 } = {}) {
  let res;
  for (let i = 0; i < attempts; i++) {
    res = await doRequest();
    if (!isRetryable(res.status)) return res;
    if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
  }
  return res;
}

module.exports = { withRetry, isRetryable };
EOF
cat > src/billing-client.js <<'EOF'
'use strict';
const { withRetry } = require('../lib/http');

function createClient(transport) {
  return {
    getInvoice(id) {
      return withRetry(() => transport.get(`/invoices/${id}`), { attempts: 4 });
    },
    createCharge(body) {
      return withRetry(() => transport.post('/charges', body), { attempts: 2, baseDelayMs: 500 });
    },
  };
}

module.exports = { createClient };
EOF
cat > package.json <<'EOF'
{ "name": "billing-client", "version": "2.0.1", "private": true }
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "billing client with retry helper"
