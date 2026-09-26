#!/usr/bin/env bash
# Workspace: auth service in git. The reported bug (normalizeEmail dropping "+tag")
# was fixed on main last week in #388, with a test, after the 2.3.0 release that
# production runs. No code change is needed; the answer is "fixed in #388, unreleased".
set -euo pipefail

git init -q -b main
git config user.name "Sam Okafor"
git config user.email "sam@example.com"
git config commit.gpgsign false

commit() {
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" GIT_AUTHOR_NAME="$2" GIT_AUTHOR_EMAIL="$3" \
    git commit -q -m "$4"
}

mkdir -p src/auth test

cat > package.json <<'EOF'
{
  "name": "accounts-service",
  "version": "2.2.0",
  "private": true,
  "scripts": {
    "test": "node test/run.js"
  }
}
EOF

cat > src/auth/email.js <<'EOF'
'use strict';

// Canonical form used as the login key.
function normalizeEmail(raw) {
  const trimmed = String(raw).trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) throw new Error(`invalid email: ${raw}`);
  const local = trimmed.slice(0, at).split('+')[0];
  return `${local}@${trimmed.slice(at + 1)}`;
}

module.exports = { normalizeEmail };
EOF

cat > src/auth/login.js <<'EOF'
'use strict';

const { normalizeEmail } = require('./email');

async function findAccount(db, email) {
  return db.accounts.findOne({ loginKey: normalizeEmail(email) });
}

module.exports = { findAccount };
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
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`  ok    ${t.name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${t.name}\n        ${err.message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
EOF

cat > test/email.test.js <<'EOF'
'use strict';

const assert = require('assert');
const { normalizeEmail } = require('../src/auth/email');

test('trims and lower-cases the domain', () => {
  assert.strictEqual(normalizeEmail('  ada@Example.COM '), 'ada@example.com');
});

test('rejects strings without a local part', () => {
  assert.throws(() => normalizeEmail('@example.com'));
});
EOF

cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.2.0
- Login by email (normalizeEmail)
EOF

git add -A
commit "2026-06-03T09:00:00Z" "Sam Okafor" "sam@example.com" "auth: normalize emails for login"
git tag v2.2.0

sed -i.bak 's/"version": "2.2.0"/"version": "2.3.0"/' package.json && rm package.json.bak
cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.3.0 (2026-07-15)
- Rate-limit failed logins per account

## 2.2.0
- Login by email (normalizeEmail)
EOF
cat > src/auth/ratelimit.js <<'EOF'
'use strict';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function isLocked(failures, now = Date.now()) {
  return failures.filter((t) => now - t < WINDOW_MS).length >= MAX_FAILURES;
}

module.exports = { isLocked };
EOF
git add -A
commit "2026-07-15T14:00:00Z" "Sam Okafor" "sam@example.com" "release 2.3.0"
git tag v2.3.0

cat > src/auth/email.js <<'EOF'
'use strict';

// Canonical form used as the login key. The local part is kept exactly as typed
// (including "+tag" plus-addressing); only the domain is case-insensitive.
function normalizeEmail(raw) {
  const trimmed = String(raw).trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) throw new Error(`invalid email: ${raw}`);
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

module.exports = { normalizeEmail };
EOF
cat >> test/email.test.js <<'EOF'

test('keeps plus-addressing in the local part (#388)', () => {
  assert.strictEqual(normalizeEmail('jane+work@Acme.io'), 'jane+work@acme.io');
});
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## Unreleased
- normalizeEmail keeps "+tag" plus-addressing instead of dropping it (#388)

## 2.3.0 (2026-07-15)
- Rate-limit failed logins per account

## 2.2.0
- Login by email (normalizeEmail)
EOF
git add -A
commit "2026-09-19T10:30:00Z" "Priya Raman" "priya@example.com" "normalizeEmail: keep plus-addressing, only lower-case the domain (#388)"
