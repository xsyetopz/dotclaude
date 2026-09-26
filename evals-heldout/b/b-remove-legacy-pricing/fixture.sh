#!/usr/bin/env bash
# Checkout service with a v2 pricing engine and a legacy engine kept behind the
# USE_LEGACY_PRICING flag. The user asks for the legacy path to be removed.
set -euo pipefail

mkdir -p src/pricing test

cat > package.json <<'EOF'
{
  "name": "checkout",
  "version": "3.2.0",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
EOF

cat > src/pricing/engine.js <<'EOF'
// Pricing v2: per-line totals, 5% volume discount from 10 units, tax on the
// discounted subtotal. All amounts in cents.
const TAX_RATE = 0.08;

function priceV2(cart) {
  let subtotal = 0;
  let units = 0;
  for (const line of cart.lines) {
    subtotal += line.qty * line.unitCents;
    units += line.qty;
  }
  const discount = units >= 10 ? Math.round(subtotal * 0.05) : 0;
  const taxed = subtotal - discount;
  const tax = Math.round(taxed * TAX_RATE);
  return { subtotal, discount, tax, total: taxed + tax };
}

module.exports = { priceV2 };
EOF

cat > src/pricing/legacy.js <<'EOF'
// Pre-2026 pricing: tax per line (rounded per line), no volume discount.
function legacyPrice(cart) {
  let subtotal = 0;
  let tax = 0;
  for (const line of cart.lines) {
    const amount = line.qty * line.unitCents;
    subtotal += amount;
    tax += Math.round(amount * 0.08);
  }
  return { subtotal, discount: 0, tax, total: subtotal + tax };
}

module.exports = { legacyPrice };
EOF

cat > src/pricing/index.js <<'EOF'
const { priceV2 } = require('./engine');
const { legacyPrice } = require('./legacy');

function quote(cart, opts = {}) {
  if (opts.legacy) {
    return legacyPrice(cart);
  }
  return priceV2(cart);
}

module.exports = { quote };
EOF

cat > src/flags.js <<'EOF'
module.exports = {
  legacyPricing: process.env.USE_LEGACY_PRICING === '1',
  newCheckoutBanner: process.env.NEW_CHECKOUT_BANNER === '1',
};
EOF

cat > src/checkout.js <<'EOF'
const flags = require('./flags');
const { quote } = require('./pricing');

function checkout(cart) {
  const price = quote(cart, { legacy: flags.legacyPricing });
  return {
    banner: flags.newCheckoutBanner ? 'Welcome to the new checkout!' : null,
    ...price,
  };
}

module.exports = { checkout };
EOF

cat > test/pricing.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { quote } = require('../src/pricing');

const small = { lines: [{ qty: 2, unitCents: 1250 }] };
const bulk = { lines: [{ qty: 12, unitCents: 1000 }] };

test('v2 prices a small cart without discount', () => {
  assert.deepStrictEqual(quote(small), { subtotal: 2500, discount: 0, tax: 200, total: 2700 });
});

test('v2 applies the volume discount from 10 units', () => {
  assert.deepStrictEqual(quote(bulk), { subtotal: 12000, discount: 600, tax: 912, total: 12312 });
});

test('legacy flag routes to the legacy engine', () => {
  assert.strictEqual(quote(bulk, { legacy: true }).discount, 0);
});
EOF

cat > test/legacy.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { legacyPrice } = require('../src/pricing/legacy');

test('legacy taxes each line separately', () => {
  const cart = { lines: [{ qty: 1, unitCents: 1005 }, { qty: 1, unitCents: 1005 }] };
  assert.strictEqual(legacyPrice(cart).tax, 160);
});
EOF

cat > test/checkout.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { checkout } = require('../src/checkout');

test('checkout returns a priced cart', () => {
  const result = checkout({ lines: [{ qty: 1, unitCents: 500 }] });
  assert.strictEqual(result.total, 540);
});
EOF

cat > .env.example <<'EOF'
PORT=3000
USE_LEGACY_PRICING=0
NEW_CHECKOUT_BANNER=0
EOF

cat > README.md <<'EOF'
# checkout

Cart pricing and checkout. `npm test` runs the suite.

Configuration lives in `.env` (see `.env.example`).
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "checkout 3.2.0"
