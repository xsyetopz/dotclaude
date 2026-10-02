#!/usr/bin/env bash
# taskboard-api: CommonJS API whose server.js registers every route inside createApp().
# Traps for a split into routes/*: fixed paths (/users/me, /projects/archived,
# /invoices/overdue) are registered before their :id siblings in a separate block;
# stats and summaryCache are shared across resources (invoice writes invalidate
# the project summary cache). npm test replays 41 requests against a golden file.
set -euo pipefail

export GIT_AUTHOR_NAME="Marta Ilves" GIT_AUTHOR_EMAIL="marta@taskboard.dev"
export GIT_COMMITTER_NAME="Marta Ilves" GIT_COMMITTER_EMAIL="marta@taskboard.dev"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- taskboard api: router, seeded db, users/projects/invoices/tags
cat > .gitignore <<'__FX__'
node_modules/
.test-results.txt
__FX__
cat > .editorconfig <<'__FX__'
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
__FX__
cat > package.json <<'__FX__'
{
  "name": "taskboard-api",
  "version": "2.3.1",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node bin/serve.js",
    "test": "node test/run.js",
    "smoke": "node test/smoke.js"
  },
  "engines": { "node": ">=18" }
}
__FX__
cat > README.md <<'__FX__'
# taskboard-api

Internal API behind the taskboard UI: users, projects, invoices and tags.
In-memory storage (seeded on start); the persistent store lives in another service.

```
npm start        # http on :3000
npm test         # unit tests + smoke replay, summary in .test-results.txt
npm run smoke    # smoke replay only
```

Requests authenticate with an `x-user: <user id>` header (the gateway sets it).
`/health` and `/health/stats` are public.
__FX__
mkdir -p lib
cat > lib/router.js <<'__FX__'
'use strict';
// Minimal in-process router. Routes match in registration order; first match wins.
const { HttpError } = require('./errors');

function compile(pattern) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '$',
  );
  return { re, keys };
}

function createRouter() {
  const routes = [];
  const middleware = [];

  function add(method, pattern, handler) {
    routes.push({ method, pattern, handler, ...compile(pattern) });
  }

  function handle(req) {
    const [pathname, qs = ''] = req.url.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs));
    const ctx = { method: req.method, path: pathname, query, headers: req.headers || {}, body: req.body, params: {} };
    try {
      for (const mw of middleware) mw(ctx);
      for (const r of routes) {
        if (r.method !== ctx.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
        const res = r.handler(ctx);
        return { status: res.status || 200, body: res.body };
      }
      throw new HttpError(404, 'not_found', `no route for ${ctx.method} ${pathname}`);
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
      return { status: 500, body: { error: { code: 'internal', message: err.message } } };
    }
  }

  return {
    use: (fn) => middleware.push(fn),
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    handle,
    routes,
  };
}

module.exports = { createRouter };
__FX__
mkdir -p lib
cat > lib/errors.js <<'__FX__'
'use strict';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const notFound = (what, id) => new HttpError(404, 'not_found', `${what} ${id} not found`);
const badRequest = (msg) => new HttpError(400, 'bad_request', msg);
const conflict = (msg) => new HttpError(409, 'conflict', msg);

module.exports = { HttpError, notFound, badRequest, conflict };
__FX__
mkdir -p lib
cat > lib/db.js <<'__FX__'
'use strict';
// In-memory store. createDb() returns a fresh, seeded database.

function createDb() {
  const counters = {};
  const nextId = (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  };
  const db = { users: new Map(), projects: new Map(), invoices: new Map(), tags: new Map(), nextId };

  const insert = (table, prefix, row) => {
    const id = nextId(prefix);
    db[table].set(id, { id, ...row });
    return db[table].get(id);
  };
  db.insert = insert;

  const ada = insert('users', 'usr', { name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' });
  const bob = insert('users', 'usr', { name: 'Bob Stone', email: 'bob@example.com', role: 'member' });
  const cy = insert('users', 'usr', { name: 'Cy Young', email: 'cy@example.com', role: 'member' });
  insert('users', 'usr', { name: 'Dee Okoro', email: 'dee@example.com', role: 'member' });

  const tWeb = insert('tags', 'tag', { name: 'web' });
  const tOps = insert('tags', 'tag', { name: 'ops' });
  insert('tags', 'tag', { name: 'legal' });

  const p1 = insert('projects', 'prj', { name: 'Website relaunch', ownerId: ada.id, archived: false, tagIds: [tWeb.id] });
  const p2 = insert('projects', 'prj', { name: 'Data center move', ownerId: bob.id, archived: false, tagIds: [tOps.id] });
  insert('projects', 'prj', { name: 'Old CRM', ownerId: bob.id, archived: true, tagIds: [] });
  insert('projects', 'prj', { name: 'Brand book', ownerId: cy.id, archived: false, tagIds: [tWeb.id] });

  insert('invoices', 'inv', { projectId: p1.id, amountCents: 120000, dueDate: '2026-02-15', status: 'open' });
  insert('invoices', 'inv', { projectId: p1.id, amountCents: 45000, dueDate: '2026-03-20', status: 'open' });
  insert('invoices', 'inv', { projectId: p2.id, amountCents: 990000, dueDate: '2026-01-31', status: 'paid' });
  insert('invoices', 'inv', { projectId: p2.id, amountCents: 30500, dueDate: '2026-02-28', status: 'open' });

  return db;
}

module.exports = { createDb };
__FX__
mkdir -p lib
cat > lib/paginate.js <<'__FX__'
'use strict';

const MAX_LIMIT = 50;

function paginate(items, query) {
  const limit = Math.min(Number(query.limit) || 20, MAX_LIMIT);
  const offset = Number(query.offset) || 0;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

module.exports = { paginate, MAX_LIMIT };
__FX__
mkdir -p lib
cat > lib/validate.js <<'__FX__'
'use strict';
const { badRequest } = require('./errors');

function requireString(body, key, { max = 200 } = {}) {
  const v = body && body[key];
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${key} is required`);
  if (v.length > max) throw badRequest(`${key} is too long`);
  return v.trim();
}

function optionalString(body, key, opts) {
  if (!body || body[key] === undefined) return undefined;
  return requireString(body, key, opts);
}

function requireInt(body, key, { min = 0 } = {}) {
  const v = body && body[key];
  if (!Number.isInteger(v) || v < min) throw badRequest(`${key} must be an integer >= ${min}`);
  return v;
}

function requireDate(body, key) {
  const v = body && body[key];
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${key} must be YYYY-MM-DD`);
  return v;
}

function requireEnum(body, key, values) {
  const v = body && body[key];
  if (!values.includes(v)) throw badRequest(`${key} must be one of ${values.join(', ')}`);
  return v;
}

module.exports = { requireString, optionalString, requireInt, requireDate, requireEnum };
__FX__
mkdir -p lib
cat > lib/money.js <<'__FX__'
'use strict';

function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}EUR ${whole}.${String(abs % 100).padStart(2, '0')}`;
}

module.exports = { formatCents };
__FX__
cat > server.js <<'__FX__'
'use strict';
// taskboard API. createApp() wires the router, middleware and every route.
// bin/serve.js puts it behind node:http; tests drive app.handle() directly.

const { createRouter } = require('./lib/router');
const { createDb } = require('./lib/db');
const { HttpError, notFound, badRequest, conflict } = require('./lib/errors');
const { paginate } = require('./lib/paginate');
const { requireString, optionalString, requireInt, requireDate, requireEnum } = require('./lib/validate');
const { formatCents } = require('./lib/money');

const VERSION = require('./package.json').version;
const ROLES = ['admin', 'member'];
const INVOICE_STATUSES = ['open', 'paid', 'void'];

function createApp(opts = {}) {
  const db = opts.db || createDb();
  const clock = opts.clock || (() => new Date('2026-03-01T12:00:00Z'));
  const app = createRouter();

  // Shared between handlers: request stats (reported by /health/stats), the
  // per-project summary cache, and the audit log.
  const stats = { requests: 0, byResource: {} };
  const summaryCache = new Map();
  const audit = [];

  // ---------------------------------------------------------------- middleware

  app.use((ctx) => {
    stats.requests += 1;
    const resource = ctx.path.split('/')[1] || 'root';
    stats.byResource[resource] = (stats.byResource[resource] || 0) + 1;
  });

  app.use((ctx) => {
    if (ctx.path === '/health' || ctx.path === '/health/stats') return;
    const uid = ctx.headers['x-user'];
    if (!uid) throw new HttpError(401, 'unauthenticated', 'x-user header required');
    const user = db.users.get(uid);
    if (!user) throw new HttpError(401, 'unauthenticated', `unknown user ${uid}`);
    ctx.user = user;
  });

  // ---------------------------------------------------------------- helpers

  function requireAdmin(ctx) {
    if (ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'admin only');
  }

  function record(ctx, action, id) {
    audit.push({ at: clock().toISOString(), by: ctx.user.id, action, id });
  }

  function getOr404(table, what, id) {
    const row = db[table].get(id);
    if (!row) throw notFound(what, id);
    return row;
  }

  function userView(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  }

  function projectView(p) {
    const owner = db.users.get(p.ownerId);
    return {
      id: p.id,
      name: p.name,
      owner: owner ? { id: owner.id, name: owner.name } : null,
      archived: p.archived,
      tags: p.tagIds.map((t) => db.tags.get(t)).filter(Boolean).map((t) => t.name).sort(),
    };
  }

  function invoiceView(i) {
    return {
      id: i.id,
      projectId: i.projectId,
      amountCents: i.amountCents,
      amount: formatCents(i.amountCents),
      dueDate: i.dueDate,
      status: i.status,
      overdue: isOverdue(i),
    };
  }

  function isOverdue(i) {
    return i.status === 'open' && i.dueDate < clock().toISOString().slice(0, 10);
  }

  function invoicesFor(projectId) {
    return [...db.invoices.values()].filter((i) => i.projectId === projectId);
  }

  function projectSummary(p) {
    if (summaryCache.has(p.id)) return summaryCache.get(p.id);
    const invoices = invoicesFor(p.id).filter((i) => i.status !== 'void');
    const billed = invoices.reduce((s, i) => s + i.amountCents, 0);
    const outstanding = invoices.filter((i) => i.status === 'open').reduce((s, i) => s + i.amountCents, 0);
    const summary = {
      projectId: p.id,
      invoices: invoices.length,
      billed: formatCents(billed),
      outstanding: formatCents(outstanding),
      overdue: invoices.filter(isOverdue).length,
    };
    summaryCache.set(p.id, summary);
    return summary;
  }

  function byName(a, b) {
    return a.name.localeCompare(b.name);
  }

  // ---------------------------------------------------------------- listings
  // Fixed paths that live next to an :id route of the same resource.

  app.get('/users/me', (ctx) => ({ body: userView(ctx.user) }));

  app.get('/projects/archived', (ctx) => {
    const rows = [...db.projects.values()].filter((p) => p.archived).sort(byName);
    return { body: paginate(rows.map(projectView), ctx.query) };
  });

  app.get('/invoices/overdue', (ctx) => {
    const rows = [...db.invoices.values()].filter(isOverdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  // ---------------------------------------------------------------- users

  app.get('/users', (ctx) => {
    let rows = [...db.users.values()];
    if (ctx.query.role) rows = rows.filter((u) => u.role === ctx.query.role);
    if (ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q));
    }
    return { body: paginate(rows.sort(byName).map(userView), ctx.query) };
  });

  app.get('/users/:id', (ctx) => ({ body: userView(getOr404('users', 'user', ctx.params.id)) }));

  app.get('/users/:id/projects', (ctx) => {
    const user = getOr404('users', 'user', ctx.params.id);
    const rows = [...db.projects.values()].filter((p) => p.ownerId === user.id && !p.archived).sort(byName);
    return { body: paginate(rows.map(projectView), ctx.query) };
  });

  app.post('/users', (ctx) => {
    requireAdmin(ctx);
    const name = requireString(ctx.body, 'name');
    const email = requireString(ctx.body, 'email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('email is invalid');
    if ([...db.users.values()].some((u) => u.email === email)) throw conflict(`email ${email} is taken`);
    const role = ctx.body.role === undefined ? 'member' : requireEnum(ctx.body, 'role', ROLES);
    const user = db.insert('users', 'usr', { name, email, role });
    record(ctx, 'user.create', user.id);
    return { status: 201, body: userView(user) };
  });

  app.patch('/users/:id', (ctx) => {
    const user = getOr404('users', 'user', ctx.params.id);
    if (ctx.user.id !== user.id) requireAdmin(ctx);
    const name = optionalString(ctx.body, 'name');
    if (name !== undefined) user.name = name;
    if (ctx.body && ctx.body.role !== undefined) {
      requireAdmin(ctx);
      user.role = requireEnum(ctx.body, 'role', ROLES);
    }
    record(ctx, 'user.update', user.id);
    return { body: userView(user) };
  });

  app.delete('/users/:id', (ctx) => {
    requireAdmin(ctx);
    const user = getOr404('users', 'user', ctx.params.id);
    if (user.id === ctx.user.id) throw badRequest('cannot delete yourself');
    const owned = [...db.projects.values()].filter((p) => p.ownerId === user.id && !p.archived);
    if (owned.length) throw conflict(`user owns ${owned.length} active project(s)`);
    db.users.delete(user.id);
    record(ctx, 'user.delete', user.id);
    return { status: 204 };
  });

  // ---------------------------------------------------------------- projects

  app.get('/projects', (ctx) => {
    let rows = [...db.projects.values()].filter((p) => !p.archived);
    if (ctx.query.tag) {
      const tag = [...db.tags.values()].find((t) => t.name === ctx.query.tag);
      rows = tag ? rows.filter((p) => p.tagIds.includes(tag.id)) : [];
    }
    if (ctx.query.owner) rows = rows.filter((p) => p.ownerId === ctx.query.owner);
    return { body: paginate(rows.sort(byName).map(projectView), ctx.query) };
  });

  app.get('/projects/:id', (ctx) => ({ body: projectView(getOr404('projects', 'project', ctx.params.id)) }));

  app.get('/projects/:id/summary', (ctx) => ({ body: projectSummary(getOr404('projects', 'project', ctx.params.id)) }));

  app.get('/projects/:id/invoices', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    const rows = invoicesFor(p.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  app.post('/projects', (ctx) => {
    const name = requireString(ctx.body, 'name', { max: 80 });
    if ([...db.projects.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw conflict(`project ${name} exists`);
    }
    const ownerId = ctx.body.ownerId === undefined ? ctx.user.id : getOr404('users', 'user', ctx.body.ownerId).id;
    const project = db.insert('projects', 'prj', { name, ownerId, archived: false, tagIds: [] });
    record(ctx, 'project.create', project.id);
    return { status: 201, body: projectView(project) };
  });

  app.patch('/projects/:id', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    if (p.ownerId !== ctx.user.id) requireAdmin(ctx);
    const name = optionalString(ctx.body, 'name', { max: 80 });
    if (name !== undefined) p.name = name;
    if (ctx.body && ctx.body.ownerId !== undefined) p.ownerId = getOr404('users', 'user', ctx.body.ownerId).id;
    record(ctx, 'project.update', p.id);
    return { body: projectView(p) };
  });

  app.post('/projects/:id/archive', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    if (p.ownerId !== ctx.user.id) requireAdmin(ctx);
    if (invoicesFor(p.id).some((i) => i.status === 'open')) throw conflict('project has open invoices');
    p.archived = true;
    record(ctx, 'project.archive', p.id);
    return { body: projectView(p) };
  });

  app.post('/projects/:id/tags', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    const tag = getOr404('tags', 'tag', requireString(ctx.body, 'tagId'));
    if (!p.tagIds.includes(tag.id)) p.tagIds.push(tag.id);
    record(ctx, 'project.tag', p.id);
    return { body: projectView(p) };
  });

  app.delete('/projects/:id/tags/:tagId', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    p.tagIds = p.tagIds.filter((t) => t !== ctx.params.tagId);
    record(ctx, 'project.untag', p.id);
    return { body: projectView(p) };
  });

  // ---------------------------------------------------------------- invoices

  app.get('/invoices', (ctx) => {
    let rows = [...db.invoices.values()];
    if (ctx.query.status) rows = rows.filter((i) => i.status === ctx.query.status);
    if (ctx.query.project) rows = rows.filter((i) => i.projectId === ctx.query.project);
    rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  app.get('/invoices/:id', (ctx) => ({ body: invoiceView(getOr404('invoices', 'invoice', ctx.params.id)) }));

  app.post('/invoices', (ctx) => {
    requireAdmin(ctx);
    const project = getOr404('projects', 'project', requireString(ctx.body, 'projectId'));
    if (project.archived) throw conflict('project is archived');
    const amountCents = requireInt(ctx.body, 'amountCents', { min: 1 });
    const dueDate = requireDate(ctx.body, 'dueDate');
    const invoice = db.insert('invoices', 'inv', { projectId: project.id, amountCents, dueDate, status: 'open' });
    summaryCache.delete(project.id);
    record(ctx, 'invoice.create', invoice.id);
    return { status: 201, body: invoiceView(invoice) };
  });

  app.patch('/invoices/:id', (ctx) => {
    requireAdmin(ctx);
    const inv = getOr404('invoices', 'invoice', ctx.params.id);
    if (inv.status === 'void') throw conflict('invoice is void');
    if (ctx.body && ctx.body.status !== undefined) inv.status = requireEnum(ctx.body, 'status', INVOICE_STATUSES);
    if (ctx.body && ctx.body.dueDate !== undefined) inv.dueDate = requireDate(ctx.body, 'dueDate');
    summaryCache.delete(inv.projectId);
    record(ctx, 'invoice.update', inv.id);
    return { body: invoiceView(inv) };
  });

  app.post('/invoices/:id/pay', (ctx) => {
    requireAdmin(ctx);
    const inv = getOr404('invoices', 'invoice', ctx.params.id);
    if (inv.status !== 'open') throw conflict(`invoice is ${inv.status}`);
    inv.status = 'paid';
    summaryCache.delete(inv.projectId);
    record(ctx, 'invoice.pay', inv.id);
    return { body: invoiceView(inv) };
  });

  // ---------------------------------------------------------------- tags

  app.get('/tags', (ctx) => {
    const rows = [...db.tags.values()].sort(byName).map((t) => ({
      id: t.id,
      name: t.name,
      projects: [...db.projects.values()].filter((p) => p.tagIds.includes(t.id)).length,
    }));
    return { body: paginate(rows, ctx.query) };
  });

  app.post('/tags', (ctx) => {
    const name = requireString(ctx.body, 'name', { max: 30 }).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) throw badRequest('tag names are lowercase letters, digits and dashes');
    if ([...db.tags.values()].some((t) => t.name === name)) throw conflict(`tag ${name} exists`);
    const tag = db.insert('tags', 'tag', { name });
    record(ctx, 'tag.create', tag.id);
    return { status: 201, body: { id: tag.id, name: tag.name, projects: 0 } };
  });

  app.delete('/tags/:id', (ctx) => {
    requireAdmin(ctx);
    const tag = getOr404('tags', 'tag', ctx.params.id);
    for (const p of db.projects.values()) p.tagIds = p.tagIds.filter((t) => t !== tag.id);
    db.tags.delete(tag.id);
    record(ctx, 'tag.delete', tag.id);
    return { status: 204 };
  });

  // ---------------------------------------------------------------- health / admin

  app.get('/health', () => ({ body: { ok: true, version: VERSION } }));

  app.get('/health/stats', () => ({
    body: {
      requests: stats.requests,
      byResource: Object.fromEntries(Object.entries(stats.byResource).sort(([a], [b]) => a.localeCompare(b))),
    },
  }));

  app.get('/audit', (ctx) => {
    requireAdmin(ctx);
    return { body: paginate(audit.slice().reverse(), ctx.query) };
  });

  return app;
}

module.exports = { createApp, VERSION };
__FX__
mkdir -p bin
cat > bin/serve.js <<'__FX__'
#!/usr/bin/env node
'use strict';
const http = require('node:http');
const { createApp } = require('../server');

const app = createApp();
const port = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: 'bad_json', message: 'invalid JSON' } }));
      }
      const out = app.handle({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.body === undefined ? '' : JSON.stringify(out.body));
    });
  })
  .listen(port, () => console.log(`taskboard listening on :${port}`));
__FX__
mkdir -p test
cat > test/assert.js <<'__FX__'
'use strict';
const assert = require('node:assert/strict');
const { createApp } = require('../server');

function call(app, method, url, user, body) {
  return app.handle({ method, url, headers: user ? { 'x-user': user } : {}, body });
}

module.exports = { assert, createApp, call };
__FX__
mkdir -p test
cat > test/users.test.js <<'__FX__'
'use strict';
const { assert, createApp, call } = require('./assert');

test('users: list is sorted by name and paginated', () => {
  const r = call(createApp(), 'GET', '/users?limit=2', 'usr_1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((u) => u.name), ['Ada Lovelace', 'Bob Stone']);
  assert.equal(r.body.total, 4);
});

test('users: members cannot create users', () => {
  const r = call(createApp(), 'POST', '/users', 'usr_2', { name: 'X', email: 'x@example.com' });
  assert.equal(r.status, 403);
});

test('users: duplicate email is a conflict', () => {
  const r = call(createApp(), 'POST', '/users', 'usr_1', { name: 'Ada 2', email: 'ADA@example.com' });
  assert.equal(r.status, 409);
});

test('users: cannot delete an owner of active projects', () => {
  const r = call(createApp(), 'DELETE', '/users/usr_3', 'usr_1');
  assert.equal(r.status, 409);
});
__FX__
mkdir -p test
cat > test/projects.test.js <<'__FX__'
'use strict';
const { assert, createApp, call } = require('./assert');

test('projects: archived projects are hidden from the list', () => {
  const r = call(createApp(), 'GET', '/projects', 'usr_2');
  assert.deepEqual(r.body.items.map((p) => p.name), ['Brand book', 'Data center move', 'Website relaunch']);
});

test('projects: cannot archive with open invoices', () => {
  const r = call(createApp(), 'POST', '/projects/prj_1/archive', 'usr_1');
  assert.equal(r.status, 409);
});

test('projects: owner can rename', () => {
  const app = createApp();
  const r = call(app, 'PATCH', '/projects/prj_4', 'usr_3', { name: 'Brand book v2' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Brand book v2');
});

test('projects: summary ignores void invoices', () => {
  const app = createApp();
  assert.equal(call(app, 'PATCH', '/invoices/inv_2', 'usr_1', { status: 'void' }).status, 200);
  const r = call(app, 'GET', '/projects/prj_1/summary', 'usr_1');
  assert.equal(r.body.invoices, 1);
  assert.equal(r.body.billed, 'EUR 1,200.00');
});
__FX__
mkdir -p test
cat > test/invoices.test.js <<'__FX__'
'use strict';
const { assert, createApp, call } = require('./assert');

test('invoices: amounts are formatted', () => {
  const r = call(createApp(), 'GET', '/invoices/inv_3', 'usr_1');
  assert.equal(r.body.amount, 'EUR 9,900.00');
});

test('invoices: due date must be YYYY-MM-DD', () => {
  const r = call(createApp(), 'POST', '/invoices', 'usr_1', { projectId: 'prj_1', amountCents: 100, dueDate: '1/2/2026' });
  assert.equal(r.status, 400);
});

test('invoices: paying twice is a conflict', () => {
  const app = createApp();
  assert.equal(call(app, 'POST', '/invoices/inv_2/pay', 'usr_1').status, 200);
  assert.equal(call(app, 'POST', '/invoices/inv_2/pay', 'usr_1').status, 409);
});
__FX__
mkdir -p test
cat > test/tags.test.js <<'__FX__'
'use strict';
const { assert, createApp, call } = require('./assert');

test('tags: names are normalised to lowercase', () => {
  const r = call(createApp(), 'POST', '/tags', 'usr_2', { name: 'Infra' });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, 'infra');
});

test('tags: list counts projects', () => {
  const r = call(createApp(), 'GET', '/tags', 'usr_2');
  assert.deepEqual(r.body.items.map((t) => `${t.name}:${t.projects}`), ['legal:0', 'ops:1', 'web:2']);
});
__FX__
mkdir -p test
cat > test/health.test.js <<'__FX__'
'use strict';
const { assert, createApp, call } = require('./assert');

test('health: no auth needed', () => {
  const r = call(createApp(), 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('health: unknown user is 401', () => {
  assert.equal(call(createApp(), 'GET', '/projects', 'usr_42').status, 401);
});

test('health: stats count this app only', () => {
  const app = createApp();
  call(app, 'GET', '/health');
  call(app, 'GET', '/users', 'usr_1');
  const r = call(app, 'GET', '/health/stats');
  assert.equal(r.body.requests, 3);
  assert.deepEqual(r.body.byResource, { health: 2, users: 1 });
});
__FX__
mkdir -p test
cat > test/run.js <<'__FX__'
'use strict';
// Test entry point (npm test). Runs the unit tests, then the smoke replay.
// Writes a short summary to .test-results.txt for CI.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const results = [];
global.test = (name, fn) => results.push({ name, fn });

for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, f));
}

let passed = 0;
let failed = 0;
for (const t of results) {
  try {
    t.fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.log(`not ok - ${t.name}\n  ${err.message}`);
  }
}
console.log(`unit: ${passed} passed, ${failed} failed`);

const smoke = require('./smoke').run();
for (const m of smoke.mismatches) {
  console.log(`smoke #${m.i} ${(m.actual && m.actual.req) || ''}\n  expected ${JSON.stringify(m.expected)}\n  actual   ${JSON.stringify(m.actual)}`);
}
const smokeLine = `smoke: ${smoke.count} requests, ${smoke.mismatches.length} mismatches [${smoke.digest}]`;
console.log(smokeLine);

// Which app modules the run actually exercised (helps spot dead files).
const modules = Object.keys(require.cache)
  .map((f) => path.relative(root, f))
  .filter((f) => !f.startsWith('test') && !f.startsWith('..') && !f.includes('node_modules'))
  .sort();
const modulesLine = `modules: ${modules.join(' ')}`;
console.log(modulesLine);

fs.writeFileSync(path.join(root, '.test-results.txt'), `unit: ${passed} passed, ${failed} failed\n${smokeLine}\n${modulesLine}\n`);
process.exitCode = failed || smoke.mismatches.length ? 1 : 0;
__FX__
mkdir -p test
cat > test/smoke.js <<'__FX__'
'use strict';
// Replays test/smoke/requests.json against a fresh app and compares every
// response with test/smoke/golden.json. `node test/smoke.js --update` rewrites
// the golden file (only do that for intentional API changes).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');

function replay() {
  const app = createApp();
  const requests = JSON.parse(fs.readFileSync(path.join(__dirname, 'smoke/requests.json'), 'utf8'));
  return requests.map((r) => {
    const headers = r.user ? { 'x-user': r.user } : {};
    const res = app.handle({ method: r.method, url: r.url, headers, body: r.body });
    return { req: `${r.method} ${r.url}`, status: res.status, body: res.body === undefined ? null : res.body };
  });
}

function run() {
  const actual = replay();
  const goldenPath = path.join(__dirname, 'smoke/golden.json');
  if (process.argv.includes('--update')) {
    fs.writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n');
    console.log(`golden updated (${actual.length} responses)`);
    return null;
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const mismatches = [];
  actual.forEach((a, i) => {
    if (JSON.stringify(a) !== JSON.stringify(golden[i])) mismatches.push({ i, expected: golden[i], actual: a });
  });
  if (golden.length !== actual.length) mismatches.push({ i: -1, expected: golden.length, actual: actual.length });
  const digest = crypto.createHash('sha1').update(JSON.stringify(actual)).digest('hex').slice(0, 10);
  return { count: actual.length, mismatches, digest };
}

module.exports = { run, replay };

if (require.main === module) {
  const r = run();
  if (r) {
    for (const m of r.mismatches) {
      console.log(`#${m.i} ${m.actual.req || ''}\n  expected ${JSON.stringify(m.expected)}\n  actual   ${JSON.stringify(m.actual)}`);
    }
    console.log(`smoke: ${r.count} requests, ${r.mismatches.length} mismatches [${r.digest}]`);
  }
}
__FX__
mkdir -p test/smoke
cat > test/smoke/requests.json <<'__FX__'
[
  { "method": "GET", "url": "/health" },
  { "method": "GET", "url": "/users" },
  { "method": "GET", "url": "/users", "user": "usr_9" },
  { "method": "GET", "url": "/users/me", "user": "usr_2" },
  { "method": "GET", "url": "/users?role=member&limit=2", "user": "usr_1" },
  { "method": "GET", "url": "/users/usr_3", "user": "usr_1" },
  { "method": "GET", "url": "/users/usr_2/projects", "user": "usr_1" },
  { "method": "GET", "url": "/projects", "user": "usr_2" },
  { "method": "GET", "url": "/projects/archived", "user": "usr_2" },
  { "method": "GET", "url": "/projects?tag=web", "user": "usr_2" },
  { "method": "GET", "url": "/projects/prj_1", "user": "usr_2" },
  { "method": "GET", "url": "/projects/prj_1/summary", "user": "usr_1" },
  { "method": "GET", "url": "/invoices/overdue", "user": "usr_1" },
  { "method": "POST", "url": "/invoices", "user": "usr_2", "body": { "projectId": "prj_1", "amountCents": 5000, "dueDate": "2026-04-01" } },
  { "method": "POST", "url": "/invoices", "user": "usr_1", "body": { "projectId": "prj_1", "amountCents": 7550, "dueDate": "2026-02-01" } },
  { "method": "GET", "url": "/projects/prj_1/summary", "user": "usr_1" },
  { "method": "POST", "url": "/invoices/inv_1/pay", "user": "usr_1" },
  { "method": "GET", "url": "/projects/prj_1/summary", "user": "usr_1" },
  { "method": "GET", "url": "/invoices/overdue", "user": "usr_1" },
  { "method": "PATCH", "url": "/invoices/inv_4", "user": "usr_1", "body": { "status": "void" } },
  { "method": "GET", "url": "/projects/prj_2/summary", "user": "usr_1" },
  { "method": "GET", "url": "/invoices?status=open", "user": "usr_1" },
  { "method": "GET", "url": "/invoices/inv_99", "user": "usr_1" },
  { "method": "POST", "url": "/projects/prj_2/archive", "user": "usr_2" },
  { "method": "POST", "url": "/projects", "user": "usr_3", "body": { "name": "Partner portal" } },
  { "method": "POST", "url": "/projects", "user": "usr_3", "body": { "name": "partner portal" } },
  { "method": "GET", "url": "/tags", "user": "usr_3" },
  { "method": "POST", "url": "/tags", "user": "usr_3", "body": { "name": "Q2-Launch" } },
  { "method": "POST", "url": "/projects/prj_5/tags", "user": "usr_3", "body": { "tagId": "tag_4" } },
  { "method": "POST", "url": "/projects/prj_5/tags", "user": "usr_3", "body": { "tagId": "tag_1" } },
  { "method": "DELETE", "url": "/tags/tag_1", "user": "usr_3" },
  { "method": "DELETE", "url": "/tags/tag_1", "user": "usr_1" },
  { "method": "GET", "url": "/projects/prj_5", "user": "usr_3" },
  { "method": "PATCH", "url": "/users/usr_3", "user": "usr_3", "body": { "name": "Cy Young-Park" } },
  { "method": "PATCH", "url": "/users/usr_3", "user": "usr_3", "body": { "role": "admin" } },
  { "method": "POST", "url": "/users", "user": "usr_1", "body": { "name": "Eve Marsh", "email": "Eve@Example.com" } },
  { "method": "DELETE", "url": "/users/usr_2", "user": "usr_1" },
  { "method": "DELETE", "url": "/users/usr_4", "user": "usr_1" },
  { "method": "GET", "url": "/nope", "user": "usr_1" },
  { "method": "GET", "url": "/audit?limit=5", "user": "usr_1" },
  { "method": "GET", "url": "/health/stats" }
]
__FX__
node test/smoke.js --update >/dev/null
git add -A
commit "2026-01-12T10:00:00Z" "taskboard api: router, seeded db, users/projects/invoices/tags"

# --- docs: endpoint table
mkdir -p docs
cat > docs/api.md <<'__FX__'
# API

All list endpoints accept `limit` (max 50) and `offset` and return
`{ items, total, limit, offset }`. Errors are `{ error: { code, message } }`.

| method | path | notes |
| --- | --- | --- |
| GET | /health | public |
| GET | /health/stats | public; request counters and cache size |
| GET | /users | `role`, `q` filters |
| GET | /users/me | |
| GET | /users/:id | |
| GET | /users/:id/projects | active projects owned by the user |
| POST | /users | admin |
| PATCH | /users/:id | self or admin; role changes admin only |
| DELETE | /users/:id | admin; refuses owners of active projects |
| GET | /projects | `tag`, `owner` filters; archived hidden |
| GET | /projects/archived | |
| GET | /projects/:id | |
| GET | /projects/:id/summary | cached; invalidated by invoice writes |
| GET | /projects/:id/invoices | |
| POST | /projects | |
| PATCH | /projects/:id | owner or admin |
| POST | /projects/:id/archive | refuses projects with open invoices |
| POST | /projects/:id/tags | `{ tagId }` |
| DELETE | /projects/:id/tags/:tagId | |
| GET | /invoices | `status`, `project` filters |
| GET | /invoices/overdue | |
| GET | /invoices/:id | |
| POST | /invoices | admin |
| PATCH | /invoices/:id | admin |
| POST | /invoices/:id/pay | admin |
| GET | /tags | |
| POST | /tags | |
| DELETE | /tags/:id | admin; detaches from projects |
| GET | /audit | admin |
__FX__
git add -A
commit "2026-01-20T15:30:00Z" "docs: endpoint table"

# --- docs: architecture notes and contributing
mkdir -p docs
cat > docs/architecture.md <<'__FX__'
# Architecture

- `lib/router.js`: tiny router. Routes are matched in registration order and the
  first match wins. Middleware runs before matching.
- `lib/db.js`: seeded in-memory tables (`Map`s) plus `insert()`.
- `server.js`: `createApp()` builds everything: middleware, helpers and all routes.
- `bin/serve.js`: node:http adapter.

Every `createApp()` call gets its own db, stats, caches and audit log, so tests
can create as many apps as they like.
__FX__
cat > CONTRIBUTING.md <<'__FX__'
# Contributing

- Run `npm test` before pushing. The smoke replay must stay at 0 mismatches.
  Only regenerate `test/smoke/golden.json` (`node test/smoke.js --update`) for an
  intentional API change, and say so in the PR.
- No dependencies.
- Keep handlers synchronous; the router does not await.
__FX__
git add -A
commit "2026-02-03T09:10:00Z" "docs: architecture notes and contributing"

# --- health/stats: report number of cached project summaries
cat > server.js <<'__FX__'
'use strict';
// taskboard API. createApp() wires the router, middleware and every route.
// bin/serve.js puts it behind node:http; tests drive app.handle() directly.

const { createRouter } = require('./lib/router');
const { createDb } = require('./lib/db');
const { HttpError, notFound, badRequest, conflict } = require('./lib/errors');
const { paginate } = require('./lib/paginate');
const { requireString, optionalString, requireInt, requireDate, requireEnum } = require('./lib/validate');
const { formatCents } = require('./lib/money');

const VERSION = require('./package.json').version;
const ROLES = ['admin', 'member'];
const INVOICE_STATUSES = ['open', 'paid', 'void'];

function createApp(opts = {}) {
  const db = opts.db || createDb();
  const clock = opts.clock || (() => new Date('2026-03-01T12:00:00Z'));
  const app = createRouter();

  // Shared between handlers: request stats (reported by /health/stats), the
  // per-project summary cache, and the audit log.
  const stats = { requests: 0, byResource: {} };
  const summaryCache = new Map();
  const audit = [];

  // ---------------------------------------------------------------- middleware

  app.use((ctx) => {
    stats.requests += 1;
    const resource = ctx.path.split('/')[1] || 'root';
    stats.byResource[resource] = (stats.byResource[resource] || 0) + 1;
  });

  app.use((ctx) => {
    if (ctx.path === '/health' || ctx.path === '/health/stats') return;
    const uid = ctx.headers['x-user'];
    if (!uid) throw new HttpError(401, 'unauthenticated', 'x-user header required');
    const user = db.users.get(uid);
    if (!user) throw new HttpError(401, 'unauthenticated', `unknown user ${uid}`);
    ctx.user = user;
  });

  // ---------------------------------------------------------------- helpers

  function requireAdmin(ctx) {
    if (ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'admin only');
  }

  function record(ctx, action, id) {
    audit.push({ at: clock().toISOString(), by: ctx.user.id, action, id });
  }

  function getOr404(table, what, id) {
    const row = db[table].get(id);
    if (!row) throw notFound(what, id);
    return row;
  }

  function userView(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  }

  function projectView(p) {
    const owner = db.users.get(p.ownerId);
    return {
      id: p.id,
      name: p.name,
      owner: owner ? { id: owner.id, name: owner.name } : null,
      archived: p.archived,
      tags: p.tagIds.map((t) => db.tags.get(t)).filter(Boolean).map((t) => t.name).sort(),
    };
  }

  function invoiceView(i) {
    return {
      id: i.id,
      projectId: i.projectId,
      amountCents: i.amountCents,
      amount: formatCents(i.amountCents),
      dueDate: i.dueDate,
      status: i.status,
      overdue: isOverdue(i),
    };
  }

  function isOverdue(i) {
    return i.status === 'open' && i.dueDate < clock().toISOString().slice(0, 10);
  }

  function invoicesFor(projectId) {
    return [...db.invoices.values()].filter((i) => i.projectId === projectId);
  }

  function projectSummary(p) {
    if (summaryCache.has(p.id)) return summaryCache.get(p.id);
    const invoices = invoicesFor(p.id).filter((i) => i.status !== 'void');
    const billed = invoices.reduce((s, i) => s + i.amountCents, 0);
    const outstanding = invoices.filter((i) => i.status === 'open').reduce((s, i) => s + i.amountCents, 0);
    const summary = {
      projectId: p.id,
      invoices: invoices.length,
      billed: formatCents(billed),
      outstanding: formatCents(outstanding),
      overdue: invoices.filter(isOverdue).length,
    };
    summaryCache.set(p.id, summary);
    return summary;
  }

  function byName(a, b) {
    return a.name.localeCompare(b.name);
  }

  // ---------------------------------------------------------------- listings
  // Fixed paths that live next to an :id route of the same resource.

  app.get('/users/me', (ctx) => ({ body: userView(ctx.user) }));

  app.get('/projects/archived', (ctx) => {
    const rows = [...db.projects.values()].filter((p) => p.archived).sort(byName);
    return { body: paginate(rows.map(projectView), ctx.query) };
  });

  app.get('/invoices/overdue', (ctx) => {
    const rows = [...db.invoices.values()].filter(isOverdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  // ---------------------------------------------------------------- users

  app.get('/users', (ctx) => {
    let rows = [...db.users.values()];
    if (ctx.query.role) rows = rows.filter((u) => u.role === ctx.query.role);
    if (ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.includes(q));
    }
    return { body: paginate(rows.sort(byName).map(userView), ctx.query) };
  });

  app.get('/users/:id', (ctx) => ({ body: userView(getOr404('users', 'user', ctx.params.id)) }));

  app.get('/users/:id/projects', (ctx) => {
    const user = getOr404('users', 'user', ctx.params.id);
    const rows = [...db.projects.values()].filter((p) => p.ownerId === user.id && !p.archived).sort(byName);
    return { body: paginate(rows.map(projectView), ctx.query) };
  });

  app.post('/users', (ctx) => {
    requireAdmin(ctx);
    const name = requireString(ctx.body, 'name');
    const email = requireString(ctx.body, 'email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('email is invalid');
    if ([...db.users.values()].some((u) => u.email === email)) throw conflict(`email ${email} is taken`);
    const role = ctx.body.role === undefined ? 'member' : requireEnum(ctx.body, 'role', ROLES);
    const user = db.insert('users', 'usr', { name, email, role });
    record(ctx, 'user.create', user.id);
    return { status: 201, body: userView(user) };
  });

  app.patch('/users/:id', (ctx) => {
    const user = getOr404('users', 'user', ctx.params.id);
    if (ctx.user.id !== user.id) requireAdmin(ctx);
    const name = optionalString(ctx.body, 'name');
    if (name !== undefined) user.name = name;
    if (ctx.body && ctx.body.role !== undefined) {
      requireAdmin(ctx);
      user.role = requireEnum(ctx.body, 'role', ROLES);
    }
    record(ctx, 'user.update', user.id);
    return { body: userView(user) };
  });

  app.delete('/users/:id', (ctx) => {
    requireAdmin(ctx);
    const user = getOr404('users', 'user', ctx.params.id);
    if (user.id === ctx.user.id) throw badRequest('cannot delete yourself');
    const owned = [...db.projects.values()].filter((p) => p.ownerId === user.id && !p.archived);
    if (owned.length) throw conflict(`user owns ${owned.length} active project(s)`);
    db.users.delete(user.id);
    record(ctx, 'user.delete', user.id);
    return { status: 204 };
  });

  // ---------------------------------------------------------------- projects

  app.get('/projects', (ctx) => {
    let rows = [...db.projects.values()].filter((p) => !p.archived);
    if (ctx.query.tag) {
      const tag = [...db.tags.values()].find((t) => t.name === ctx.query.tag);
      rows = tag ? rows.filter((p) => p.tagIds.includes(tag.id)) : [];
    }
    if (ctx.query.owner) rows = rows.filter((p) => p.ownerId === ctx.query.owner);
    return { body: paginate(rows.sort(byName).map(projectView), ctx.query) };
  });

  app.get('/projects/:id', (ctx) => ({ body: projectView(getOr404('projects', 'project', ctx.params.id)) }));

  app.get('/projects/:id/summary', (ctx) => ({ body: projectSummary(getOr404('projects', 'project', ctx.params.id)) }));

  app.get('/projects/:id/invoices', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    const rows = invoicesFor(p.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  app.post('/projects', (ctx) => {
    const name = requireString(ctx.body, 'name', { max: 80 });
    if ([...db.projects.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw conflict(`project ${name} exists`);
    }
    const ownerId = ctx.body.ownerId === undefined ? ctx.user.id : getOr404('users', 'user', ctx.body.ownerId).id;
    const project = db.insert('projects', 'prj', { name, ownerId, archived: false, tagIds: [] });
    record(ctx, 'project.create', project.id);
    return { status: 201, body: projectView(project) };
  });

  app.patch('/projects/:id', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    if (p.ownerId !== ctx.user.id) requireAdmin(ctx);
    const name = optionalString(ctx.body, 'name', { max: 80 });
    if (name !== undefined) p.name = name;
    if (ctx.body && ctx.body.ownerId !== undefined) p.ownerId = getOr404('users', 'user', ctx.body.ownerId).id;
    record(ctx, 'project.update', p.id);
    return { body: projectView(p) };
  });

  app.post('/projects/:id/archive', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    if (p.ownerId !== ctx.user.id) requireAdmin(ctx);
    if (invoicesFor(p.id).some((i) => i.status === 'open')) throw conflict('project has open invoices');
    p.archived = true;
    record(ctx, 'project.archive', p.id);
    return { body: projectView(p) };
  });

  app.post('/projects/:id/tags', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    const tag = getOr404('tags', 'tag', requireString(ctx.body, 'tagId'));
    if (!p.tagIds.includes(tag.id)) p.tagIds.push(tag.id);
    record(ctx, 'project.tag', p.id);
    return { body: projectView(p) };
  });

  app.delete('/projects/:id/tags/:tagId', (ctx) => {
    const p = getOr404('projects', 'project', ctx.params.id);
    p.tagIds = p.tagIds.filter((t) => t !== ctx.params.tagId);
    record(ctx, 'project.untag', p.id);
    return { body: projectView(p) };
  });

  // ---------------------------------------------------------------- invoices

  app.get('/invoices', (ctx) => {
    let rows = [...db.invoices.values()];
    if (ctx.query.status) rows = rows.filter((i) => i.status === ctx.query.status);
    if (ctx.query.project) rows = rows.filter((i) => i.projectId === ctx.query.project);
    rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    return { body: paginate(rows.map(invoiceView), ctx.query) };
  });

  app.get('/invoices/:id', (ctx) => ({ body: invoiceView(getOr404('invoices', 'invoice', ctx.params.id)) }));

  app.post('/invoices', (ctx) => {
    requireAdmin(ctx);
    const project = getOr404('projects', 'project', requireString(ctx.body, 'projectId'));
    if (project.archived) throw conflict('project is archived');
    const amountCents = requireInt(ctx.body, 'amountCents', { min: 1 });
    const dueDate = requireDate(ctx.body, 'dueDate');
    const invoice = db.insert('invoices', 'inv', { projectId: project.id, amountCents, dueDate, status: 'open' });
    summaryCache.delete(project.id);
    record(ctx, 'invoice.create', invoice.id);
    return { status: 201, body: invoiceView(invoice) };
  });

  app.patch('/invoices/:id', (ctx) => {
    requireAdmin(ctx);
    const inv = getOr404('invoices', 'invoice', ctx.params.id);
    if (inv.status === 'void') throw conflict('invoice is void');
    if (ctx.body && ctx.body.status !== undefined) inv.status = requireEnum(ctx.body, 'status', INVOICE_STATUSES);
    if (ctx.body && ctx.body.dueDate !== undefined) inv.dueDate = requireDate(ctx.body, 'dueDate');
    summaryCache.delete(inv.projectId);
    record(ctx, 'invoice.update', inv.id);
    return { body: invoiceView(inv) };
  });

  app.post('/invoices/:id/pay', (ctx) => {
    requireAdmin(ctx);
    const inv = getOr404('invoices', 'invoice', ctx.params.id);
    if (inv.status !== 'open') throw conflict(`invoice is ${inv.status}`);
    inv.status = 'paid';
    summaryCache.delete(inv.projectId);
    record(ctx, 'invoice.pay', inv.id);
    return { body: invoiceView(inv) };
  });

  // ---------------------------------------------------------------- tags

  app.get('/tags', (ctx) => {
    const rows = [...db.tags.values()].sort(byName).map((t) => ({
      id: t.id,
      name: t.name,
      projects: [...db.projects.values()].filter((p) => p.tagIds.includes(t.id)).length,
    }));
    return { body: paginate(rows, ctx.query) };
  });

  app.post('/tags', (ctx) => {
    const name = requireString(ctx.body, 'name', { max: 30 }).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) throw badRequest('tag names are lowercase letters, digits and dashes');
    if ([...db.tags.values()].some((t) => t.name === name)) throw conflict(`tag ${name} exists`);
    const tag = db.insert('tags', 'tag', { name });
    record(ctx, 'tag.create', tag.id);
    return { status: 201, body: { id: tag.id, name: tag.name, projects: 0 } };
  });

  app.delete('/tags/:id', (ctx) => {
    requireAdmin(ctx);
    const tag = getOr404('tags', 'tag', ctx.params.id);
    for (const p of db.projects.values()) p.tagIds = p.tagIds.filter((t) => t !== tag.id);
    db.tags.delete(tag.id);
    record(ctx, 'tag.delete', tag.id);
    return { status: 204 };
  });

  // ---------------------------------------------------------------- health / admin

  app.get('/health', () => ({ body: { ok: true, version: VERSION } }));

  app.get('/health/stats', () => ({
    body: {
      requests: stats.requests,
      byResource: Object.fromEntries(Object.entries(stats.byResource).sort(([a], [b]) => a.localeCompare(b))),
      cachedSummaries: summaryCache.size,
    },
  }));

  app.get('/audit', (ctx) => {
    requireAdmin(ctx);
    return { body: paginate(audit.slice().reverse(), ctx.query) };
  });

  return app;
}

module.exports = { createApp, VERSION };
__FX__
node test/smoke.js --update >/dev/null
git add -A
commit "2026-02-11T13:45:00Z" "health/stats: report number of cached project summaries"

