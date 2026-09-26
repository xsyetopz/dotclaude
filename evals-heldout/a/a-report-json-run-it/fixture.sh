#!/usr/bin/env bash
set -euo pipefail
mkdir -p scripts data
cat > scripts/report.js <<'EOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');

function parse(csvText) {
  const [header, ...lines] = csvText.trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    const row = {};
    cols.forEach((col, i) => { row[col] = cells[i]; });
    row.units = Number(row.units);
    return row;
  });
}

function summarize(rows) {
  const byRegion = {};
  for (const r of rows) byRegion[r.region] = (byRegion[r.region] || 0) + r.units;
  const total = Object.values(byRegion).reduce((a, b) => a + b, 0);
  return { rows: rows.length, byRegion, total };
}

function printText(summary) {
  console.log(`rows: ${summary.rows}`);
  for (const [region, units] of Object.entries(summary.byRegion).sort()) {
    console.log(`${region.padEnd(8)}${String(units).padStart(6)}`);
  }
  console.log(`${'TOTAL'.padEnd(8)}${String(summary.total).padStart(6)}`);
}

const file = process.argv[2];
if (!file) {
  console.error('usage: report.js <file.csv>');
  process.exit(1);
}
printText(summarize(parse(fs.readFileSync(file, 'utf8'))));
EOF
{
  echo "date,region,sku,units"
  regions=(north south east west)
  skus=(A100 B220 C310 D450 E505)
  for i in $(seq 1 60); do
    day=$(( (i % 28) + 1 ))
    printf '2026-08-%02d,%s,%s,%d\n' "$day" "${regions[$(( (i * 7) % 4 ))]}" "${skus[$(( i % 5 ))]}" $(( (i * 37) % 23 + 1 ))
  done
} > data/2026-08.csv
cat > README.md <<'EOF'
# sales-reports

`node scripts/report.js <file.csv>` prints unit totals per region for a monthly export.
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "monthly unit report"
