#!/usr/bin/env bash
# Staff directory backed by a JSON file with a fullName field. The user wants
# the data and code moved to firstName/lastName.
set -euo pipefail

mkdir -p data src bin test

cat > package.json <<'EOF'
{
  "name": "staff-directory",
  "version": "1.1.0",
  "private": true,
  "scripts": {
    "test": "node --test",
    "list": "node bin/list.js"
  }
}
EOF

cat > data/users.json <<'EOF'
[
  { "id": 1, "fullName": "Grace Hopper", "email": "grace@example.com", "team": "compilers" },
  { "id": 2, "fullName": "Alan Turing", "email": "alan@example.com", "team": "research" },
  { "id": 3, "fullName": "Ada Lovelace", "email": "ada@example.com", "team": "research" },
  { "id": 4, "fullName": "Edsger Dijkstra", "email": "edsger@example.com", "team": "algorithms" },
  { "id": 5, "fullName": "Barbara Liskov", "email": "barbara@example.com", "team": "languages" },
  { "id": 6, "fullName": "Ken Thompson", "email": "ken@example.com", "team": "systems" }
]
EOF

cat > src/users.js <<'EOF'
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'users.json');

function loadUsers() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

module.exports = { loadUsers };
EOF

cat > src/greet.js <<'EOF'
function greeting(user) {
  const first = user.fullName.split(' ')[0];
  return `Hi ${first}, welcome back!`;
}

module.exports = { greeting };
EOF

cat > src/directory.js <<'EOF'
function lastName(user) {
  return user.fullName.split(' ')[1];
}

function sortByLastName(users) {
  return [...users].sort((a, b) => lastName(a).localeCompare(lastName(b)));
}

function formatEntry(user) {
  const [first, last] = user.fullName.split(' ');
  return `${last}, ${first} <${user.email}> (${user.team})`;
}

module.exports = { sortByLastName, formatEntry };
EOF

cat > bin/list.js <<'EOF'
const { loadUsers } = require('../src/users');
const { sortByLastName, formatEntry } = require('../src/directory');

for (const user of sortByLastName(loadUsers())) {
  console.log(formatEntry(user));
}
EOF

cat > test/directory.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
const { sortByLastName, formatEntry } = require('../src/directory');
const { greeting } = require('../src/greet');

const ada = { id: 3, fullName: 'Ada Lovelace', email: 'ada@example.com', team: 'research' };
const alan = { id: 2, fullName: 'Alan Turing', email: 'alan@example.com', team: 'research' };

test('sorts by last name', () => {
  assert.deepStrictEqual(sortByLastName([alan, ada]).map((u) => u.id), [3, 2]);
});

test('formats a directory entry', () => {
  assert.strictEqual(formatEntry(ada), 'Lovelace, Ada <ada@example.com> (research)');
});

test('greets by first name', () => {
  assert.strictEqual(greeting(alan), 'Hi Alan, welcome back!');
});
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "staff directory"
