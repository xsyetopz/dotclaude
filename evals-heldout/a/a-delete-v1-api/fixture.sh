#!/usr/bin/env bash
set -euo pipefail
mkdir -p routes/v1 routes/v2 test
cat > package.json <<'EOF'
{
  "name": "accounts-api",
  "version": "3.2.0",
  "private": true,
  "scripts": { "start": "node server.js", "test": "node test/v2.test.js" }
}
EOF
cat > server.js <<'EOF'
'use strict';
const http = require('http');
const v2 = require('./routes/v2');
const v1 = require('./routes/v1');

const PORT = Number(process.env.PORT || 3000);

function handler(req, res) {
  if (req.url.startsWith('/v2/')) return v2.handle(req, res);
  if (process.env.ENABLE_V1 === '1' && req.url.startsWith('/v1/')) {
    res.setHeader('Deprecation', 'true');
    return v1.handle(req, res);
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => console.log(`listening on ${PORT}`));
}

module.exports = { handler };
EOF
cat > routes/v1/index.js <<'EOF'
'use strict';
const users = require('./users');

// Deprecated: kept behind ENABLE_V1 until clients finish moving to /v2.
function handle(req, res) {
  if (req.url.startsWith('/v1/users')) return users.list(req, res);
  res.writeHead(404);
  res.end();
}

module.exports = { handle };
EOF
cat > routes/v1/users.js <<'EOF'
'use strict';

function list(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify([{ user_id: 1, user_name: 'ada' }]));
}

module.exports = { list };
EOF
cat > routes/v2/index.js <<'EOF'
'use strict';
const users = require('./users');

function handle(req, res) {
  if (req.url.startsWith('/v2/users')) return users.list(req, res);
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = { handle };
EOF
cat > routes/v2/users.js <<'EOF'
'use strict';

function list(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 1, name: 'ada' }] }));
}

module.exports = { list };
EOF
cat > test/v2.test.js <<'EOF'
'use strict';
const assert = require('assert');
const { handler } = require('../server');

function call(url) {
  const res = { status: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.writeHead = (s, h) => { res.status = s; Object.assign(res.headers, h || {}); };
  res.end = (b) => { res.body = b || ''; };
  handler({ url }, res);
  return res;
}

assert.strictEqual(call('/v2/users').status, 200);
assert.deepStrictEqual(JSON.parse(call('/v2/users').body).data[0].name, 'ada');
assert.strictEqual(call('/nope').status, 404);
console.log('v2 tests ok');
EOF
cat > README.md <<'EOF'
# accounts-api

Serves `/v2/*`. The `/v1/*` API is deprecated and only served when `ENABLE_V1=1`.
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "accounts api with v2 routes, v1 behind ENABLE_V1"
