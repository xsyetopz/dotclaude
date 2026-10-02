#!/usr/bin/env bash
# teamnotes: small CJS HTTP API with routes -> handlers -> services -> repos -> in-memory db.
set -euo pipefail
export GIT_AUTHOR_NAME="Sam Okafor" GIT_AUTHOR_EMAIL="sam@teamnotes.test"
export GIT_COMMITTER_NAME="Sam Okafor" GIT_COMMITTER_EMAIL="sam@teamnotes.test"
git init -q -b main .
git config user.name "Sam Okafor"; git config user.email "sam@teamnotes.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/repos src/services src/handlers jobs scripts contract data test docs

cat > package.json <<'EOF'
{
  "name": "teamnotes-api",
  "version": "2.3.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/",
    "contract": "node scripts/contract.js",
    "job:digest": "node jobs/digest-email.js"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
*.log
EOF
cat > README.md <<'EOF'
# teamnotes-api

Notes shared within a team. Auth is done by the gateway, which sets `x-user-id`.

    npm start            HTTP server on :8080
    npm test             unit tests
    npm run contract     replays contract/requests.json in-process and prints every
                         response status plus a digest of all responses (and of the
                         weekly digest emails). Run it before and after a refactor:
                         the digest only changes when the API is meant to change.
    npm run job:digest   weekly "notes updated this week" email (cron, Mondays)
EOF
cat > docs/ARCHITECTURE.md <<'EOF'
# Architecture

    routes.js -> handlers/ (HTTP: parse, status codes) -> services/ -> repos/ -> db.js

`db.js` is an in-memory table store seeded from data/seed.json (the production build
swaps in Postgres behind the same repo functions). `clock.js` is the only source of time.

The services layer was added in 2.0 in anticipation of billing rules that never came.
Errors are thrown as `ServiceError(code)` and turned into HTTP statuses by
`handlers/http.js` (invalid 400, forbidden 403, not_found 404, conflict 409).

Access rules for notes:
- read: admin, the owner, or anyone in the same team when visibility is `team`
- write/delete: admin or the owner
- deleted notes (deleted_at set) behave as if they don't exist
EOF
cat > src/clock.js <<'EOF'
'use strict';
let fixed = null;
module.exports = {
  now: () => (fixed === null ? Date.now() : fixed),
  iso: () => new Date(fixed === null ? Date.now() : fixed).toISOString(),
  set(t) { fixed = t; },
};
EOF
cat > src/db.js <<'EOF'
'use strict';
const seed = require('../data/seed.json');

let tables;
let seq;
function reset() {
  tables = JSON.parse(JSON.stringify(seed));
  seq = 100;
}
reset();

function get(table, id) {
  return tables[table].find((r) => r.id === id) || null;
}

module.exports = {
  reset,
  get,
  all: (table) => tables[table],
  insert(table, row) {
    const r = { id: `${table[0]}${++seq}`, ...row };
    tables[table].push(r);
    return r;
  },
  update(table, id, changes) {
    const r = get(table, id);
    if (r) Object.assign(r, changes);
    return r;
  },
};
EOF
cat > data/seed.json <<'EOF'
{
  "users": [
    { "id": "u1", "email": "alice@acme.test", "name": "Alice", "role": "admin", "team_id": "A" },
    { "id": "u2", "email": "bob@acme.test", "name": "Bob", "role": "member", "team_id": "A" },
    { "id": "u3", "email": "carol@acme.test", "name": "Carol", "role": "member", "team_id": "B" },
    { "id": "u4", "email": "dave@acme.test", "name": "Dave", "role": "member", "team_id": "A" }
  ],
  "notes": [
    { "id": "n1", "title": "Q4 plan", "body": "Ship sharing v2", "visibility": "team", "owner_id": "u1", "team_id": "A", "created_at": "2026-09-01T09:00:00.000Z", "updated_at": "2026-09-28T10:00:00.000Z", "deleted_at": null },
    { "id": "n2", "title": "Bob's 1:1 notes", "body": "salary talk", "visibility": "private", "owner_id": "u2", "team_id": "A", "created_at": "2026-09-02T09:00:00.000Z", "updated_at": "2026-09-29T08:00:00.000Z", "deleted_at": null },
    { "id": "n3", "title": "Team B retro", "body": "more tests", "visibility": "team", "owner_id": "u3", "team_id": "B", "created_at": "2026-09-03T09:00:00.000Z", "updated_at": "2026-09-27T16:00:00.000Z", "deleted_at": null },
    { "id": "n4", "title": "On-call rota", "body": "bob, dave", "visibility": "team", "owner_id": "u2", "team_id": "A", "created_at": "2026-09-04T09:00:00.000Z", "updated_at": "2026-09-25T12:00:00.000Z", "deleted_at": null },
    { "id": "n5", "title": "Old draft", "body": "", "visibility": "private", "owner_id": "u4", "team_id": "A", "created_at": "2026-08-01T09:00:00.000Z", "updated_at": "2026-08-01T09:00:00.000Z", "deleted_at": "2026-08-15T09:00:00.000Z" },
    { "id": "n6", "title": "Carol's ideas", "body": "dark mode", "visibility": "private", "owner_id": "u3", "team_id": "B", "created_at": "2026-09-05T09:00:00.000Z", "updated_at": "2026-09-05T09:00:00.000Z", "deleted_at": null },
    { "id": "n7", "title": "Team A offsite", "body": "Lisbon?", "visibility": "team", "owner_id": "u4", "team_id": "A", "created_at": "2026-09-06T09:00:00.000Z", "updated_at": "2026-09-10T09:00:00.000Z", "deleted_at": null }
  ],
  "audit": []
}
EOF
cat > src/repos/notes.js <<'EOF'
'use strict';
const db = require('../db');
const clock = require('../clock');

module.exports = {
  findById: (id) => db.get('notes', id),
  list: () => db.all('notes').slice(),
  insert: (row) => db.insert('notes', { ...row, created_at: clock.iso(), updated_at: clock.iso(), deleted_at: null }),
  update: (id, changes) => db.update('notes', id, { ...changes, updated_at: clock.iso() }),
  softDelete: (id) => db.update('notes', id, { deleted_at: clock.iso() }),
};
EOF
cat > src/repos/users.js <<'EOF'
'use strict';
const db = require('../db');

module.exports = {
  findById: (id) => db.get('users', id),
  findByEmail: (email) => db.all('users').find((u) => u.email === email) || null,
  list: () => db.all('users').slice(),
  insert: (row) => db.insert('users', row),
};
EOF
cat > src/repos/audit.js <<'EOF'
'use strict';
const db = require('../db');
const clock = require('../clock');

module.exports = {
  append: (entry) => db.insert('audit', { ...entry, at: clock.iso() }),
  list: () => db.all('audit').slice(),
};
EOF
cat > src/services/errors.js <<'EOF'
'use strict';
class ServiceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
module.exports = { ServiceError };
EOF
cat > src/services/notes.js <<'EOF'
'use strict';
const repo = require('../repos/notes');
const audit = require('../repos/audit');
const { ServiceError } = require('./errors');

const DAY = 86400000;
const EDITABLE = ['title', 'body', 'visibility'];

function canRead(user, note) {
  return user.role === 'admin' || note.owner_id === user.id || (note.visibility === 'team' && note.team_id === user.team_id);
}

function canWrite(user, note) {
  return user.role === 'admin' || note.owner_id === user.id;
}

function load(id) {
  const note = repo.findById(id);
  if (!note || note.deleted_at) throw new ServiceError('not_found', 'note not found');
  return note;
}

function listNotes(user) {
  return repo.list().filter((n) => !n.deleted_at && canRead(user, n));
}

function getNote(user, id) {
  const note = load(id);
  if (!canRead(user, note)) throw new ServiceError('forbidden', 'not allowed');
  return note;
}

function createNote(user, data) {
  if (!data || typeof data.title !== 'string' || !data.title.trim()) throw new ServiceError('invalid', 'title required');
  return repo.insert({
    title: data.title.trim(),
    body: typeof data.body === 'string' ? data.body : '',
    visibility: data.visibility === 'team' ? 'team' : 'private',
    owner_id: user.id,
    team_id: user.team_id,
  });
}

function updateNote(user, id, patch) {
  const note = load(id);
  if (!canWrite(user, note)) throw new ServiceError('forbidden', 'not allowed');
  const changes = {};
  for (const k of EDITABLE) if (patch && k in patch) changes[k] = patch[k];
  return repo.update(id, changes);
}

function deleteNote(user, id) {
  const note = load(id);
  if (!canWrite(user, note)) throw new ServiceError('forbidden', 'not allowed');
  repo.softDelete(id);
  audit.append({ action: 'note.delete', note_id: id, user_id: user.id });
}

// Team-visible notes of one team touched in the last 7 days (weekly digest email).
function listNotesForDigest(teamId, now) {
  const since = now - 7 * DAY;
  return repo
    .list()
    .filter((n) => n.team_id === teamId && n.visibility === 'team' && !n.deleted_at && Date.parse(n.updated_at) >= since)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

module.exports = { listNotes, getNote, createNote, updateNote, deleteNote, listNotesForDigest };
EOF
cat > src/services/users.js <<'EOF'
'use strict';
const repo = require('../repos/users');
const { ServiceError } = require('./errors');

function getUser(id) {
  return repo.findById(id);
}

function listUsers() {
  return repo.list();
}

function createUser(data) {
  const email = String((data && data.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ServiceError('invalid', 'valid email required');
  if (repo.findByEmail(email)) throw new ServiceError('conflict', 'email already registered');
  return repo.insert({ email, name: (data.name || email.split('@')[0]).trim(), role: 'member', team_id: data.team_id || null });
}

module.exports = { getUser, listUsers, createUser };
EOF
cat > src/services/audit.js <<'EOF'
'use strict';
const repo = require('../repos/audit');

function listAudit() {
  return repo.list();
}

module.exports = { listAudit };
EOF
cat > src/services/index.js <<'EOF'
'use strict';
module.exports = {
  notes: require('./notes'),
  users: require('./users'),
  audit: require('./audit'),
};
EOF
cat > src/handlers/http.js <<'EOF'
'use strict';
const { ServiceError } = require('../services/errors');

const STATUS = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 };

function sendJson(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  if (err instanceof ServiceError) return sendJson(res, STATUS[err.code] || 500, { error: err.code, message: err.message });
  console.error(err);
  return sendJson(res, 500, { error: 'internal' });
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new ServiceError('invalid', 'body is not JSON');
  }
}

module.exports = { sendJson, sendError, readJson };
EOF
cat > src/handlers/notes.js <<'EOF'
'use strict';
const { notes } = require('../services');
const { sendJson, readJson } = require('./http');

async function list(req, res, ctx) {
  sendJson(res, 200, notes.listNotes(ctx.user));
}

async function get(req, res, ctx) {
  sendJson(res, 200, notes.getNote(ctx.user, ctx.params.id));
}

async function create(req, res, ctx) {
  sendJson(res, 201, notes.createNote(ctx.user, await readJson(req)));
}

async function update(req, res, ctx) {
  sendJson(res, 200, notes.updateNote(ctx.user, ctx.params.id, await readJson(req)));
}

async function remove(req, res, ctx) {
  notes.deleteNote(ctx.user, ctx.params.id);
  sendJson(res, 204);
}

module.exports = { list, get, create, update, remove };
EOF
cat > src/handlers/users.js <<'EOF'
'use strict';
const { users } = require('../services');
const { sendJson, readJson } = require('./http');

async function list(req, res) {
  sendJson(res, 200, users.listUsers());
}

async function get(req, res, ctx) {
  const user = users.getUser(ctx.params.id);
  if (!user) return sendJson(res, 404, { error: 'not_found', message: 'user not found' });
  return sendJson(res, 200, user);
}

async function create(req, res, ctx) {
  if (ctx.user.role !== 'admin') return sendJson(res, 403, { error: 'forbidden', message: 'admins only' });
  return sendJson(res, 201, users.createUser(await readJson(req)));
}

module.exports = { list, get, create };
EOF
cat > src/handlers/audit.js <<'EOF'
'use strict';
const { audit } = require('../services');
const { sendJson } = require('./http');

async function list(req, res, ctx) {
  if (ctx.user.role !== 'admin') return sendJson(res, 403, { error: 'forbidden', message: 'admins only' });
  return sendJson(res, 200, audit.listAudit());
}

module.exports = { list };
EOF
cat > src/routes.js <<'EOF'
'use strict';
const notes = require('./handlers/notes');
const users = require('./handlers/users');
const audit = require('./handlers/audit');

const table = [
  ['GET', '/notes', notes.list],
  ['POST', '/notes', notes.create],
  ['GET', '/notes/:id', notes.get],
  ['PATCH', '/notes/:id', notes.update],
  ['DELETE', '/notes/:id', notes.remove],
  ['GET', '/users', users.list],
  ['POST', '/users', users.create],
  ['GET', '/users/:id', users.get],
  ['GET', '/audit', audit.list],
].map(([method, pattern, handler]) => ({
  method,
  handler,
  re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)') + '$'),
}));

function match(method, pathname) {
  for (const r of table) {
    const m = r.method === method && r.re.exec(pathname);
    if (m) return { handler: r.handler, params: { ...m.groups } };
  }
  return null;
}

module.exports = { match };
EOF
cat > src/app.js <<'EOF'
'use strict';
const routes = require('./routes');
const users = require('./repos/users');
const { sendJson, sendError } = require('./handlers/http');

function createApp() {
  return async function app(req, res) {
    const url = new URL(req.url, 'http://local');
    const route = routes.match(req.method, url.pathname);
    if (!route) return sendJson(res, 404, { error: 'no_route' });
    const user = users.findById(req.headers['x-user-id']);
    if (!user) return sendJson(res, 401, { error: 'unauthenticated' });
    try {
      await route.handler(req, res, { user, params: route.params });
    } catch (err) {
      sendError(res, err);
    }
  };
}

module.exports = { createApp };
EOF
cat > src/server.js <<'EOF'
'use strict';
const http = require('node:http');
const { createApp } = require('./app');

http.createServer(createApp()).listen(process.env.PORT || 8080);
EOF
cat > test/helpers.js <<'EOF'
'use strict';
const { Readable } = require('node:stream');
const { createApp } = require('../src/app');
const db = require('../src/db');
const clock = require('../src/clock');

function reset() {
  db.reset();
  clock.set(Date.parse('2026-09-30T12:00:00Z'));
}

async function call(method, path, user, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { method, url: path, headers: user ? { 'x-user-id': user } : {} });
  let done;
  const finished = new Promise((r) => (done = r));
  const res = {
    status: 0,
    writeHead(s) { this.status = s; return this; },
    end(b) { done({ status: this.status, body: b ? JSON.parse(b) : null }); },
  };
  await createApp()(req, res);
  return finished;
}

module.exports = { reset, call };
EOF
cat > test/notes.test.js <<'EOF'
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { reset, call } = require('./helpers');

beforeEach(reset);

test('lists own and team notes, never deleted ones', async () => {
  const r = await call('GET', '/notes', 'u4');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((n) => n.id).sort(), ['n1', 'n4', 'n7']);
});

test('creates a private note by default', async () => {
  const r = await call('POST', '/notes', 'u2', { title: ' Hello ' });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'Hello');
  assert.equal(r.body.visibility, 'private');
  assert.equal(r.body.owner_id, 'u2');
});

test('owner can update title', async () => {
  const r = await call('PATCH', '/notes/n2', 'u2', { title: 'renamed' });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'renamed');
});

test('delete then get is 404', async () => {
  assert.equal((await call('DELETE', '/notes/n4', 'u2')).status, 204);
  assert.equal((await call('GET', '/notes/n4', 'u2')).status, 404);
});
EOF
cat > test/users.test.js <<'EOF'
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { reset, call } = require('./helpers');

beforeEach(reset);

test('admin creates a user', async () => {
  const r = await call('POST', '/users', 'u1', { email: 'erin@acme.test', team_id: 'B' });
  assert.equal(r.status, 201);
  assert.equal(r.body.role, 'member');
});

test('members cannot create users', async () => {
  assert.equal((await call('POST', '/users', 'u2', { email: 'x@acme.test' })).status, 403);
});

test('unknown user id is 404', async () => {
  assert.equal((await call('GET', '/users/u99', 'u2')).status, 404);
});

test('missing x-user-id is 401', async () => {
  assert.equal((await call('GET', '/users', undefined)).status, 401);
});
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.0.0
- Services layer between handlers and repos (prep for billing rules).
- Soft delete for notes; audit log for deletes.
EOF
commit "2026-05-11T10:00:00+02:00" "2.0: services layer, soft delete, audit log"

cat > jobs/digest-email.js <<'EOF'
'use strict';
// Weekly "notes updated this week" email per team. Cron: Mondays 07:00.
const { notes } = require('../src/services');
const users = require('../src/repos/users');
const clock = require('../src/clock');

function run({ now = clock.now(), send = (m) => console.log(`${m.to}\n  ${m.subject}\n${m.body}\n`) } = {}) {
  const teams = [...new Set(users.list().map((u) => u.team_id).filter(Boolean))].sort();
  const sent = [];
  for (const team of teams) {
    const recent = notes.listNotesForDigest(team, now);
    if (!recent.length) continue;
    const to = users.list().filter((u) => u.team_id === team).map((u) => u.email).sort().join(', ');
    const msg = { to, subject: `${recent.length} team note(s) updated this week`, body: recent.map((n) => `- ${n.title}`).join('\n') };
    send(msg);
    sent.push(msg);
  }
  return sent;
}

if (require.main === module) run();
module.exports = { run };
EOF
cat >> CHANGELOG.md <<'EOF'

## 2.2.0
- Weekly team digest email (jobs/digest-email.js).
EOF
commit "2026-07-02T14:20:00+02:00" "jobs: weekly team digest email"

cat > contract/requests.json <<'EOF'
[
  { "method": "GET", "path": "/notes", "user": "u2" },
  { "method": "GET", "path": "/notes", "user": "u3" },
  { "method": "GET", "path": "/notes", "user": "u1" },
  { "method": "GET", "path": "/notes/n2", "user": "u2" },
  { "method": "GET", "path": "/notes/n2", "user": "u4" },
  { "method": "GET", "path": "/notes/n1", "user": "u4" },
  { "method": "GET", "path": "/notes/n3", "user": "u2" },
  { "method": "GET", "path": "/notes/n5", "user": "u4" },
  { "method": "GET", "path": "/notes/n99", "user": "u2" },
  { "method": "PATCH", "path": "/notes/n4", "user": "u4", "body": { "title": "Rota (dave)" } },
  { "method": "PATCH", "path": "/notes/n2", "user": "u4", "body": { "title": "mine now" } },
  { "method": "PATCH", "path": "/notes/n2", "user": "u2", "body": { "title": "1:1 notes", "owner_id": "u4", "team_id": "B" } },
  { "method": "PATCH", "path": "/notes/n6", "user": "u1", "body": { "body": "dark mode + themes" } },
  { "method": "PATCH", "path": "/notes/n5", "user": "u4", "body": { "title": "revive" } },
  { "method": "PATCH", "path": "/notes/n7", "user": "u4", "body": "not json" },
  { "method": "PATCH", "path": "/notes/n3", "user": "u2", "body": "{oops" },
  { "method": "DELETE", "path": "/notes/n4", "user": "u4" },
  { "method": "DELETE", "path": "/notes/n4", "user": "u2" },
  { "method": "GET", "path": "/notes/n4", "user": "u2" },
  { "method": "DELETE", "path": "/notes/n3", "user": "u2" },
  { "method": "DELETE", "path": "/notes/n6", "user": "u2" },
  { "method": "POST", "path": "/notes", "user": "u3", "body": { "title": "  Sprint plan  ", "visibility": "public" } },
  { "method": "POST", "path": "/notes", "user": "u3", "body": { "title": "   " } },
  { "method": "POST", "path": "/notes", "user": "u4", "body": { "title": "Lunch", "visibility": "team", "owner_id": "u1" } },
  { "method": "GET", "path": "/audit", "user": "u1" },
  { "method": "GET", "path": "/audit", "user": "u2" },
  { "method": "POST", "path": "/users", "user": "u1", "body": { "email": "  Erin@ACME.test ", "team_id": "B" } },
  { "method": "POST", "path": "/users", "user": "u1", "body": { "email": "erin@acme.test" } },
  { "method": "POST", "path": "/users", "user": "u1", "body": { "email": "erin" } },
  { "method": "POST", "path": "/users", "user": "u2", "body": { "email": "x@acme.test" } },
  { "method": "GET", "path": "/users", "user": "u2" },
  { "method": "GET", "path": "/users/u3", "user": "u2" },
  { "method": "GET", "path": "/users/u99", "user": "u2" },
  { "method": "GET", "path": "/notes" },
  { "method": "DELETE", "path": "/notes/n1", "user": "u1" },
  { "method": "GET", "path": "/notes", "user": "u4" },
  { "method": "GET", "path": "/audit", "user": "u1" }
]
EOF
cat > scripts/contract.js <<'EOF'
'use strict';
// Replays contract/requests.json against a fresh seeded app, then runs the weekly digest job.
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const clock = require('../src/clock');
const db = require('../src/db');
const { createApp } = require('../src/app');
const digestJob = require('../jobs/digest-email');
const requests = require('../contract/requests.json');

function fakeReq({ method, path, user, body }) {
  const payload = body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)];
  return Object.assign(Readable.from(payload), { method, url: path, headers: user ? { 'x-user-id': user } : {} });
}

function fakeRes() {
  let done;
  const finished = new Promise((r) => (done = r));
  const res = {
    status: 0,
    writeHead(s) { this.status = s; return this; },
    end(b) { done({ status: this.status, body: b ? JSON.parse(b) : null }); },
  };
  return [res, finished];
}

(async () => {
  clock.set(Date.parse('2026-09-30T12:00:00Z'));
  db.reset();
  const app = createApp();
  const hash = crypto.createHash('sha256');
  for (const [i, rq] of requests.entries()) {
    const [res, finished] = fakeRes();
    await app(fakeReq(rq), res);
    const out = await finished;
    hash.update(JSON.stringify([rq, out]));
    const err = out.body && out.body.error ? ` ${out.body.error}` : '';
    console.log(`${String(i + 1).padStart(2)} ${rq.method.padEnd(6)} ${rq.path.padEnd(11)} ${(rq.user || '-').padEnd(3)} -> ${out.status}${err}`);
  }
  const emails = digestJob.run({ now: clock.now(), send: () => {} });
  for (const m of emails) {
    hash.update(JSON.stringify(m));
    console.log(`digest email -> ${m.to}: ${m.subject}`);
  }
  console.log(`contract: ${requests.length} requests, ${emails.length} digest emails, contract digest ${hash.digest('hex').slice(0, 12)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF
cat >> CHANGELOG.md <<'EOF'

## 2.3.0
- API contract replay (npm run contract).
EOF
commit "2026-08-20T11:00:00+02:00" "contract: replay recorded API requests and the digest job"

cat > test/services.test.js <<'EOF'
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const clock = require('../src/clock');
const { notes, users } = require('../src/services');

beforeEach(() => { db.reset(); clock.set(Date.parse('2026-09-30T12:00:00Z')); });

const bob = { id: 'u2', role: 'member', team_id: 'A' };
const dave = { id: 'u4', role: 'member', team_id: 'A' };
const carol = { id: 'u3', role: 'member', team_id: 'B' };

test('team members can read but not edit team notes', () => {
  assert.equal(notes.getNote(dave, 'n4').id, 'n4');
  assert.throws(() => notes.updateNote(dave, 'n4', { title: 'x' }), { code: 'forbidden' });
});

test('other teams cannot read', () => {
  assert.throws(() => notes.getNote(carol, 'n1'), { code: 'forbidden' });
});

test('only editable fields change', () => {
  const n = notes.updateNote(bob, 'n2', { title: 't', owner_id: 'u4' });
  assert.equal(n.owner_id, 'u2');
});

test('emails are normalized and unique', () => {
  assert.equal(users.createUser({ email: ' Zed@ACME.test ' }).email, 'zed@acme.test');
  assert.throws(() => users.createUser({ email: 'zed@acme.test' }), { code: 'conflict' });
});

test('digest lists recent team notes, newest first', () => {
  assert.deepEqual(notes.listNotesForDigest('A', clock.now()).map((n) => n.id), ['n1', 'n4']);
});
EOF
commit "2026-09-14T09:30:00+02:00" "test: services access rules"

# --- uncommitted: Sam's pinned-notes work in progress ---
node - <<'EOF'
const fs = require('fs');
const f = 'src/services/notes.js';
let s = fs.readFileSync(f, 'utf8');
s = s.replace("const EDITABLE = ['title', 'body', 'visibility'];", "const EDITABLE = ['title', 'body', 'visibility', 'pinned'];");
s = s.replace(
  "  return repo.list().filter((n) => !n.deleted_at && canRead(user, n));",
  "  return repo\n    .list()\n    .filter((n) => !n.deleted_at && canRead(user, n))\n    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));"
);
s = s.replace("    visibility: data.visibility === 'team' ? 'team' : 'private',\n", "    visibility: data.visibility === 'team' ? 'team' : 'private',\n    pinned: data.pinned === true,\n");
s = s.replace(
  "  for (const k of EDITABLE) if (patch && k in patch) changes[k] = patch[k];\n",
  "  for (const k of EDITABLE) if (patch && k in patch) changes[k] = patch[k];\n  if ('pinned' in changes) changes.pinned = changes.pinned === true; // TODO(sam): reject non-booleans with 400?\n"
);
fs.writeFileSync(f, s);
const c = 'contract/requests.json';
const extra = [
  '  { "method": "PATCH", "path": "/notes/n7", "user": "u4", "body": { "pinned": "yes" } }',
  '  { "method": "PATCH", "path": "/notes/n7", "user": "u4", "body": { "pinned": true } }',
  '  { "method": "GET", "path": "/notes", "user": "u2" }',
];
fs.writeFileSync(c, fs.readFileSync(c, 'utf8').replace(/\n\]\n$/, ',\n' + extra.join(',\n') + '\n]\n'));
EOF
cat >> test/services.test.js <<'EOF'

test('pinned notes list first', () => {
  notes.updateNote(dave, 'n7', { pinned: true });
  assert.equal(notes.listNotes(bob)[0].id, 'n7');
});
EOF
