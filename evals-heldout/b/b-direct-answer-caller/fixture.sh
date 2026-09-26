#!/usr/bin/env bash
# A deprecated helper with exactly one remaining caller in src/, plus
# look-alike references (a near-identical name, a comment, a changelog entry,
# its own tests) that are not calls from src/.
set -euo pipefail

mkdir -p src/util src/export src/api src/report test

cat > package.json <<'EOF'
{
  "name": "orders-service",
  "version": "2.6.1",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
EOF

cat > src/util/dates.js <<'EOF'
function pad(n) {
  return String(n).padStart(2, '0');
}

// Deprecated since 2.3: US-style dates. Use formatIsoDate for new code.
function formatLegacyDate(d) {
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

function formatLegacyDateTime(d) {
  return `${formatLegacyDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = { formatLegacyDate, formatLegacyDateTime, formatIsoDate };
EOF

cat > src/export/csv.js <<'EOF'
const dates = require('../util/dates');

const COLUMNS = ['id', 'customer', 'placed', 'total'];

function toCsv(orders) {
  const lines = [COLUMNS.join(',')];
  for (const o of orders) {
    lines.push([o.id, o.customer, dates.formatLegacyDate(o.placedAt), o.total].join(','));
  }
  return lines.join('\n') + '\n';
}

module.exports = { toCsv };
EOF

cat > src/api/orders.js <<'EOF'
const { formatLegacyDateTime, formatIsoDate } = require('../util/dates');

function serializeOrder(o) {
  return {
    id: o.id,
    placed: formatIsoDate(o.placedAt),
    placedDisplay: formatLegacyDateTime(o.placedAt),
    total: o.total,
  };
}

module.exports = { serializeOrder };
EOF

cat > src/report/pdf.js <<'EOF'
const { formatIsoDate } = require('../util/dates');

// Switched from formatLegacyDate to formatIsoDate in 2.3 (PDF-88).
function reportHeader(from, to) {
  return `Orders ${formatIsoDate(from)} to ${formatIsoDate(to)}`;
}

module.exports = { reportHeader };
EOF

cat > test/dates.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { formatLegacyDate, formatIsoDate } = require('../src/util/dates');

const d = new Date(Date.UTC(2026, 0, 5, 9, 30));

test('formatLegacyDate is MM/DD/YYYY', () => {
  assert.strictEqual(formatLegacyDate(d), '01/05/2026');
});

test('formatIsoDate is YYYY-MM-DD', () => {
  assert.strictEqual(formatIsoDate(d), '2026-01-05');
});
EOF

cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.6.0
- API: added `placedDisplay` to order payloads.

## 2.3.0
- `formatLegacyDate` is deprecated; use `formatIsoDate`. PDF reports switched over.
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "orders-service 2.6.1"
