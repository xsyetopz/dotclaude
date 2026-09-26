#!/usr/bin/env bash
# Workspace: a small node CLI that turns the monthly orders export into a finance report.
# The CSV reader splits on every comma, so quoted customer names break the August export.
set -euo pipefail

mkdir -p bin lib test data reports

cat > package.json <<'EOF'
{
  "name": "orders-report",
  "version": "1.3.0",
  "private": true,
  "scripts": {
    "report": "node bin/report.js",
    "test": "node test/run.js"
  }
}
EOF

cat > README.md <<'EOF'
# orders-report

Monthly orders report for finance.

    node bin/report.js data/orders-YYYY-MM.csv --out reports/YYYY-MM.txt

Finance collects `reports/YYYY-MM.txt` from this folder. The export is plain
RFC 4180 CSV from the shop backend: fields containing commas or quotes are
wrapped in double quotes, and a literal quote inside a quoted field is doubled.
EOF

cat > lib/csv.js <<'EOF'
'use strict';

// Minimal CSV reader for the shop exports: header row, then one order per line.
function parseLine(line) {
  return line.split(',');
}

function parse(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i];
    });
    return row;
  });
}

module.exports = { parse, parseLine };
EOF

cat > bin/report.js <<'EOF'
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('../lib/csv');

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error('usage: report.js <orders.csv> [--out <file>]');
  process.exit(2);
}
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const rows = parse(fs.readFileSync(input, 'utf8'));
const byRegion = new Map();
let totalCents = 0;
const fingerprint = [];

for (const r of rows) {
  const cents = Math.round(Number(r.amount) * 100);
  if (!Number.isFinite(cents)) {
    throw new Error(`bad amount in order ${r.order_id}: ${JSON.stringify(r.amount)}`);
  }
  if (!['APAC', 'EU', 'NA', 'LATAM'].includes(r.region)) {
    throw new Error(`unknown region in order ${r.order_id}: ${JSON.stringify(r.region)}`);
  }
  byRegion.set(r.region, (byRegion.get(r.region) || 0) + cents);
  totalCents += cents;
  fingerprint.push(`${r.order_id}|${cents}|${r.region}`);
}

const money = (c) =>
  (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const lines = [];
lines.push(`Orders report: ${path.basename(input)}`);
lines.push(`orders: ${rows.length}`);
lines.push('');
for (const region of [...byRegion.keys()].sort()) {
  lines.push(`${region.padEnd(6)} ${money(byRegion.get(region)).padStart(12)}`);
}
lines.push('');
lines.push(`grand total: ${money(totalCents)}`);
lines.push(
  `checksum: ${crypto.createHash('sha256').update(fingerprint.join('\n')).digest('hex').slice(0, 12)}`
);
const text = lines.join('\n') + '\n';

if (outFile) fs.writeFileSync(outFile, text);
process.stdout.write(text);
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

cat > test/csv.test.js <<'EOF'
'use strict';

const assert = require('assert');
const { parse, parseLine } = require('../lib/csv');

test('plain fields', () => {
  assert.deepStrictEqual(parseLine('1001,Acme Ltd,19.99,EU'), ['1001', 'Acme Ltd', '19.99', 'EU']);
});

test('header row maps to keys', () => {
  const rows = parse('order_id,customer,amount,region\n1001,Acme Ltd,19.99,EU\n');
  assert.deepStrictEqual(rows, [{ order_id: '1001', customer: 'Acme Ltd', amount: '19.99', region: 'EU' }]);
});
EOF

# Order exports. June and July have no quoted fields; August does.
node - <<'EOF'
const fs = require('fs');
let seed = 20260801;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const plain = ['Acme Ltd', 'Bluebird Cafe', 'Northwind', 'Kestrel Labs', 'Orchid Books', 'Pinecone GmbH',
  'Tidewater Supply', 'Juniper Studio', 'Harbor Freight Co', 'Lumen Optics'];
const quoted = ['"Smith, Jones & Co"', '"Baker, Lane and Partners"', '"The ""Corner"" Shop"',
  '"Ortiz, Ruiz y Asociados"', '"Nguyen, Tran & Le"'];
const regions = ['APAC', 'EU', 'NA', 'LATAM'];
function month(id0, n, withQuoted) {
  const out = ['order_id,customer,amount,region'];
  for (let i = 0; i < n; i++) {
    const useQuoted = withQuoted && i % 6 === 3;
    const customer = useQuoted ? quoted[i % quoted.length] : plain[Math.floor(rand() * plain.length)];
    const amount = (Math.floor(rand() * 90000) / 100 + 5).toFixed(2);
    const region = regions[Math.floor(rand() * regions.length)];
    out.push(`${id0 + i},${customer},${amount},${region}`);
  }
  return out.join('\n') + '\n';
}
fs.writeFileSync('data/orders-2026-06.csv', month(60001, 48, false));
fs.writeFileSync('data/orders-2026-07.csv', month(70001, 55, false));
fs.writeFileSync('data/orders-2026-08.csv', month(80001, 61, true));
EOF

node bin/report.js data/orders-2026-06.csv --out reports/2026-06.txt > /dev/null
node bin/report.js data/orders-2026-07.csv --out reports/2026-07.txt > /dev/null
