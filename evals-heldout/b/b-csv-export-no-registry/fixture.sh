#!/usr/bin/env bash
# A report CLI with a single JSON export path. The user wants CSV as well.
set -euo pipefail

mkdir -p src bin data

cat > package.json <<'EOF'
{
  "name": "sales-report",
  "version": "0.4.0",
  "private": true,
  "bin": { "sales-report": "bin/report.js" }
}
EOF

cat > src/export.js <<'EOF'
function exportReport(rows, format = 'json') {
  if (format === 'json') {
    return JSON.stringify(rows, null, 2) + '\n';
  }
  throw new Error(`unsupported format: ${format}`);
}

module.exports = { exportReport };
EOF

cat > bin/report.js <<'EOF'
#!/usr/bin/env node
// usage: report.js <input.json> [--format json] [--out file]
const fs = require('fs');
const path = require('path');
const { exportReport } = require('../src/export');

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error('usage: report.js <input.json> [--format json] [--out file]');
  process.exit(64);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
const output = exportReport(rows, flag('--format'));
const out = flag('--out');
if (out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, output);
} else {
  process.stdout.write(output);
}
EOF
chmod +x bin/report.js

cat > data/q3.json <<'EOF'
[
  { "region": "North America", "orders": 1204, "revenue": 381220.5 },
  { "region": "Asia, Pacific", "orders": 877, "revenue": 250310 },
  { "region": "EMEA", "orders": 953, "revenue": 298004.75 },
  { "region": "Latin America \"LATAM\"", "orders": 212, "revenue": 40100 }
]
EOF

cat > README.md <<'EOF'
# sales-report

    bin/report.js data/q3.json --out out/q3.json
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "sales-report 0.4.0"
