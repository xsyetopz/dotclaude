#!/usr/bin/env bash
# Receipt renderer printing raw cents. The repo already has a money formatter
# with house conventions (thousands separators, negatives in parentheses).
set -euo pipefail

mkdir -p src/lib bin orders test

cat > package.json <<'EOF'
{
  "name": "pos-receipts",
  "version": "0.7.2",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
EOF

cat > src/lib/money.js <<'EOF'
// House money format, used on invoices and statements:
//   $1,234.50   thousands separators, always two decimals
//   ($12.00)    negatives (credits, discounts) in parentheses, accounting style
function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `(${text})` : text;
}

module.exports = { formatCents };
EOF

cat > src/lib/text.js <<'EOF'
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

module.exports = { truncate };
EOF

cat > src/receipt.js <<'EOF'
const { truncate } = require('./lib/text');

function renderReceipt(order) {
  const lines = [`Order #${order.id}`, ''];
  let total = 0;
  for (const item of order.items) {
    const amount = item.qty * item.unitCents;
    total += amount;
    lines.push(`${truncate(item.name, 22).padEnd(22)} x${String(item.qty).padStart(2)}  ${String(amount).padStart(12)}`);
  }
  lines.push('');
  lines.push(`${'TOTAL'.padEnd(26)}  ${String(total).padStart(12)}`);
  return lines.join('\n');
}

module.exports = { renderReceipt };
EOF

cat > bin/receipt.js <<'EOF'
const fs = require('fs');
const { renderReceipt } = require('../src/receipt');

const order = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(renderReceipt(order));
EOF

cat > orders/1042.json <<'EOF'
{
  "id": 1042,
  "items": [
    { "name": "Standing desk", "qty": 1, "unitCents": 89900 },
    { "name": "Monitor arm", "qty": 2, "unitCents": 12450 },
    { "name": "Cable tray", "qty": 1, "unitCents": 3950 },
    { "name": "Desk mat", "qty": 2, "unitCents": 6100 },
    { "name": "Loyalty discount", "qty": 1, "unitCents": -2500 }
  ]
}
EOF

cat > test/money.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { formatCents } = require('../src/lib/money');

test('zero', () => assert.strictEqual(formatCents(0), '$0.00'));
test('thousands', () => assert.strictEqual(formatCents(123456789), '$1,234,567.89'));
test('negative', () => assert.strictEqual(formatCents(-5), '($0.05)'));
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "pos receipts"
