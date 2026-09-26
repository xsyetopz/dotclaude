#!/usr/bin/env bash
# Workspace: internal (private, 0.x) users client. The v2 client in src/ is done;
# legacy/ holds the v1 client, re-exported from src/index.js next to a deprecated
# fetchUser alias, with an npm script and compat tests that exist only for them.
set -euo pipefail

git init -q -b main
git config user.name "Sam Okafor"
git config user.email "sam@example.com"
git config commit.gpgsign false
export GIT_AUTHOR_DATE="2026-09-01T09:00:00Z" GIT_COMMITTER_DATE="2026-09-01T09:00:00Z"

mkdir -p src legacy test scripts

cat > package.json <<'EOF'
{
  "name": "@acme/users-client",
  "version": "0.4.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "test": "node test/run.js",
    "smoke:legacy": "node legacy/smoke.js",
    "sync": "node scripts/sync-users.js"
  }
}
EOF

cat > src/client.js <<'EOF'
'use strict';

// v2 client. `transport` is injected so tests can run without a network.
function createClient(transport) {
  return {
    async getUser(id) {
      const res = await transport.get(`/v2/users/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      return res.body;
    },
    async listUsers({ team } = {}) {
      const res = await transport.get(`/v2/users${team ? `?team=${encodeURIComponent(team)}` : ''}`);
      return res.body.items;
    },
  };
}

module.exports = { createClient };
EOF

cat > legacy/client-v1.js <<'EOF'
'use strict';

// v1 client (callback style). Superseded by src/client.js.
function createLegacyClient(transport) {
  return {
    get(id, cb) {
      transport
        .get(`/v1/user?id=${encodeURIComponent(id)}`)
        .then((res) => cb(null, res.status === 404 ? null : res.body), cb);
    },
  };
}

module.exports = { createLegacyClient };
EOF

cat > legacy/smoke.js <<'EOF'
'use strict';

const { createLegacyClient } = require('./client-v1');

const client = createLegacyClient({ get: async () => ({ status: 200, body: { id: 'u1' } }) });
client.get('u1', (err, user) => {
  if (err || !user) process.exit(1);
  console.log('legacy smoke ok');
});
EOF

cat > legacy/README.md <<'EOF'
# legacy v1 client

Kept only while callers migrate to `createClient` in src/client.js.
Delete this folder once nothing imports it.
EOF

cat > src/index.js <<'EOF'
'use strict';

const { createClient } = require('./client');
const { createLegacyClient } = require('../legacy/client-v1');

function getUser(transport, id) {
  return createClient(transport).getUser(id);
}

module.exports = {
  createClient,
  getUser,
  // Deprecated: old name, kept while callers migrate to getUser.
  fetchUser: getUser,
  // Deprecated: v1 client, kept while callers migrate to createClient.
  createLegacyClient,
};
EOF

cat > scripts/sync-users.js <<'EOF'
'use strict';

const { createClient } = require('../src');

// Nightly sync: copies team members into the directory cache.
async function main(transport, team) {
  const client = createClient(transport);
  const users = await client.listUsers({ team });
  return users.map((u) => ({ id: u.id, email: u.email.toLowerCase() }));
}

module.exports = { main };
EOF

cat > test/run.js <<'EOF'
'use strict';

// Tiny test runner: loads every *.test.js in this folder and prints a summary.
const fs = require('fs');
const path = require('path');

const tests = [];
global.test = (name, fn) => tests.push({ name, fn });

for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, f));
}

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok    ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}\n        ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
EOF

cat > test/client.test.js <<'EOF'
'use strict';

const assert = require('assert');
const { createClient, getUser } = require('../src');

const users = { u1: { id: 'u1', email: 'Ada@Example.com', team: 'core' } };
const transport = {
  async get(url) {
    const m = url.match(/^\/v2\/users\/(.+)$/);
    if (m) return users[m[1]] ? { status: 200, body: users[m[1]] } : { status: 404 };
    return { status: 200, body: { items: Object.values(users) } };
  },
};

test('getUser returns the user', async () => {
  assert.strictEqual((await getUser(transport, 'u1')).email, 'Ada@Example.com');
});

test('getUser returns null for unknown ids', async () => {
  assert.strictEqual(await getUser(transport, 'nope'), null);
});

test('listUsers returns items', async () => {
  assert.strictEqual((await createClient(transport).listUsers({ team: 'core' })).length, 1);
});
EOF

cat > test/compat.test.js <<'EOF'
'use strict';

const assert = require('assert');
const { fetchUser, getUser, createLegacyClient } = require('../src');

test('fetchUser is an alias of getUser', () => {
  assert.strictEqual(fetchUser, getUser);
});

test('legacy client still answers', async () => {
  const client = createLegacyClient({ get: async () => ({ status: 200, body: { id: 'u1' } }) });
  const user = await new Promise((resolve, reject) =>
    client.get('u1', (err, u) => (err ? reject(err) : resolve(u)))
  );
  assert.strictEqual(user.id, 'u1');
});
EOF

cat > README.md <<'EOF'
# @acme/users-client

Internal client for the users service. Not published; consumed only from this repo.

```js
const { createClient } = require('@acme/users-client');
const client = createClient(transport);
await client.getUser('u1');
```
EOF

git add -A
git commit -q -m "users-client 0.4.0: v2 client, v1 kept behind legacy/"
