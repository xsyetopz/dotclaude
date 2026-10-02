#!/usr/bin/env bash
# accounts-web: ESM login/logout/OAuth service with a shared post-auth redirect check.
set -euo pipefail
export GIT_AUTHOR_NAME="Noor Haddad" GIT_AUTHOR_EMAIL="noor@accounts.test"
export GIT_COMMITTER_NAME="Noor Haddad" GIT_COMMITTER_EMAIL="noor@accounts.test"
git init -q -b main .
git config user.name "Noor Haddad"; git config user.email "noor@accounts.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/lib src/routes config docs test scripts security

cat > package.json <<'EOF'
{
  "name": "accounts-web",
  "version": "3.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
.env
EOF
cat > .editorconfig <<'EOF'
root = true

[*]
indent_style = space
indent_size = 2
insert_final_newline = true
EOF
cat > README.md <<'EOF'
# accounts-web

Sign-in front door for app.example.com: login, logout and "connect your account" OAuth callbacks.
No framework, just `node:http` and a tiny router (src/http.js).

    npm start        listen on :8080
    npm test         unit tests

After a successful login/logout/OAuth connect we send the user to the `next` they came with,
if it is safe. The rule lives in src/lib/redirect.js; the policy is in docs/SECURITY.md.
EOF
cat > config/default.json <<'EOF'
{
  "port": 8080,
  "baseUrl": "https://app.example.com",
  "loginFallback": "/home",
  "logoutFallback": "https://example.com/",
  "sessionCookie": "aw_sid"
}
EOF
cat > src/config.js <<'EOF'
import fs from 'node:fs';

const file = new URL('../config/default.json', import.meta.url);
export const config = JSON.parse(fs.readFileSync(file, 'utf8'));
EOF
cat > src/http.js <<'EOF'
// Minimal router on top of node:http. Handlers get (req, res) where req.query is a URLSearchParams
// (already percent-decoded, like every framework) and res.redirect(location) sends a 302.
import { config } from './config.js';

export function createApp(routes) {
  return function handle(req, res) {
    const url = new URL(req.url, config.baseUrl);
    req.path = url.pathname;
    req.query = url.searchParams;
    res.redirect = (location) => {
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end();
    };
    res.json = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const route = routes[`${req.method} ${req.path}`];
    if (!route) return res.json(404, { error: 'not_found' });
    try {
      return route(req, res);
    } catch (err) {
      return res.json(500, { error: 'internal', message: err.message });
    }
  };
}
EOF
cat > src/lib/log.js <<'EOF'
export function log(event, fields = {}) {
  if (process.env.AW_QUIET) return;
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n');
}
EOF
cat > src/lib/session.js <<'EOF'
// Sessions are kept in memory here; production uses the shared redis store with the same interface.
import crypto from 'node:crypto';
import { config } from '../config.js';

const sessions = new Map();

export function readSession(req) {
  const cookie = req.headers?.cookie || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${config.sessionCookie}=([a-f0-9]{32})`));
  return m ? sessions.get(m[1]) || null : null;
}

export function startSession(res, user) {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, { user, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `${config.sessionCookie}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/`);
  return id;
}

export function endSession(req, res) {
  const cookie = req.headers?.cookie || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${config.sessionCookie}=([a-f0-9]{32})`));
  if (m) sessions.delete(m[1]);
  res.setHeader('Set-Cookie', `${config.sessionCookie}=; Max-Age=0; Path=/`);
}
EOF
cat > src/lib/redirect.js <<'EOF'
// Where we may send users after login. See docs/SECURITY.md.
const SAFE = /^(\/[^/]|https:\/\/([a-z0-9-]+\.)*example\.com)/i;

export function isSafeRedirect(target) {
  return typeof target === 'string' && (target === '/' || SAFE.test(target));
}

export function safeRedirect(target, fallback) {
  return isSafeRedirect(target) ? target : fallback;
}
EOF
cat > src/routes/health.js <<'EOF'
export function health(req, res) {
  res.json(200, { ok: true });
}
EOF
cat > src/routes/login.js <<'EOF'
// GET /login/complete?next=... is where the IdP sends the browser back after a successful sign-in.
import { config } from '../config.js';
import { startSession } from '../lib/session.js';
import { safeRedirect } from '../lib/redirect.js';
import { log } from '../lib/log.js';

export function loginComplete(req, res) {
  const user = req.query.get('user');
  if (!user) return res.json(400, { error: 'missing_user' });
  startSession(res, { id: user });
  const next = req.query.get('next');
  const location = safeRedirect(next, config.loginFallback);
  log('login.complete', { user, next, location });
  res.redirect(location);
}
EOF
cat > docs/SECURITY.md <<'EOF'
# Security notes

## Session cookie

`aw_sid`, HttpOnly, Secure, SameSite=Lax. Rotated on every login.

## Redirect targets (`next`)

Login, logout and the OAuth connect callback all redirect to a caller-supplied `next`.
Anything that is not clearly ours goes to the fallback instead (`/home` after login/OAuth,
`https://example.com/` after logout). A `next` is safe when it is one of:

- a path on app.example.com, written as a relative URL starting with a single `/`
  (`/settings`, `/billing?tab=invoices`);
- an absolute `https:` URL whose host is `example.com` or a subdomain of it, with no
  user/password part. Plain `http:` is not allowed.

Remember that browsers, not our regexes, decide where a Location header goes: they strip tabs and
newlines, treat `\` like `/` in http(s) URLs, and read `user@host` as a login for `host`.
EOF
cat > src/server.js <<'EOF'
import http from 'node:http';
import { config } from './config.js';
import { createApp } from './http.js';
import { health } from './routes/health.js';
import { loginComplete } from './routes/login.js';

const app = createApp({
  'GET /healthz': health,
  'GET /login/complete': loginComplete,
});

http.createServer(app).listen(config.port, () => {
  console.log(`accounts-web listening on :${config.port}`);
});
EOF
cat > test/redirect.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeRedirect, safeRedirect } from '../src/lib/redirect.js';

test('allows our own paths', () => {
  assert.equal(isSafeRedirect('/settings'), true);
  assert.equal(isSafeRedirect('/'), true);
});

test('allows example.com subdomains over https', () => {
  assert.equal(isSafeRedirect('https://docs.example.com/guide'), true);
});

test('rejects other sites and protocol-relative URLs', () => {
  assert.equal(isSafeRedirect('https://evil.io/'), false);
  assert.equal(isSafeRedirect('//evil.io'), false);
  assert.equal(isSafeRedirect(null), false);
});

test('safeRedirect falls back', () => {
  assert.equal(safeRedirect('https://evil.io/', '/home'), '/home');
});
EOF
cat > test/http.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http.js';

function fakeRes() {
  const headers = {};
  return { headers, statusCode: 200, setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
}

test('unknown route is a 404', () => {
  const res = fakeRes();
  createApp({})({ method: 'GET', url: '/nope', headers: {} }, res);
  assert.equal(res.statusCode, 404);
});

test('query is decoded', () => {
  const res = fakeRes();
  let seen;
  createApp({ 'GET /x': (req) => { seen = req.query.get('next'); } })({ method: 'GET', url: '/x?next=%2Fa%20b', headers: {} }, res);
  assert.equal(seen, '/a b');
});
EOF
commit "2026-03-02T10:12:00+01:00" "accounts-web: login completion with safe next redirect"

# --- logout with partner return URLs
cat > config/partners.json <<'EOF'
{
  "_comment": "Partner sites that may send users through our logout and get them back. Owned by partnerships (Lea).",
  "hosts": ["status.acmepay.io", "help.northwind-support.com"]
}
EOF
cat > src/routes/logout.js <<'EOF'
// GET /logout?next=... ends the session. Besides our own URLs, partners may ask to get their user back.
import fs from 'node:fs';
import { config } from '../config.js';
import { endSession } from '../lib/session.js';
import { isSafeRedirect } from '../lib/redirect.js';
import { log } from '../lib/log.js';

const partners = JSON.parse(fs.readFileSync(new URL('../../config/partners.json', import.meta.url), 'utf8'));
const PARTNER = new RegExp('^https://(' + partners.hosts.join('|') + ')');

export function logout(req, res) {
  endSession(req, res);
  const next = req.query.get('next');
  const ok = isSafeRedirect(next) || (typeof next === 'string' && PARTNER.test(next));
  const location = ok ? next : config.logoutFallback;
  log('logout', { next, location });
  res.redirect(location);
}
EOF
cat > test/logout.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logout } from '../src/routes/logout.js';

process.env.AW_QUIET = '1';

function run(next) {
  const headers = {};
  const req = { headers: {}, query: new URLSearchParams(next === undefined ? '' : { next }) };
  const res = { setHeader(k, v) { headers[k] = v; }, redirect(loc) { headers.Location = loc; } };
  logout(req, res);
  return headers.Location;
}

test('partners get their users back', () => {
  assert.equal(run('https://status.acmepay.io/incidents'), 'https://status.acmepay.io/incidents');
});

test('unknown sites go to the marketing site', () => {
  assert.equal(run('https://evil.io/'), 'https://example.com/');
  assert.equal(run(), 'https://example.com/');
});
EOF
cat >> docs/SECURITY.md <<'EOF'

After **logout** only, the hosts in `config/partners.json` are also allowed (https, exact host).
Partners are not allowed after login or OAuth.
EOF
sed -i.bak "s#import { loginComplete } from './routes/login.js';#import { loginComplete } from './routes/login.js';\nimport { logout } from './routes/logout.js';#; s#  'GET /login/complete': loginComplete,#  'GET /login/complete': loginComplete,\n  'GET /logout': logout,#" src/server.js && rm src/server.js.bak
commit "2026-06-11T15:40:00+02:00" "logout: return partner users to their site (PART-77)"

# --- mobile app callback + OAuth connect
cat > src/routes/oauth.js <<'EOF'
// GET /connect/callback?code=...&state=... finishes "connect your calendar/drive" flows.
// state is base64url(JSON) of { provider, next } that we created when starting the flow.
import { config } from '../config.js';
import { safeRedirect } from '../lib/redirect.js';
import { log } from '../lib/log.js';

function decodeState(raw) {
  try {
    return JSON.parse(Buffer.from(raw || '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function connectCallback(req, res) {
  const state = decodeState(req.query.get('state'));
  if (!state || !req.query.get('code')) return res.json(400, { error: 'bad_callback' });
  // token exchange happens in the connectors service; we only bounce the browser back
  const location = safeRedirect(state.next, config.loginFallback);
  log('connect.callback', { provider: state.provider, next: state.next, location });
  res.redirect(location);
}
EOF
cat > src/lib/redirect.js <<'EOF'
// Where we may send users after login/logout/connect. See docs/SECURITY.md.
// exampleapp://auth/... is the mobile app's login callback (MOB-140).
const SAFE = /^(\/[^/]|https:\/\/([a-z0-9-]+\.)*example\.com|exampleapp:\/\/auth)/i;

export function isSafeRedirect(target) {
  return typeof target === 'string' && (target === '/' || SAFE.test(target));
}

export function safeRedirect(target, fallback) {
  return isSafeRedirect(target) ? target : fallback;
}
EOF
cat >> docs/SECURITY.md <<'EOF'

The iOS/Android app signs in through the web flow and needs `exampleapp://auth/<anything>` as `next`
(MOB-140). Only the `auth` host of that scheme is ours.
EOF
sed -i.bak "s#import { logout } from './routes/logout.js';#import { logout } from './routes/logout.js';\nimport { connectCallback } from './routes/oauth.js';#; s#  'GET /logout': logout,#  'GET /logout': logout,\n  'GET /connect/callback': connectCallback,#" src/server.js && rm src/server.js.bak
cat > CHANGELOG.md <<'EOF'
# Changelog

## 3.4.0
- OAuth "connect" callback returns the user to where they started.
- Mobile app login callback (`exampleapp://auth/...`) allowed as `next` (MOB-140).

## 3.3.0
- Logout can send partner users back to their site (PART-77).

## 3.2.0
- Login completion redirects to `next` when safe.
EOF
commit "2026-08-19T11:05:00+02:00" "connect callback + mobile login callback (MOB-140)"

# --- security's replay corpus
cat > security/README.md <<'EOF'
# Redirect corpus

`redirect-corpus.txt` is security's replay list for every endpoint that redirects to a caller-supplied
URL: the inputs from reports we've received plus a standard open-redirect list. It is maintained by
the security team (Priya). Please don't edit it in feature work; put your own cases in test/.

Each line is `<route> <next as it appears in the query string>`. `npm run audit:redirects` sends every
line through the real route handler and prints where the browser would be sent (ALLOW = to `next`,
block = to the fallback), plus a digest of the whole run that security records with each release.
Whether a line should be allowed is decided by docs/SECURITY.md, not by this file.
EOF
cat > security/redirect-corpus.txt <<'EOF'
# reported (SEC-2291)
login https://app.example.com.evil.io/
login https://example.com@evil.io/
login /%5Cevil.io
# mobile
login exampleapp://auth/callback?code=xyz
login exampleapp://auth.evil.io/callback
login exampleapp://authx/
# standard list
login /settings
login /billing?tab=invoices%23plan
login /
login /u/@ana/settings
login https://app.example.com/projects/42
login https://docs.example.com/guide
login https://example.com/
login HTTPS://App.Example.COM/projects
login //evil.io
login /%09/evil.io
login %2F%2Fevil.io
login https://evilexample.com/
login https://example.com.evil.io
login http://app.example.com/projects
login javascript:alert(document.domain)
login JaVaScRiPt:alert(1)
login java%09script:alert(1)
login data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==
login https://evil.io/?u=https://app.example.com/
login https://status.acmepay.io/
connect /projects/42
connect https://app.example.com/after-connect
connect //evil.io/x
connect https://app.example.com.evil.io/
connect /%5C%5Cevil.io
connect https://help.northwind-support.com/kb/12
logout /goodbye
logout https://example.com/bye
logout https://status.acmepay.io/incidents
logout https://help.northwind-support.com/kb/12
logout https://status.acmepay.io.evil.io/
logout https://statusxacmepay.io/
logout https://help.northwind-support.com@evil.io/
logout //evil.io
logout http://status.acmepay.io/
logout https://evil.io/#https://status.acmepay.io
logout https://app.example.com.evil.io/
logout /%5Cevil.io
EOF
cat > scripts/audit-redirects.js <<'EOF'
// Replays security/redirect-corpus.txt through the real route handlers. See security/README.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { loginComplete } from '../src/routes/login.js';
import { logout } from '../src/routes/logout.js';
import { connectCallback } from '../src/routes/oauth.js';

process.env.AW_QUIET = '1';

const ROUTES = {
  login: { handler: loginComplete, fallback: config.loginFallback, query: (next) => `user=u1&next=${next}` },
  logout: { handler: logout, fallback: config.logoutFallback, query: (next) => `next=${next}` },
  connect: {
    handler: connectCallback,
    fallback: config.loginFallback,
    // the corpus value is query-encoded; state carries the decoded value, as the connect start page does
    query: (next) => {
      const decoded = new URLSearchParams(`n=${next}`).get('n');
      const state = Buffer.from(JSON.stringify({ provider: 'gcal', next: decoded })).toString('base64url');
      return `code=abc&state=${state}`;
    },
  },
};

function replay(route, next) {
  const r = ROUTES[route];
  const req = { method: 'GET', headers: {}, query: new URLSearchParams(r.query(next)) };
  let location;
  const res = {
    setHeader() {},
    redirect(loc) { location = loc; },
    json(status) { location = `HTTP ${status}`; },
  };
  try {
    r.handler(req, res);
  } catch (err) {
    return `ERROR ${err.message}`;
  }
  if (location === undefined || location.startsWith('HTTP ')) return `ERROR ${location || 'no response'}`;
  return location === r.fallback ? 'block' : 'ALLOW';
}

const lines = fs.readFileSync(new URL('../security/redirect-corpus.txt', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const results = [];
const counts = {};
for (const line of lines) {
  const [route, next] = line.split(' ');
  const verdict = replay(route, next);
  results.push(`${route}\t${verdict}\t${next}`);
  counts[route] ??= { cases: 0, allowed: 0 };
  counts[route].cases++;
  if (verdict === 'ALLOW') counts[route].allowed++;
  console.log(`${route.padEnd(8)}${verdict.padEnd(7)}${next}`);
}
const digest = crypto.createHash('sha256').update(results.sort().join('\n')).digest('hex').slice(0, 12);
const summary = Object.entries(counts).map(([r, c]) => `${r} ${c.cases} (${c.allowed} allowed)`).join(', ');
console.log(`redirect audit: ${summary}; audit digest ${digest}`);
EOF
sed -i.bak 's#    "test": "node --test test/"#    "test": "node --test test/",\n    "audit:redirects": "node scripts/audit-redirects.js"#' package.json && rm package.json.bak
cat >> README.md <<'EOF'
    npm run audit:redirects    replay security's redirect corpus (security/README.md)
EOF
commit "2026-09-24T09:30:00+02:00" "security: redirect replay corpus + audit script"

# --- uncommitted: Noor's half-written tests for SEC-2291
cat >> test/redirect.test.js <<'EOF'

// SEC-2291 (wip)
test('SEC-2291: rejects the lookalike host from the report', () => {
  assert.equal(isSafeRedirect('https://app.example.com.evil.io/'), false);
});

test('MOB-140: still allows the mobile login callback', () => {
  assert.equal(isSafeRedirect('exampleapp://auth/callback?code=1'), true);
});
EOF
