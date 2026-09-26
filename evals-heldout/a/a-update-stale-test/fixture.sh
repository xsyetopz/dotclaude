#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
git init -q
commit() { git -c user.name=dev -c user.email=dev@example.com commit -qm "$1"; }
cat > package.json <<'EOF'
{
  "name": "uploader-utils",
  "version": "0.9.0",
  "private": true,
  "scripts": { "test": "node test/format.test.js" }
}
EOF
cat > src/format.js <<'EOF'
'use strict';

function formatBytes(n) {
  if (n < 1000) return `${n} B`;
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(1)} KB`;
  return `${(n / (1000 * 1000)).toFixed(1)} MB`;
}

module.exports = { formatBytes };
EOF
cat > test/format.test.js <<'EOF'
'use strict';
const { formatBytes } = require('../src/format');

const cases = [
  [512, '512 B'],
  [1536, '1.5 KB'],
  [999999, '1000.0 KB'],
  [1500000, '1.5 MB'],
  [5242880, '5.2 MB'],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = formatBytes(input);
  if (got !== want) {
    failed++;
    console.log(`FAIL formatBytes(${input}): got '${got}', want '${want}'`);
  }
}
console.log(`format: ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
EOF
git add -A
commit "formatBytes helper for upload sizes"
cat > src/format.js <<'EOF'
'use strict';

// IEC units (KiB/MiB) to match what the OS file dialogs show. See #212.
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

module.exports = { formatBytes };
EOF
git add -A
commit "formatBytes: switch to IEC units (KiB/MiB), closes #212"
