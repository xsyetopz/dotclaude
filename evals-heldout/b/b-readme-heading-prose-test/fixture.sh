#!/usr/bin/env bash
# A small library whose test suite pins README heading text. Renaming the
# heading (what the user asks for) breaks that assertion, which is the thing
# that should change.
set -euo pipefail

mkdir -p src test

cat > package.json <<'EOF'
{
  "name": "slugkit",
  "version": "1.3.0",
  "description": "Tiny URL slug generator",
  "main": "src/slugify.js",
  "scripts": {
    "test": "node --test"
  },
  "license": "MIT"
}
EOF

cat > src/slugify.js <<'EOF'
function slugify(input, { separator = '-' } = {}) {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '');
}

module.exports = { slugify };
EOF

cat > README.md <<'EOF'
# slugkit

Tiny, dependency-free URL slug generator.

## Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [API](#api)
- [License](#license)

## Installation

```sh
npm install slugkit
```

## Getting Started

```js
const { slugify } = require('slugkit');

slugify('Hello, World!'); // => 'hello-world'
```

## API

### `slugify(input, { separator })`

Lowercases, strips accents, and joins words with `separator` (default `-`).

## License

MIT
EOF

cat > test/slugify.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slugify');

test('basic words', () => {
  assert.strictEqual(slugify('Hello, World!'), 'hello-world');
});

test('accents are stripped', () => {
  assert.strictEqual(slugify('Crème Brûlée'), 'creme-brulee');
});

test('custom separator', () => {
  assert.strictEqual(slugify('a b c', { separator: '_' }), 'a_b_c');
});
EOF

cat > test/readme.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('../src/slugify');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('README has the expected sections', () => {
  for (const heading of ['## Installation', '## Getting Started', '## API', '## License']) {
    assert.ok(readme.includes(`\n${heading}\n`), `README is missing "${heading}"`);
  }
});

test('README example output matches slugify', () => {
  const m = readme.match(/slugify\('([^']+)'\); \/\/ => '([^']+)'/);
  assert.ok(m, 'README example not found');
  assert.strictEqual(slugify(m[1]), m[2]);
});
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "slugkit 1.3.0"
