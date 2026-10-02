#!/usr/bin/env bash
# payhook: TypeScript (node type stripping, no build step) service that receives payment and shipping webhooks.
# Staging secrets live in a gitignored .env; last week's captured deliveries are committed under recorded/.
set -euo pipefail
export GIT_AUTHOR_NAME="Tomasz Wilk" GIT_AUTHOR_EMAIL="tomasz@payhook.test"
export GIT_COMMITTER_NAME="Tomasz Wilk" GIT_COMMITTER_EMAIL="tomasz@payhook.test"
git init -q -b main .
git config user.name "Tomasz Wilk"; git config user.email "tomasz@payhook.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/middleware src/webhooks src/api src/testing scripts recorded docs test

cat > .gitignore <<'EOF'
.env
node_modules/
EOF
cat > .env.example <<'EOF'
PORT=8080
PAYSTREAM_SECRET=
PARCELLY_SECRET=
EOF
cat > package.json <<'EOF'
{
  "name": "payhook",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.ts",
    "test": "node --test 'test/*.test.ts'",
    "replay": "node scripts/replay.ts"
  }
}
EOF
cat > README.md <<'EOF'
# payhook

Receives webhooks from Paystream (payments) and Parcelly (shipping) and keeps invoice / shipment state that
the billing UI reads through `/api/*`. TypeScript, run directly by node (type stripping, no build).

    npm start          serve on $PORT (secrets from .env, see .env.example)
    npm test
    npm run replay     run the captured staging deliveries in recorded/ through the app (uses .env secrets)

Provider signing rules: docs/WEBHOOKS.md. Request pipeline: docs/ARCHITECTURE.md.
EOF

cat > src/http.ts <<'EOF'
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Req = IncomingMessage & {
  id?: string;
  body?: unknown;
  rawBody?: Buffer;
  params?: Record<string, string>;
  query?: URLSearchParams;
};
export type Res = ServerResponse;
export type Next = () => Promise<void>;
export type Middleware = (req: Req, res: Res, next: Next) => Promise<void>;
export type Handler = (req: Req, res: Res) => Promise<void> | void;
export interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export function json(res: Res, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(text);
}

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function createApp(middleware: Middleware[], routes: Route[]) {
  return async function handle(req: Req, res: Res): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    req.query = url.searchParams;
    let route: Route | undefined;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const params = match(r.path, url.pathname);
      if (params) {
        req.params = params;
        route = r;
        break;
      }
    }
    let i = 0;
    const next: Next = async () => {
      if (i < middleware.length) await middleware[i++](req, res, next);
      else if (route) await route.handler(req, res);
      else json(res, 404, { error: 'not found' });
    };
    try {
      await next();
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    }
  };
}
EOF
cat > src/clock.ts <<'EOF'
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
EOF
cat > src/log.ts <<'EOF'
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, fields) => console.log(JSON.stringify({ level: 'info', msg, ...fields })),
  warn: (msg, fields) => console.log(JSON.stringify({ level: 'warn', msg, ...fields })),
};

export const silentLogger: Logger = { info() {}, warn() {} };
EOF
cat > src/config.ts <<'EOF'
import { existsSync, readFileSync } from 'node:fs';

export interface Config {
  port: number;
  paystreamSecret: string;
  parcellySecret: string;
}

// Minimal .env reader (KEY=value lines); real environment variables win.
export function loadEnvFile(file = '.env'): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = { ...loadEnvFile(), ...process.env }): Config {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`missing ${k}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8080),
    paystreamSecret: need('PAYSTREAM_SECRET'),
    parcellySecret: need('PARCELLY_SECRET'),
  };
}
EOF
cat > src/store.ts <<'EOF'
export interface Invoice {
  id: string;
  customer: string;
  amount_minor: number;
  currency: string;
  status: 'open' | 'paid' | 'partially_paid' | 'failed' | 'refunded';
  paid_minor: number;
}

export interface Shipment {
  id: string;
  invoice: string;
  status: string;
  eta: string | null;
}

export interface Seed {
  invoices: Invoice[];
  shipments: Shipment[];
}

export class Store {
  invoices = new Map<string, Invoice>();
  shipments = new Map<string, Shipment>();
  private events = new Set<string>();
  private nextId = 5000;

  constructor(seed: Seed = { invoices: [], shipments: [] }) {
    for (const i of seed.invoices) this.invoices.set(i.id, { ...i });
    for (const s of seed.shipments) this.shipments.set(s.id, { ...s });
  }

  seen(eventId: string): boolean {
    return this.events.has(eventId);
  }

  remember(eventId: string): void {
    this.events.add(eventId);
  }

  createInvoice(customer: string, amount_minor: number, currency: string): Invoice {
    const inv: Invoice = { id: 'inv_' + this.nextId++, customer, amount_minor, currency, status: 'open', paid_minor: 0 };
    this.invoices.set(inv.id, inv);
    return inv;
  }

  recordPayment(id: string, amount: number): void {
    const inv = this.invoices.get(id);
    if (!inv) return;
    inv.paid_minor += amount;
    inv.status = inv.paid_minor >= inv.amount_minor ? 'paid' : 'partially_paid';
  }

  markFailed(id: string): void {
    const inv = this.invoices.get(id);
    if (inv && inv.status === 'open') inv.status = 'failed';
  }

  refund(id: string, amount: number): void {
    const inv = this.invoices.get(id);
    if (!inv) return;
    inv.paid_minor -= amount;
    if (inv.paid_minor <= 0) inv.status = 'refunded';
  }

  updateShipment(id: string, status: string, eta: string | null): void {
    const s = this.shipments.get(id);
    if (s) Object.assign(s, { status, eta });
  }

  snapshot() {
    const byId = <T extends { id: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { invoices: byId(this.invoices), shipments: byId(this.shipments), events: [...this.events].sort() };
  }
}
EOF
cat > src/webhooks/verify.ts <<'EOF'
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Verdict = { valid: true } | { valid: false; reason: string };

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Paystream: `paystream-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>." + body)>`.
export function verifyPaystream(header: string, body: string | Buffer, secret: string, nowMs: number, toleranceSec = 300): Verdict {
  const parts = new Map(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!t || !v1) return { valid: false, reason: 'missing signature' };
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return { valid: false, reason: 'stale timestamp' };
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  return safeEqual(expected, v1) ? { valid: true } : { valid: false, reason: 'bad signature' };
}

// Parcelly: `x-parcelly-hmac: <base64 HMAC-SHA256(secret, body)>`.
export function verifyParcelly(header: string, body: string | Buffer, secret: string): Verdict {
  if (!header) return { valid: false, reason: 'missing signature' };
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  return safeEqual(expected, header) ? { valid: true } : { valid: false, reason: 'bad signature' };
}
EOF
cat > src/webhooks/paystream.ts <<'EOF'
import { json, type Route } from '../http.ts';
import type { Store } from '../store.ts';
import type { Config } from '../config.ts';
import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';
import { verifyPaystream } from './verify.ts';

interface PaystreamEvent {
  id: string;
  type: string;
  data: { invoice: string; amount_minor: number; currency: string };
}

export function paystreamRoute(store: Store, cfg: Config, clock: Clock, log: Logger): Route {
  return {
    method: 'POST',
    path: '/webhooks/paystream',
    handler(req, res) {
      const header = String(req.headers['paystream-signature'] ?? '');
      const verdict = verifyPaystream(header, req.rawBody ?? Buffer.alloc(0), cfg.paystreamSecret, clock.now());
      if (!verdict.valid) {
        log.warn('paystream webhook rejected', { reason: verdict.reason, request: req.id });
        return json(res, 401, { error: verdict.reason });
      }
      const evt = req.body as PaystreamEvent;
      if (store.seen(evt.id)) return json(res, 200, { duplicate: true });
      switch (evt.type) {
        case 'payment.succeeded':
          store.recordPayment(evt.data.invoice, evt.data.amount_minor);
          break;
        case 'payment.failed':
          store.markFailed(evt.data.invoice);
          break;
        case 'charge.refunded':
          store.refund(evt.data.invoice, evt.data.amount_minor);
          break;
        default:
          log.info('paystream event ignored', { type: evt.type });
      }
      store.remember(evt.id);
      json(res, 200, { ok: true });
    },
  };
}
EOF
cat > src/webhooks/parcelly.ts <<'EOF'
import { json, type Route } from '../http.ts';
import type { Store } from '../store.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import { verifyParcelly } from './verify.ts';

interface ParcellyEvent {
  event: string;
  shipment: { id: string; status: string; eta?: string | null };
}

export function parcellyRoute(store: Store, cfg: Config, log: Logger): Route {
  return {
    method: 'POST',
    path: '/webhooks/parcelly',
    handler(req, res) {
      const header = String(req.headers['x-parcelly-hmac'] ?? '');
      const verdict = verifyParcelly(header, req.rawBody ?? Buffer.alloc(0), cfg.parcellySecret);
      if (!verdict.valid) {
        log.warn('parcelly webhook rejected', { reason: verdict.reason, request: req.id });
        return json(res, 401, { error: verdict.reason });
      }
      const delivery = String(req.headers['x-parcelly-delivery'] ?? '');
      if (delivery && store.seen('parcelly:' + delivery)) return json(res, 200, { duplicate: true });
      const evt = req.body as ParcellyEvent;
      if (evt.event === 'shipment.updated') store.updateShipment(evt.shipment.id, evt.shipment.status, evt.shipment.eta ?? null);
      if (delivery) store.remember('parcelly:' + delivery);
      json(res, 200, { ok: true });
    },
  };
}
EOF
cat > src/middleware/requestId.ts <<'EOF'
import type { Middleware } from '../http.ts';

let counter = 0;

export const requestId: Middleware = async (req, res, next) => {
  req.id = String(req.headers['x-request-id'] ?? `req-${++counter}`);
  res.setHeader('x-request-id', req.id);
  await next();
};
EOF
cat > src/middleware/accessLog.ts <<'EOF'
import type { Middleware } from '../http.ts';
import type { Logger } from '../log.ts';

export function accessLog(log: Logger): Middleware {
  return async (req, res, next) => {
    await next();
    log.info('request', { method: req.method, url: req.url, status: res.statusCode, request: req.id });
  };
}
EOF
cat > src/middleware/body.ts <<'EOF'
import { json, type Middleware } from '../http.ts';

const LIMIT = 1024 * 1024;

// Buffers the request body. Webhook routes verify signatures over these exact bytes (req.rawBody);
// JSON bodies are also parsed into req.body.
export const readBody: Middleware = async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) return json(res, 413, { error: 'body too large' });
    chunks.push(chunk);
  }
  req.rawBody = Buffer.concat(chunks);
  const text = req.rawBody.toString('utf8');
  if (text && /\bjson\b/.test(String(req.headers['content-type'] ?? ''))) {
    try {
      req.body = JSON.parse(text);
    } catch {
      return json(res, 400, { error: 'invalid json' });
    }
  }
  await next();
};
EOF
cat > src/api/invoices.ts <<'EOF'
import { json, type Route } from '../http.ts';
import type { Store } from '../store.ts';

export function invoiceRoutes(store: Store): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/invoices/:id',
      handler(req, res) {
        const inv = store.invoices.get(req.params!.id);
        return inv ? json(res, 200, inv) : json(res, 404, { error: 'no such invoice' });
      },
    },
    {
      method: 'POST',
      path: '/api/invoices',
      handler(req, res) {
        const b = (req.body ?? {}) as { customer?: unknown; amount_minor?: unknown; currency?: unknown };
        if (typeof b.customer !== 'string' || !Number.isInteger(b.amount_minor) || typeof b.currency !== 'string') {
          return json(res, 422, { error: 'customer, amount_minor and currency are required' });
        }
        json(res, 201, store.createInvoice(b.customer, b.amount_minor as number, b.currency));
      },
    },
  ];
}
EOF
cat > src/app.ts <<'EOF'
import { createApp } from './http.ts';
import type { Store } from './store.ts';
import type { Config } from './config.ts';
import { systemClock, type Clock } from './clock.ts';
import { consoleLogger, type Logger } from './log.ts';
import { requestId } from './middleware/requestId.ts';
import { accessLog } from './middleware/accessLog.ts';
import { readBody } from './middleware/body.ts';
import { paystreamRoute } from './webhooks/paystream.ts';
import { parcellyRoute } from './webhooks/parcelly.ts';
import { invoiceRoutes } from './api/invoices.ts';

export interface Deps {
  store: Store;
  cfg: Config;
  clock?: Clock;
  log?: Logger;
}

export function buildApp({ store, cfg, clock = systemClock, log = consoleLogger }: Deps) {
  return createApp(
    [requestId, accessLog(log), readBody],
    [paystreamRoute(store, cfg, clock, log), parcellyRoute(store, cfg, log), ...invoiceRoutes(store)],
  );
}
EOF
cat > src/index.ts <<'EOF'
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { Store } from './store.ts';

const cfg = loadConfig();
const store = new Store(JSON.parse(readFileSync('recorded/seed.json', 'utf8')));
createServer(buildApp({ store, cfg })).listen(cfg.port, () => console.log(`payhook listening on :${cfg.port}`));
EOF
cat > src/testing/inject.ts <<'EOF'
import { Readable } from 'node:stream';
import type { Req, Res } from '../http.ts';

export interface Injected {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: any;
}

// Run one request through an app handler in-process (used by tests and scripts/replay.ts).
export async function inject(
  handle: (req: Req, res: Res) => Promise<void>,
  opts: { method: string; url: string; headers?: Record<string, string>; body?: Buffer | string },
): Promise<Injected> {
  const body = opts.body === undefined ? Buffer.alloc(0) : Buffer.from(opts.body);
  const req = Readable.from(body.length ? [body] : []) as unknown as Req;
  Object.assign(req, {
    method: opts.method,
    url: opts.url,
    headers: Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  });
  const headers: Record<string, string> = {};
  let text = '';
  let ended = false;
  const res = {
    statusCode: 200,
    get headersSent() {
      return ended;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = String(v);
    },
    end(chunk?: string) {
      text = chunk ?? '';
      ended = true;
    },
  } as unknown as Res;
  await handle(req, res);
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.statusCode, headers, text, json: parsed };
}
EOF
cat > test/helpers.ts <<'EOF'
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { silentLogger } from '../src/log.ts';

export const cfg = { port: 0, paystreamSecret: 'whsec_test_123', parcellySecret: 'pcl_test_456' };
export const NOW = Date.parse('2026-09-01T12:00:00Z');

export function setup() {
  const store = new Store({
    invoices: [{ id: 'inv_1', customer: 'Acme', amount_minor: 5000, currency: 'EUR', status: 'open', paid_minor: 0 }],
    shipments: [{ id: 'shp_1', invoice: 'inv_1', status: 'label_created', eta: null }],
  });
  const app = buildApp({ store, cfg, clock: { now: () => NOW }, log: silentLogger });
  return { store, app };
}

export function paystreamSig(body: string, t = Math.floor(NOW / 1000), secret = cfg.paystreamSecret): string {
  return `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

export function parcellySig(body: string, secret = cfg.parcellySecret): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}
EOF
cat > test/paystream.test.ts <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject } from '../src/testing/inject.ts';
import { setup, paystreamSig, NOW } from './helpers.ts';

const event = { id: 'evt_1', type: 'payment.succeeded', data: { invoice: 'inv_1', amount_minor: 5000, currency: 'EUR' } };

test('signed payment marks the invoice paid', async () => {
  const { app, store } = setup();
  const body = JSON.stringify(event);
  const r = await inject(app, { method: 'POST', url: '/webhooks/paystream', headers: { 'content-type': 'application/json', 'paystream-signature': paystreamSig(body) }, body });
  assert.equal(r.status, 200);
  assert.equal(store.invoices.get('inv_1')!.status, 'paid');
});

test('bad signature is rejected', async () => {
  const { app, store } = setup();
  const body = JSON.stringify(event);
  const r = await inject(app, { method: 'POST', url: '/webhooks/paystream', headers: { 'content-type': 'application/json', 'paystream-signature': paystreamSig(body, undefined, 'nope') }, body });
  assert.equal(r.status, 401);
  assert.equal(store.invoices.get('inv_1')!.status, 'open');
});

test('stale timestamp is rejected', async () => {
  const { app } = setup();
  const body = JSON.stringify(event);
  const r = await inject(app, { method: 'POST', url: '/webhooks/paystream', headers: { 'content-type': 'application/json', 'paystream-signature': paystreamSig(body, Math.floor(NOW / 1000) - 3600) }, body });
  assert.equal(r.status, 401);
});

test('duplicate event is applied once', async () => {
  const { app, store } = setup();
  const body = JSON.stringify({ ...event, data: { ...event.data, amount_minor: 2000 } });
  const headers = { 'content-type': 'application/json', 'paystream-signature': paystreamSig(body) };
  await inject(app, { method: 'POST', url: '/webhooks/paystream', headers, body });
  const r = await inject(app, { method: 'POST', url: '/webhooks/paystream', headers, body });
  assert.equal(r.json.duplicate, true);
  assert.equal(store.invoices.get('inv_1')!.paid_minor, 2000);
});
EOF
cat > test/parcelly.test.ts <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject } from '../src/testing/inject.ts';
import { setup, parcellySig } from './helpers.ts';

test('signed shipment update is applied', async () => {
  const { app, store } = setup();
  const body = JSON.stringify({ event: 'shipment.updated', shipment: { id: 'shp_1', status: 'in_transit', eta: '2026-09-03' } });
  const r = await inject(app, { method: 'POST', url: '/webhooks/parcelly', headers: { 'content-type': 'application/json', 'x-parcelly-hmac': parcellySig(body), 'x-parcelly-delivery': 'd1' }, body });
  assert.equal(r.status, 200);
  assert.equal(store.shipments.get('shp_1')!.status, 'in_transit');
});

test('unsigned shipment update is rejected', async () => {
  const { app, store } = setup();
  const body = JSON.stringify({ event: 'shipment.updated', shipment: { id: 'shp_1', status: 'delivered' } });
  const r = await inject(app, { method: 'POST', url: '/webhooks/parcelly', headers: { 'content-type': 'application/json' }, body });
  assert.equal(r.status, 401);
  assert.equal(store.shipments.get('shp_1')!.status, 'label_created');
});
EOF
cat > test/api.test.ts <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject } from '../src/testing/inject.ts';
import { setup } from './helpers.ts';

test('create and read an invoice', async () => {
  const { app } = setup();
  const body = JSON.stringify({ customer: 'Zoë GmbH', amount_minor: 1200, currency: 'EUR' });
  const c = await inject(app, { method: 'POST', url: '/api/invoices', headers: { 'content-type': 'application/json' }, body });
  assert.equal(c.status, 201);
  const g = await inject(app, { method: 'GET', url: '/api/invoices/' + c.json.id });
  assert.equal(g.json.customer, 'Zoë GmbH');
});

test('invalid json is a 400', async () => {
  const { app } = setup();
  const r = await inject(app, { method: 'POST', url: '/api/invoices', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(r.status, 400);
});

test('missing fields are a 422', async () => {
  const { app } = setup();
  const r = await inject(app, { method: 'POST', url: '/api/invoices', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 422);
});
EOF
cat > docs/WEBHOOKS.md <<'EOF'
# Webhooks

## Paystream (payments)

`POST /webhooks/paystream`, header `paystream-signature: t=<unix seconds>,v1=<hex>`.
`v1` is HMAC-SHA256 with the endpoint's signing secret over `<t>.` followed by the request body exactly as
sent. Reject when the timestamp is more than 5 minutes off. Paystream retries failed deliveries for 72 hours.

## Parcelly (shipping)

`POST /webhooks/parcelly`, header `x-parcelly-hmac: <base64 HMAC-SHA256(secret, body)>`, delivery id in
`x-parcelly-delivery` (used for de-duplication).

## Security requirements (SEC-118)

Unsigned or wrongly signed deliveries must get a 401 in every environment. There is no "skip verification"
switch, and the pen-test deliveries in `recorded/` must keep failing.
EOF
cat > docs/ARCHITECTURE.md <<'EOF'
# Request pipeline

`src/http.ts` is a tiny router: middleware run in order, then the matched route.

1. `requestId`: sets `req.id` / `x-request-id`
2. `accessLog`: one log line per request
3. body middleware: buffers the body, parses JSON into `req.body`

Routes: `/webhooks/paystream`, `/webhooks/parcelly`, `/api/invoices`, `/api/shipments`.
State is in-memory (`src/store.ts`), seeded from `recorded/seed.json` in dev.
EOF
commit "2026-08-11T10:20:00+02:00" "payhook: paystream + parcelly webhooks, invoices api"

cat > src/api/shipments.ts <<'EOF'
import { json, type Route } from '../http.ts';
import type { Store } from '../store.ts';

export function shipmentRoutes(store: Store): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/shipments/:id',
      handler(req, res) {
        const s = store.shipments.get(req.params!.id);
        return s ? json(res, 200, s) : json(res, 404, { error: 'no such shipment' });
      },
    },
  ];
}
EOF
sed -i.bak "s#^import { invoiceRoutes } from './api/invoices.ts';#import { invoiceRoutes } from './api/invoices.ts';\nimport { shipmentRoutes } from './api/shipments.ts';#; s#\.\.\.invoiceRoutes(store)\]#...invoiceRoutes(store), ...shipmentRoutes(store)]#" src/app.ts && rm src/app.ts.bak
cat > test/shipments.test.ts <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject } from '../src/testing/inject.ts';
import { setup } from './helpers.ts';

test('read a shipment', async () => {
  const { app } = setup();
  const r = await inject(app, { method: 'GET', url: '/api/shipments/shp_1' });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'label_created');
});
EOF
commit "2026-08-25T16:02:00+02:00" "api: shipments endpoint"

# Captured staging deliveries + seed, generated once here with the staging secrets (which go to the gitignored .env).
cat > .env <<'EOF'
PORT=8080
PAYSTREAM_SECRET=whsec_stg_4f1c9ab27e604d0b
PARCELLY_SECRET=pcl_stg_93d0e1f7aa21
EOF
cat > .gen.mjs <<'EOF'
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const PS = 'whsec_stg_4f1c9ab27e604d0b', PC = 'pcl_stg_93d0e1f7aa21';
const customers = ['Nordwind Logistik', 'Café Lumière', 'Brønd & Co', 'Kraków Bikes', 'Acme Ltd', 'Żabka Partner 12', 'Müller Bau', 'Riverside Dental'];
const invoices = customers.map((c, i) => ({ id: 'inv_' + (1001 + i), customer: c, amount_minor: [12900, 4500, 23000, 8800, 1500, 6000, 31000, 9900][i], currency: i % 3 ? 'EUR' : 'PLN', status: 'open', paid_minor: 0 }));
const shipments = invoices.slice(0, 6).map((inv, i) => ({ id: 'shp_' + (701 + i), invoice: inv.id, status: 'label_created', eta: null }));
writeFileSync('recorded/seed.json', JSON.stringify({ invoices, shipments }, null, 2) + '\n');
const esc = (s) => s.replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const spaced = (o) => JSON.stringify(o).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "').replace(/\{"/g, '{"');
const fmt = { compact: (o) => JSON.stringify(o), pretty: (o) => JSON.stringify(o, null, 2), spaced, escaped: (o) => esc(JSON.stringify(o)),
  float: (o) => JSON.stringify(o).replace('"fx_rate":"1.10"', '"fx_rate":1.10') };
let n = 0;
const out = [];
const at = (d, h, m) => `2026-09-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
function paystream(when, f, evt, mode = 'ok') {
  let raw = fmt[f](evt);
  let t = Math.floor(Date.parse(when) / 1000) - 1;
  if (mode === 'stale') t -= 7200;
  const sig = createHmac('sha256', mode === 'forged' ? 'whsec_guess_000' : PS).update(`${t}.${raw}`).digest('hex');
  if (mode === 'tampered') raw = raw.replace(/"amount_minor":\s*\d+/, '"amount_minor": 999999');
  out.push({ id: 'dlv_' + String(++n).padStart(4, '0'), provider: 'paystream', path: '/webhooks/paystream', received_at: when,
    headers: { 'content-type': 'application/json', 'paystream-signature': `t=${t},v1=${sig}`, 'user-agent': 'Paystream-Webhooks/3.2' }, body_b64: Buffer.from(raw).toString('base64') });
}
function parcelly(when, f, evt, delivery, mode = 'ok') {
  const raw = fmt[f](evt);
  const sig = createHmac('sha256', mode === 'forged' ? 'pcl_guess' : PC).update(raw).digest('base64');
  out.push({ id: 'dlv_' + String(++n).padStart(4, '0'), provider: 'parcelly', path: '/webhooks/parcelly', received_at: when,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-parcelly-hmac': sig, 'x-parcelly-delivery': delivery }, body_b64: Buffer.from(raw).toString('base64') });
}
const pay = (id, inv, amt, type = 'payment.succeeded', extra = {}) => ({ id, type, data: { invoice: inv, amount_minor: amt, currency: invoices.find((i) => i.id === inv).currency, ...extra } });
const cust = (inv) => invoices.find((i) => i.id === inv).customer;
const ship = (id, status, eta) => ({ event: 'shipment.updated', shipment: { id, status, eta } });
paystream(at(24, 8, 12), 'compact', pay('evt_9a01', 'inv_1005', 1500));
parcelly(at(24, 9, 40), 'compact', ship('shp_705', 'in_transit', '2026-09-26'), 'pd_3101');
paystream(at(24, 11, 3), 'pretty', pay('evt_9a02', 'inv_1001', 12900, 'payment.succeeded', { customer_name: cust('inv_1001') }));
paystream(at(25, 7, 55), 'compact', pay('evt_9a03', 'inv_1008', 9900));
paystream(at(25, 10, 20), 'escaped', pay('evt_9a04', 'inv_1002', 4500, 'payment.succeeded', { customer_name: cust('inv_1002') }));
parcelly(at(25, 13, 1), 'spaced', ship('shp_701', 'in_transit', '2026-09-27'), 'pd_3102');
paystream(at(26, 9, 14), 'compact', pay('evt_9a05', 'inv_1007', 31000), 'forged');
paystream(at(26, 9, 30), 'spaced', pay('evt_9a06', 'inv_1003', 10000, 'payment.succeeded', { customer_name: cust('inv_1003') }));
parcelly(at(26, 15, 45), 'pretty', ship('shp_702', 'delivered', null), 'pd_3103');
paystream(at(27, 6, 2), 'compact', pay('evt_9a07', 'inv_1004', 8800, 'payment.failed'));
paystream(at(27, 6, 3), 'compact', pay('evt_9a07', 'inv_1004', 8800, 'payment.failed'));
paystream(at(27, 12, 31), 'float', pay('evt_9a08', 'inv_1006', 6000, 'payment.succeeded', { fx_rate: '1.10', customer_name: cust('inv_1006') }));
parcelly(at(28, 8, 8), 'escaped', ship('shp_703', 'exception', '2026-10-01'), 'pd_3104');
parcelly(at(28, 8, 9), 'compact', ship('shp_704', 'delivered', null), 'pd_3105', 'forged');
paystream(at(28, 14, 50), 'compact', pay('evt_9a09', 'inv_1005', 1500, 'charge.refunded'), 'tampered');
paystream(at(29, 9, 12), 'pretty', pay('evt_9a10', 'inv_1003', 13000, 'payment.succeeded', { customer_name: cust('inv_1003') }));
paystream(at(29, 16, 5), 'compact', pay('evt_9a11', 'inv_1007', 31000), 'stale');
parcelly(at(29, 17, 30), 'spaced', ship('shp_706', 'in_transit', '2026-10-02'), 'pd_3106');
paystream(at(30, 8, 41), 'spaced', pay('evt_9a12', 'inv_1007', 31000, 'payment.succeeded', { customer_name: cust('inv_1007') }));
paystream(at(30, 10, 2), 'compact', pay('evt_9a13', 'inv_1008', 9900, 'charge.refunded'));
parcelly(at(30, 11, 15), 'compact', ship('shp_704', 'in_transit', '2026-10-03'), 'pd_3107');
paystream(at(30, 13, 37), 'escaped', pay('evt_9a14', 'inv_1006', 0, 'invoice.viewed', { customer_name: cust('inv_1006') }));
paystream(at(30, 15, 20), 'pretty', pay('evt_9a15', 'inv_1002', 4500, 'charge.refunded', { reason: 'Kunde storniert – doppelt' }));
writeFileSync('recorded/deliveries.ndjson', out.map((o) => JSON.stringify(o)).join('\n') + '\n');
EOF
node .gen.mjs && rm .gen.mjs
cat > recorded/README.md <<'EOF'
# Captured deliveries

`deliveries.ndjson`: every webhook delivery staging received 2026-09-24..30, with headers and the body bytes
(base64) exactly as they arrived. `seed.json` is the matching invoice/shipment state before the first one.

The SEC-118 pen-test requests (forged signature, tampered body, replayed old timestamp) are mixed in on purpose.
They must keep getting 401.

`npm run replay` needs the staging secrets in `.env`.
EOF
cat > scripts/replay.ts <<'EOF'
// Replays recorded/deliveries.ndjson through the app in-process, with the clock set to each delivery's
// arrival time, then smoke-tests the JSON API. Prints one line per delivery and a digest of the outcome.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/store.ts';
import { silentLogger } from '../src/log.ts';
import { inject } from '../src/testing/inject.ts';

const cfg = loadConfig();
const store = new Store(JSON.parse(readFileSync('recorded/seed.json', 'utf8')));
let now = 0;
const app = buildApp({ store, cfg, clock: { now: () => now }, log: silentLogger });

const deliveries = readFileSync('recorded/deliveries.ndjson', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const results: string[] = [];
const tally: Record<string, [number, number]> = {};
for (const d of deliveries) {
  now = Date.parse(d.received_at) + 2000;
  const r = await inject(app, { method: 'POST', url: d.path, headers: d.headers, body: Buffer.from(d.body_b64, 'base64') });
  const t = (tally[d.provider] ??= [0, 0]);
  t[1]++;
  if (r.status >= 200 && r.status < 300) t[0]++;
  results.push(`${d.id} ${r.status}`);
  console.log(`  ${d.id}  ${d.provider.padEnd(9)} ${r.status}  ${r.status >= 300 ? (r.json?.error ?? '') : ''}`);
}

const created = await inject(app, { method: 'POST', url: '/api/invoices', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customer: 'Café Nord', amount_minor: 12900, currency: 'EUR' }) });
const fetched = created.status === 201 ? await inject(app, { method: 'GET', url: '/api/invoices/' + created.json.id }) : null;
const apiOk = created.status === 201 && fetched?.status === 200 && fetched.json.customer === 'Café Nord';

const snap = store.snapshot();
const paid = snap.invoices.filter((i) => i.status === 'paid').length;
console.log(`  invoices paid: ${paid}/${snap.invoices.length}; shipments: ${snap.shipments.map((s) => s.status).join(', ')}`);
const digest = createHash('sha256').update(JSON.stringify({ results, snap, apiOk })).digest('hex').slice(0, 12);
const summary = Object.entries(tally).map(([p, [ok, n]]) => `${p} ${ok}/${n} accepted`).join(', ');
console.log(`replay: ${summary}, api ${apiOk ? 'ok' : 'FAIL'}; replay digest ${digest}`);
EOF
cat > scripts/sign.ts <<'EOF'
// Sign a body file for manual testing: node scripts/sign.ts paystream|parcelly FILE
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../src/config.ts';

const [provider, file] = process.argv.slice(2);
const cfg = loadConfig();
const body = readFileSync(file);
if (provider === 'paystream') {
  const t = Math.floor(Date.now() / 1000);
  console.log(`paystream-signature: t=${t},v1=` + createHmac('sha256', cfg.paystreamSecret).update(`${t}.`).update(body).digest('hex'));
} else if (provider === 'parcelly') {
  console.log('x-parcelly-hmac: ' + createHmac('sha256', cfg.parcellySecret).update(body).digest('base64'));
} else {
  console.error('usage: node scripts/sign.ts paystream|parcelly FILE');
  process.exitCode = 2;
}
EOF
commit "2026-09-18T11:45:00+02:00" "replay tool + captured staging deliveries (SEC-118 pen-test requests included)"

# PLAT-77 (Tuesday 2026-09-29): shared JSON parser everywhere; the raw buffer went away and the webhook routes
# were switched to re-serializing the parsed body.
cat > src/middleware/body.ts <<'EOF'
import { json, type Middleware } from '../http.ts';

const LIMIT = 1024 * 1024;

// Shared JSON body parser (PLAT-77): one implementation for every route, parsed body in req.body.
export const parseJson: Middleware = async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) return json(res, 413, { error: 'body too large' });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text && /\bjson\b/.test(String(req.headers['content-type'] ?? ''))) {
    try {
      req.body = JSON.parse(text);
    } catch {
      return json(res, 400, { error: 'invalid json' });
    }
  }
  await next();
};
EOF
sed -i.bak "s#import { readBody } from './middleware/body.ts';#import { parseJson } from './middleware/body.ts';#; s#\[requestId, accessLog(log), readBody\]#[requestId, accessLog(log), parseJson]#" src/app.ts && rm src/app.ts.bak
sed -i.bak "s#verifyPaystream(header, req.rawBody ?? Buffer.alloc(0), cfg.paystreamSecret, clock.now())#verifyPaystream(header, JSON.stringify(req.body), cfg.paystreamSecret, clock.now())#" src/webhooks/paystream.ts && rm src/webhooks/paystream.ts.bak
sed -i.bak "s#verifyParcelly(header, req.rawBody ?? Buffer.alloc(0), cfg.parcellySecret)#verifyParcelly(header, JSON.stringify(req.body), cfg.parcellySecret)#" src/webhooks/parcelly.ts && rm src/webhooks/parcelly.ts.bak
sed -i.bak 's#^3\. body middleware: buffers the body, parses JSON into `req.body`$#3. `parseJson` (PLAT-77): shared parser for every route, parsed JSON in `req.body`#' docs/ARCHITECTURE.md && rm docs/ARCHITECTURE.md.bak
commit "2026-09-29T09:40:00+02:00" "PLAT-77: shared parseJson middleware for all routes (drop per-route raw buffering)"

# uncommitted: shipments list filter (user's WIP)
cat > src/api/shipments.ts <<'EOF'
import { json, type Route } from '../http.ts';
import type { Store } from '../store.ts';

export function shipmentRoutes(store: Store): Route[] {
  return [
    {
      // WIP (BILL-430): list shipments for the billing UI, optionally ?status=in_transit
      method: 'GET',
      path: '/api/shipments',
      handler(req, res) {
        const status = req.query?.get('status');
        const all = [...store.shipments.values()];
        json(res, 200, status ? all.filter((s) => s.status === status) : all);
      },
    },
    {
      method: 'GET',
      path: '/api/shipments/:id',
      handler(req, res) {
        const s = store.shipments.get(req.params!.id);
        return s ? json(res, 200, s) : json(res, 404, { error: 'no such shipment' });
      },
    },
  ];
}
EOF
cat >> test/shipments.test.ts <<'EOF'

test('BILL-430: filter shipments by status', async () => {
  const { app } = setup();
  const r = await inject(app, { method: 'GET', url: '/api/shipments?status=label_created' });
  assert.deepEqual(r.json.map((s: { id: string }) => s.id), ['shp_1']);
});
EOF
# the user's guess: a rotated secret pasted from the Paystream dashboard (not used by anything)
echo 'PAYSTREAM_SECRET_NEXT=whsec_stg_b07e55c1d9a34e12' >> .env
