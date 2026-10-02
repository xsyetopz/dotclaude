#!/usr/bin/env bash
# crm-import: CJS CSV importer for leads into a Postgres-like store (in-memory stand-in with the same rules).
set -euo pipefail
export GIT_AUTHOR_NAME="Tomasz Wilk" GIT_AUTHOR_EMAIL="tomasz@crm.test"
export GIT_COMMITTER_NAME="Tomasz Wilk" GIT_COMMITTER_EMAIL="tomasz@crm.test"
git init -q -b main .
git config user.name "Tomasz Wilk"; git config user.email "tomasz@crm.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src db data test/fixtures docs/tickets scripts

cat > package.json <<'EOF'
{
  "name": "crm-import",
  "version": "0.9.0",
  "private": true,
  "scripts": {
    "test": "node --test test/",
    "import": "node scripts/import.js"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
EOF
cat > README.md <<'EOF'
# crm-import

Imports lead CSVs (from events and the website form) into the CRM database.

    npm run import -- data/leads-2026-09-30.csv    import into a fresh copy of db/seed.json and print a summary
    npm test

`src/db.js` is the in-memory stand-in we use in tests and dry runs. It enforces the same rules as
production Postgres for the statements we use (see db/README.md), and it counts round trips.
EOF
cat > db/README.md <<'EOF'
# Database

Schema: `db/schema.json`. It is owned by the data team and changed only through their migrations repo,
so don't add columns or tables here.

The importer talks to the database through `db.query(statement)`. Each call is one round trip and
one SQL statement, and every statement targets exactly one table (no CTEs, no multi-table statements;
pgbouncer in transaction mode plus our query builder). Supported statements:

| op       | SQL equivalent                                                      | returns |
|----------|---------------------------------------------------------------------|---------|
| `select` | `SELECT * FROM t WHERE col = ANY($1) [AND ...]`                     | matching rows |
| `insert` | `INSERT INTO t (...) VALUES (...), (...) [ON CONFLICT DO NOTHING] RETURNING *` | inserted rows only, in input order |
| `upsert` | `INSERT ... ON CONFLICT (key) DO UPDATE SET <update cols> RETURNING *` | one row per input row, in input order |

Like Postgres, an upsert fails with "ON CONFLICT DO UPDATE command cannot affect row a second time"
if two input rows have the same key, and an insert without ON CONFLICT fails on a unique violation.
EOF
cat > db/schema.json <<'EOF'
{
  "accounts":  { "columns": ["id", "domain", "name"], "unique": [["domain"]] },
  "contacts":  { "columns": ["id", "account_id", "email", "name", "source"], "unique": [["email"]] },
  "addresses": { "columns": ["id", "contact_id", "street", "city", "country"], "unique": [] },
  "tags":      { "columns": ["id", "contact_id", "tag"], "unique": [["contact_id", "tag"]] }
}
EOF
cat > db/seed.json <<'EOF'
{
  "accounts": [
    { "id": 1, "domain": "acme.com", "name": "Acme Corporation" },
    { "id": 2, "domain": "globex.io", "name": "Globex" },
    { "id": 3, "domain": "initech.net", "name": "Initech LLC" }
  ],
  "contacts": [
    { "id": 1, "account_id": 1, "email": "wile@acme.com", "name": "Wile E.", "source": "web" }
  ],
  "addresses": [
    { "id": 1, "contact_id": 1, "street": "1 Desert Rd", "city": "Phoenix", "country": "US" }
  ],
  "tags": [
    { "id": 1, "contact_id": 1, "tag": "customer" }
  ]
}
EOF
cat > src/db.js <<'EOF'
'use strict';
const schema = require('../db/schema.json');

class DbError extends Error {}

const keyOf = (row, cols) => JSON.stringify(cols.map((c) => row[c]));

class Db {
  constructor(seed) {
    this._tables = {};
    this._seq = {};
    for (const t of Object.keys(schema)) {
      this._tables[t] = (seed[t] || []).map((r) => ({ ...r }));
      this._seq[t] = this._tables[t].reduce((m, r) => Math.max(m, r.id), 0);
    }
    this.queryCount = 0;
  }

  _project(table, row) {
    const out = {};
    for (const c of schema[table].columns) out[c] = c in row ? row[c] : null;
    return out;
  }

  _conflict(table, row) {
    for (const cols of schema[table].unique) {
      const k = keyOf(row, cols);
      const hit = this._tables[table].find((r) => keyOf(r, cols) === k);
      if (hit) return hit;
    }
    return null;
  }

  _add(table, row) {
    const r = this._project(table, { ...row, id: ++this._seq[table] });
    this._tables[table].push(r);
    return r;
  }

  query(stmt) {
    this.queryCount++;
    const { op, table } = stmt;
    if (!schema[table]) throw new DbError(`relation "${table}" does not exist`);
    for (const row of stmt.rows || []) {
      for (const c of Object.keys(row)) if (!schema[table].columns.includes(c)) throw new DbError(`column "${c}" of relation "${table}" does not exist`);
    }
    if (op === 'select') {
      return this._tables[table]
        .filter((r) => Object.entries(stmt.where || {}).every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)))
        .map((r) => ({ ...r }));
    }
    if (op === 'insert') {
      const out = [];
      for (const row of stmt.rows) {
        if (this._conflict(table, row)) {
          if (stmt.onConflict === 'ignore') continue;
          throw new DbError(`duplicate key value violates unique constraint on "${table}"`);
        }
        out.push({ ...this._add(table, row) });
      }
      return out;
    }
    if (op === 'upsert') {
      const seen = new Set();
      for (const row of stmt.rows) {
        const k = keyOf(row, stmt.key);
        if (seen.has(k)) throw new DbError('ON CONFLICT DO UPDATE command cannot affect row a second time');
        seen.add(k);
      }
      return stmt.rows.map((row) => {
        const hit = this._tables[table].find((r) => keyOf(r, stmt.key) === keyOf(row, stmt.key));
        if (!hit) return { ...this._add(table, row) };
        for (const c of stmt.update || []) hit[c] = row[c];
        return { ...hit };
      });
    }
    throw new DbError(`unsupported op ${op}`);
  }
}

module.exports = { Db, DbError };
EOF
cat > src/csv.js <<'EOF'
'use strict';
// Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((f) => f !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}
module.exports = { parseCsv };
EOF
cat > src/normalize.js <<'EOF'
'use strict';
function normalizeLead(row) {
  const email = row.email.toLowerCase();
  return {
    email,
    name: row.name,
    domain: email.split('@')[1],
    company: row.company || email.split('@')[1],
    source: row.source || 'import',
    street: row.street,
    city: row.city,
    country: (row.country || '').toUpperCase(),
  };
}
module.exports = { normalizeLead };
EOF
cat > src/importer.js <<'EOF'
'use strict';
const { normalizeLead } = require('./normalize');

// Imports parsed CSV rows. Existing accounts (by domain) are reused and keep their name.
function importLeads(db, rows) {
  const stats = { rows: rows.length, newAccounts: 0, contacts: 0, addresses: 0 };
  for (const raw of rows) {
    const lead = normalizeLead(raw);
    let [account] = db.query({ op: 'select', table: 'accounts', where: { domain: lead.domain } });
    if (!account) {
      [account] = db.query({ op: 'insert', table: 'accounts', rows: [{ domain: lead.domain, name: lead.company }] });
      stats.newAccounts++;
    }
    const [contact] = db.query({ op: 'insert', table: 'contacts', rows: [{ account_id: account.id, email: lead.email, name: lead.name, source: lead.source }] });
    stats.contacts++;
    db.query({ op: 'insert', table: 'addresses', rows: [{ contact_id: contact.id, street: lead.street, city: lead.city, country: lead.country }] });
    stats.addresses++;
  }
  return stats;
}

module.exports = { importLeads };
EOF
cat > scripts/import.js <<'EOF'
'use strict';
// Dry-run import into a fresh copy of db/seed.json; prints a summary and a digest of the resulting data
// (independent of ids and insertion order).
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Db } = require('../src/db');
const { parseCsv } = require('../src/csv');
const { importLeads } = require('../src/importer');

const file = process.argv[2] || 'data/leads-2026-09-30.csv';
const db = new Db(require('../db/seed.json'));
const rows = parseCsv(fs.readFileSync(file, 'utf8'));
const stats = importLeads(db, rows);

const t = db._tables;
const byId = (table) => new Map(t[table].map((r) => [r.id, r]));
const accounts = byId('accounts');
const view = t.contacts
  .map((c) => ({
    email: c.email,
    name: c.name,
    source: c.source,
    account: [accounts.get(c.account_id).domain, accounts.get(c.account_id).name],
    addresses: t.addresses.filter((a) => a.contact_id === c.id).map((a) => [a.street, a.city, a.country]).sort(),
    tags: (t.tags || []).filter((g) => g.contact_id === c.id).map((g) => g.tag).sort(),
  }))
  .sort((a, b) => a.email.localeCompare(b.email));
const accountView = t.accounts.map((a) => [a.domain, a.name]).sort();
const digest = crypto.createHash('sha256').update(JSON.stringify([accountView, view])).digest('hex').slice(0, 12);
const tagCount = view.reduce((n, c) => n + c.tags.length, 0);
console.log(`import: ${rows.length} rows -> ${t.accounts.length} accounts, ${t.contacts.length} contacts, ${t.addresses.length} addresses, ${tagCount} tags; queries=${db.queryCount}; data digest ${digest}`);
EOF
cat > test/fixtures/small.csv <<'EOF'
email,name,company,source,street,city,country,tags
ann@acme.com,Ann Lee,ACME corp,expo,5 Main St,Phoenix,us,vip
raj@newco.dev,Raj Patel,NewCo,web,9 Elm St,Austin,US,
"li@NewCo.dev","Li, Wei",NewCo,web,9 Elm St,Austin,US,beta
EOF
cat > test/importer.test.js <<'EOF'
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Db } = require('../src/db');
const { parseCsv } = require('../src/csv');
const { importLeads } = require('../src/importer');

const seed = require('../db/seed.json');
const rows = () => parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures/small.csv'), 'utf8'));

test('reuses existing accounts and keeps their name', () => {
  const db = new Db(seed);
  importLeads(db, rows());
  const acme = db._tables.accounts.filter((a) => a.domain === 'acme.com');
  assert.equal(acme.length, 1);
  assert.equal(acme[0].name, 'Acme Corporation');
  assert.equal(db._tables.contacts.find((c) => c.email === 'ann@acme.com').account_id, acme[0].id);
});

test('one new account per new domain, emails lowercased', () => {
  const db = new Db(seed);
  importLeads(db, rows());
  assert.equal(db._tables.accounts.filter((a) => a.domain === 'newco.dev').length, 1);
  assert.ok(db._tables.contacts.some((c) => c.email === 'li@newco.dev' && c.name === 'Li, Wei'));
});

test('each contact gets its address', () => {
  const db = new Db(seed);
  importLeads(db, rows());
  const raj = db._tables.contacts.find((c) => c.email === 'raj@newco.dev');
  assert.deepEqual(db._tables.addresses.filter((a) => a.contact_id === raj.id).map((a) => a.city), ['Austin']);
});
EOF
cat > docs/tickets/PERF-88.md <<'EOF'
# PERF-88: lead import makes one round trip per row (and then some)

Reported: 2026-05-06 by Ines (platform)

The expo import on May 4th (2,300 rows) took 11 minutes and held a pgbouncer connection the whole time.
The importer does a SELECT and up to three INSERTs per CSV row (account, contact, address).

Acceptance: a batch import issues a constant number of statements, independent of row count.
**Budget: at most 3 queries per batch** (one per table we write: accounts, contacts, addresses).
EOF
cat > .editorconfig <<'EOF'
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
EOF
cat > docs/IMPORT_FORMAT.md <<'EOF'
# Lead CSV format

Header row required. Columns: `email,name,company,source,street,city,country`.

- `email` is the identity of a contact and is stored lowercased. Its domain decides the account.
- An account that already exists keeps its name; `company` only names *new* accounts
  (first row of the batch for that domain wins).
- `country` is stored as an upper-case ISO code.
EOF
cat > data/leads-2026-08-28.csv <<'EOF'
email,name,company,source,street,city,country
kim@globex.io,Kim Ng,Globex,web,77 Bay Ave,Oakland,US
lou@acme.com,Lou Reed,Acme,web,5 Main St,Phoenix,US
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 0.8.0
- First version: accounts, contacts, addresses.
EOF
commit "2026-05-12T10:00:00+02:00" "lead importer: accounts, contacts, addresses"

cat > test/fixtures/small.csv <<'EOF'
email,name,company,source,street,city,country,tags
ann@acme.com,Ann Lee,ACME corp,expo,5 Main St,Phoenix,us,vip; VIP
raj@newco.dev,Raj Patel,NewCo,web,9 Elm St,Austin,US,
"li@NewCo.dev","Li, Wei",NewCo,web,9 Elm St,Austin,US,beta;expo-2026
EOF
cat >> docs/IMPORT_FORMAT.md <<'EOF'
- `tags` (since CRM-412): `;`-separated, stored lowercased and de-duplicated per contact in the `tags` table.
EOF
sed -i.bak 's/^# Changelog$/# Changelog\n\n## 0.9.0\n- Tags column imported into the tags table (CRM-412)./' CHANGELOG.md && rm CHANGELOG.md.bak
node - <<'EOF'
const fs = require('fs');
let s = fs.readFileSync('src/importer.js', 'utf8');
s = s.replace("    stats.addresses++;\n", "    stats.addresses++;\n    const tags = [...new Set((raw.tags || '').split(';').map((x) => x.trim().toLowerCase()).filter(Boolean))];\n    for (const tag of tags) db.query({ op: 'insert', table: 'tags', rows: [{ contact_id: contact.id, tag }], onConflict: 'ignore' });\n");
fs.writeFileSync('src/importer.js', s);
let t = fs.readFileSync('test/importer.test.js', 'utf8');
t += `
test('tags are lowercased and deduplicated per contact', () => {
  const db = new Db(seed);
  importLeads(db, rows());
  const ann = db._tables.contacts.find((c) => c.email === 'ann@acme.com');
  assert.deepEqual(db._tables.tags.filter((g) => g.contact_id === ann.id).map((g) => g.tag), ['vip']);
});
`;
fs.writeFileSync('test/importer.test.js', t);
EOF
commit "2026-07-08T16:40:00+02:00" "import tags column into tags table (CRM-412)"

cat > data/leads-2026-09-30.csv <<'EOF'
email,name,company,source,street,city,country,tags
ann@acme.com,Ann Lee,ACME corp,expo,5 Main St,Phoenix,us,vip; VIP
bo@Acme.com,Bo Diaz,ACME corp,expo,5 Main St,Phoenix,US,
carla@globex.io,Carla Ruiz,Globex Inc,expo,77 Bay Ave,Oakland,US,partner
raj@newco.dev,Raj Patel,NewCo,web,9 Elm St,Austin,US,
"li@NewCo.dev","Li, Wei",NewCo,web,9 Elm St,Austin,US,beta;expo-2026
mo@umbrella.co,Mo Salah,Umbrella,expo,1 Hive Rd,Raccoon City,us,vip;beta;Beta
nina@umbrella.co,Nina Berg,Umbrella Corp,expo,1 Hive Rd,Raccoon City,US,
"ola@stark.industries","Ola ""Ace"" Nowak",Stark Industries,expo,10 Malibu Pt,Malibu,US,vip
pete@initech.net,Pete Gibbons,Initech,web,4120 Freidrich Ln,Austin,US,churn-risk
quinn@hooli.xyz,Quinn Fox,Hooli,expo,1 Hacker Way,Palo Alto,US,expo-2026
rosa@hooli.xyz,Rosa Park,Hooli,expo,1 Hacker Way,Palo Alto,US,expo-2026;  vip
sam@wayne.ent,Sam Kerr,Wayne Enterprises,expo,1007 Mountain Dr,Gotham,US,
tara@wayne.ent,Tara Lin,Wayne Ent.,web,1007 Mountain Dr,Gotham,US,beta
uma@globex.io,Uma Roy,Globex,web,77 Bay Ave,Oakland,US,
vic@soylent.green,Vic Mars,Soylent,expo,"12 Food St, Unit 4",Chicago,us,vip
wes@tyrell.ai,Wes Hall,Tyrell,expo,2019 Spinner Rd,Los Angeles,US,beta
xia@tyrell.ai,Xia Chen,Tyrell Corp,expo,2019 Spinner Rd,Los Angeles,US,beta;vip
yan@cyberdyne.sys,Yan Ito,Cyberdyne,web,18144 El Camino,Sunnyvale,US,
zoe@acme.com,Zoe Kim,Acme,web,5 Main St,Phoenix,US,partner;Partner
amir@initech.net,Amir Haddad,Initech,expo,4120 Freidrich Ln,Austin,US,
EOF
commit "2026-09-30T18:05:00+02:00" "data: expo leads 2026-09-30"

cat > test/import.perf.test.js <<'EOF'
'use strict';
// PERF-88: a batch import must use a constant number of round trips.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Db } = require('../src/db');
const { parseCsv } = require('../src/csv');
const { importLeads } = require('../src/importer');

test('PERF-88: batch import stays within the query budget', () => {
  const db = new Db(require('../db/seed.json'));
  importLeads(db, parseCsv(fs.readFileSync(path.join(__dirname, '../data/leads-2026-09-30.csv'), 'utf8')));
  assert.ok(db.queryCount <= 3, `expected at most 3 queries per batch, got ${db.queryCount}`);
});
EOF
commit "2026-10-01T19:30:00+02:00" "test: PERF-88 query budget"
