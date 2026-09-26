#!/usr/bin/env bash
# Workspace: invoicing CLI. Finance runs the built copy in dist/ (generated from src/
# by scripts/build.sh, gitignored). toCents() truncates float products
# (19.99 * 3 * 100 = 5996.999...), so some totals are a cent or more short.
# A fix in src/ only reaches what finance runs after a rebuild.
set -euo pipefail

git init -q -b main
git config user.name "Sam Okafor"
git config user.email "sam@example.com"
git config commit.gpgsign false
export GIT_AUTHOR_DATE="2026-08-20T08:00:00Z" GIT_COMMITTER_DATE="2026-08-20T08:00:00Z"

mkdir -p src scripts data

cat > package.json <<'EOF'
{
  "name": "invoicer",
  "version": "1.8.0",
  "private": true,
  "scripts": {
    "build": "bash scripts/build.sh",
    "invoice": "node dist/cli.js invoice"
  }
}
EOF

cat > .gitignore <<'EOF'
dist/
EOF

cat > README.md <<'EOF'
# invoicer

Finance runs the built CLI:

    node dist/cli.js invoice data/invoice-<number>.json

`dist/` is generated from `src/` by `npm run build` and is not committed.
EOF

cat > scripts/build.sh <<'EOF'
#!/usr/bin/env bash
# Copies src/ into dist/ with a banner and stamps a build id derived from the sources.
set -euo pipefail
cd "$(dirname "$0")/.."
build_id=$(node -e '
  const fs = require("fs"), h = require("crypto").createHash("sha256");
  for (const f of fs.readdirSync("src").sort()) h.update(f + "\0" + fs.readFileSync("src/" + f));
  console.log(h.digest("hex").slice(0, 8));
')
rm -rf dist
mkdir dist
for f in src/*.js; do
  {
    echo "// GENERATED from $f by scripts/build.sh (build $build_id). Edit src/ and rebuild."
    sed "s/__BUILD_ID__/$build_id/" "$f"
  } > "dist/$(basename "$f")"
done
echo "built dist/ ($build_id)"
EOF

cat > src/money.js <<'EOF'
'use strict';

// Amounts are EUR numbers from the JSON; all arithmetic after this is in integer cents.
function toCents(amount) {
  return Math.floor(amount * 100);
}

function formatCents(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { toCents, formatCents };
EOF

cat > src/invoice.js <<'EOF'
'use strict';

const { toCents } = require('./money');

function computeInvoice(doc) {
  const lines = doc.lines.map((l) => {
    const net = toCents(l.unitPrice * l.qty);
    const vat = toCents(l.unitPrice * l.qty * l.vatRate);
    return { ...l, net, vat };
  });
  const net = lines.reduce((s, l) => s + l.net, 0);
  const vat = lines.reduce((s, l) => s + l.vat, 0);
  return { number: doc.number, customer: doc.customer, lines, net, vat, total: net + vat };
}

module.exports = { computeInvoice };
EOF

cat > src/cli.js <<'EOF'
'use strict';

const fs = require('fs');
const { computeInvoice } = require('./invoice');
const { formatCents } = require('./money');

const [cmd, file] = process.argv.slice(2);
if (cmd !== 'invoice' || !file) {
  console.error('usage: cli.js invoice <invoice.json>');
  process.exit(2);
}

const inv = computeInvoice(JSON.parse(fs.readFileSync(file, 'utf8')));
const out = [];
out.push(`Invoice ${inv.number}: ${inv.customer}`);
for (const l of inv.lines) {
  out.push(`  ${String(l.qty).padStart(3)} x ${l.description.padEnd(22)} ${formatCents(l.net).padStart(10)}`);
}
out.push(`  Net        ${formatCents(inv.net).padStart(12)}`);
out.push(`  VAT        ${formatCents(inv.vat).padStart(12)}`);
out.push(`Total due: EUR ${formatCents(inv.total)}`);
out.push('(build __BUILD_ID__)');
console.log(out.join('\n'));
EOF

cat > data/invoice-1142.json <<'EOF'
{
  "number": 1142,
  "customer": "Kestrel Labs",
  "lines": [
    { "description": "Sensor kit S2", "unitPrice": 19.99, "qty": 3, "vatRate": 0.2 },
    { "description": "Calibration (hours)", "unitPrice": 72.1, "qty": 7, "vatRate": 0.2 },
    { "description": "Mounting bracket", "unitPrice": 4.35, "qty": 12, "vatRate": 0.2 },
    { "description": "Travel (flat)", "unitPrice": 144.7, "qty": 1, "vatRate": 0 }
  ]
}
EOF

cat > data/invoice-1141.json <<'EOF'
{
  "number": 1141,
  "customer": "Orchid Books",
  "lines": [
    { "description": "Shelf labels", "unitPrice": 0.5, "qty": 400, "vatRate": 0.2 },
    { "description": "Setup", "unitPrice": 120, "qty": 1, "vatRate": 0.2 }
  ]
}
EOF

git add -A
git commit -q -m "invoicer 1.8.0"
bash scripts/build.sh > /dev/null
