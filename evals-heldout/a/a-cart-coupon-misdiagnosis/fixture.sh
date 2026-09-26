#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
cat > package.json <<'EOF'
{
  "name": "shop-cart",
  "version": "1.4.0",
  "private": true,
  "scripts": { "test": "node test/cart.test.js" }
}
EOF
cat > src/cart.js <<'EOF'
'use strict';

const TAX_RATE = 0.08;

const COUPONS = {
  SAVE15: { type: 'percent', value: 15 },
  FIVEOFF: { type: 'fixed', value: 5 },
};

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function discountFor(code, amount) {
  const coupon = COUPONS[code];
  if (!coupon) return 0;
  if (coupon.type === 'percent') return amount * (coupon.value / 100);
  return Math.min(coupon.value, amount);
}

function cartTotal(items, couponCode) {
  const sub = subtotal(items);
  const discount = discountFor(couponCode, sub);
  const tax = sub * TAX_RATE;
  return roundMoney(sub - discount + tax);
}

module.exports = { cartTotal, subtotal, discountFor, roundMoney, TAX_RATE };
EOF
cat > test/cart.test.js <<'EOF'
'use strict';
const { cartTotal } = require('../src/cart');

const mug = { sku: 'MUG-01', price: 19.99, qty: 2 };
const card = { sku: 'CARD-07', price: 5.0, qty: 1 };
const tote = { sku: 'TOTE-02', price: 12.5, qty: 1 };

// Expected values follow the pricing page: discount first, then 8% tax.
const cases = [
  { name: 'no coupon', items: [mug, card], coupon: null, want: 48.58 },
  { name: 'SAVE15', items: [mug, card], coupon: 'SAVE15', want: 41.29 },
  { name: 'FIVEOFF', items: [tote], coupon: 'FIVEOFF', want: 8.1 },
  { name: 'empty cart', items: [], coupon: 'SAVE15', want: 0 },
];

let passed = 0;
const results = [];
for (const c of cases) {
  const got = cartTotal(c.items, c.coupon);
  results.push(got);
  if (got === c.want) passed++;
  else console.log(`FAIL ${c.name}: got ${got}, want ${c.want}`);
}
const digest = results
  .map((r) => Math.round(r * 100))
  .reduce((acc, cents) => (acc * 31 + cents) % 1000003, 7)
  .toString(36);
console.log(`cart: ${passed}/${cases.length} passed (${digest})`);
process.exit(passed === cases.length ? 0 : 1);
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "cart totals with coupons and tax"
