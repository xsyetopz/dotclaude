#!/usr/bin/env bash
# invoicer: ESM Node billing service (reminders, reconcile, late fees), stdlib only.
set -euo pipefail
export GIT_AUTHOR_NAME="Priya Raman" GIT_AUTHOR_EMAIL="priya@ledgerly.test"
export GIT_COMMITTER_NAME="Priya Raman" GIT_COMMITTER_EMAIL="priya@ledgerly.test"
git init -q -b main .
git config user.name "Priya Raman"; git config user.email "priya@ledgerly.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/billing src/jobs src/render src/payments templates test docs scripts

cat > package.json <<'EOF'
{
  "name": "invoicer",
  "version": "0.9.0",
  "private": true,
  "type": "module",
  "description": "Invoices, payment reminders and late fees for Ledgerly customers",
  "scripts": {
    "test": "node --test test/",
    "start": "node src/server.js"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
out/
*.log
EOF
cat > README.md <<'EOF'
# invoicer

Invoices, payment reminders and late fees. Node 22+, no runtime dependencies:
we keep this service on the standard library on purpose (security review is
per-dependency and slow).

    npm test       unit tests
    npm start      HTTP server (invoice HTML at /invoices/<id>.html)

See docs/ARCHITECTURE.md for the nightly jobs.
EOF
cat > docs/ARCHITECTURE.md <<'EOF'
# Architecture

## Data
- `invoices.json`: id, number, customer, email, amount (EUR, as a JSON number), due_date,
  lines, paid_at, last_reminder_at, late_fee_cents.
- `payments.json`: charges as reported by the PSP webhook (src/payments/webhook.js), with
  status `succeeded` or `failed` and `received_at`. Partial payments are common, and a single invoice
  can have several payments.

Money is a float in the JSON for historical reasons. Always convert with
`toCents()` before adding or comparing (src/billing/money.js).

## paid_at
`paid_at` is the *settlement date*. Finance exports and the revenue report read it, so
it is set in exactly one place: the reconcile job. Do not set it anywhere else.

## Nightly jobs (UTC)
| time  | job                      | what it does |
|-------|--------------------------|--------------|
| 02:00 | src/jobs/reconcile.js    | marks invoices with no outstanding balance as paid (sets paid_at) |
| 03:00 | src/jobs/late-fees.js    | 2% of the outstanding balance (min EUR 5) once an invoice is 14+ days overdue |
| 18:00 | src/jobs/reminders.js    | reminder email for overdue invoices, at most once per 7 days |

## Rendering
`src/render/html.js` renders an invoice to HTML from `templates/invoice.html`.
Mail bodies are plain-text templates rendered by `src/render/template.js`.
EOF
cat > src/billing/money.js <<'EOF'
// Amounts arrive as JSON numbers (EUR). Do arithmetic in integer cents only.
export const toCents = (amount) => Math.round(Number(amount) * 100);

export function formatEUR(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}EUR ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
EOF
cat > src/billing/status.js <<'EOF'
export const DAY = 86400000;

export function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Overdue: not marked paid and the due date is before today.
export function isOverdue(inv, now) {
  return inv.paid_at == null && new Date(inv.due_date) < startOfDay(now);
}

export function daysOverdue(inv, now) {
  return Math.floor((startOfDay(now) - new Date(inv.due_date)) / DAY);
}
EOF
cat > src/store.js <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(dir) {
  const invoices = JSON.parse(readFileSync(join(dir, 'invoices.json'), 'utf8'));
  const payments = JSON.parse(readFileSync(join(dir, 'payments.json'), 'utf8'));
  return {
    invoices,
    payments,
    // What a job running at `now` can see: payments that have arrived by then.
    at(now) {
      const t = new Date(now);
      return { invoices, payments: payments.filter((p) => new Date(p.received_at) <= t) };
    },
    save() {
      writeFileSync(join(dir, 'invoices.json'), JSON.stringify(invoices, null, 2) + '\n');
      writeFileSync(join(dir, 'payments.json'), JSON.stringify(payments, null, 2) + '\n');
    },
  };
}
EOF
cat > src/render/template.js <<'EOF'
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url));

export const loadTemplate = (name) => readFileSync(TEMPLATES + name, 'utf8');

export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}
EOF
cat > src/render/html.js <<'EOF'
import { loadTemplate, renderTemplate } from './template.js';
import { toCents, formatEUR } from '../billing/money.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderInvoiceHtml(inv) {
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${formatEUR(toCents(l.amount))}</td></tr>`)
    .join('\n');
  return renderTemplate(loadTemplate('invoice.html'), {
    number: esc(inv.number),
    customer: esc(inv.customer),
    due_date: esc(inv.due_date),
    rows,
    total: formatEUR(toCents(inv.amount)),
  });
}
EOF
cat > templates/invoice.html <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice {{number}}</title>
<link rel="stylesheet" href="/static/invoice.css"></head>
<body>
<h1>Invoice {{number}}</h1>
<p class="customer">{{customer}}</p>
<table class="lines">
{{rows}}
<tr class="total"><td>Total</td><td class="num">{{total}}</td></tr>
</table>
<p class="due">Due {{due_date}}</p>
</body></html>
EOF
cat > src/server.js <<'EOF'
import { createServer } from 'node:http';
import { openStore } from './store.js';
import { renderInvoiceHtml } from './render/html.js';

const store = openStore(process.env.INVOICER_DATA || 'data');

export const server = createServer((req, res) => {
  const m = /^\/invoices\/([\w-]+)\.html$/.exec(req.url);
  const inv = m && store.invoices.find((i) => i.id === m[1]);
  if (!inv) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderInvoiceHtml(inv));
});

if (import.meta.url === `file://${process.argv[1]}`) server.listen(process.env.PORT || 8080);
EOF
cat > src/jobs/reconcile.js <<'EOF'
import { toCents } from '../billing/money.js';

// 02:00 UTC. The only place that sets paid_at (settlement date, see docs/ARCHITECTURE.md).
export function runReconcile(view, now) {
  let marked = 0;
  for (const inv of view.invoices) {
    if (inv.paid_at != null) continue;
    const paid = view.payments
      .filter((p) => p.invoice_id === inv.id && p.status === 'succeeded')
      .reduce((sum, p) => sum + toCents(p.amount), 0);
    if (paid >= toCents(inv.amount)) {
      inv.paid_at = new Date(now).toISOString();
      marked++;
    }
  }
  return marked;
}
EOF
cat > test/money.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, formatEUR } from '../src/billing/money.js';

test('toCents rounds float amounts', () => {
  assert.equal(toCents(30.3), 3030);
  assert.equal(toCents(10.1) + toCents(20.2), 3030);
});

test('formatEUR', () => {
  assert.equal(formatEUR(123456), 'EUR 1234.56');
  assert.equal(formatEUR(-5), '-EUR 0.05');
});
EOF
cat > test/status.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue, daysOverdue } from '../src/billing/status.js';

const now = new Date('2026-09-30T18:00:00Z');

test('unpaid invoice past its due date is overdue', () => {
  assert.equal(isOverdue({ due_date: '2026-09-20', paid_at: null }, now), true);
  assert.equal(daysOverdue({ due_date: '2026-09-20' }, now), 10);
});

test('due today is not overdue yet', () => {
  assert.equal(isOverdue({ due_date: '2026-09-30', paid_at: null }, now), false);
});

test('invoice marked paid is never overdue', () => {
  assert.equal(isOverdue({ due_date: '2026-08-01', paid_at: '2026-09-02T02:00:00Z' }, now), false);
});
EOF
cat > test/reconcile.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReconcile } from '../src/jobs/reconcile.js';

test('marks fully paid invoices, ignores failed and partial payments', () => {
  const invoices = [
    { id: 'a', amount: 30.3, paid_at: null },
    { id: 'b', amount: 50, paid_at: null },
    { id: 'c', amount: 50, paid_at: null },
  ];
  const payments = [
    { invoice_id: 'a', amount: 10.1, status: 'succeeded' },
    { invoice_id: 'a', amount: 20.2, status: 'succeeded' },
    { invoice_id: 'b', amount: 50, status: 'failed' },
    { invoice_id: 'c', amount: 20, status: 'succeeded' },
  ];
  assert.equal(runReconcile({ invoices, payments }, '2026-10-01T02:00:00Z'), 1);
  assert.equal(invoices[0].paid_at, '2026-10-01T02:00:00.000Z');
  assert.equal(invoices[1].paid_at, null);
  assert.equal(invoices[2].paid_at, null);
});
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 0.6.0 - 2026-06-02
- Store, money helpers, HTML invoices, nightly reconcile.
EOF
commit "2026-06-02T10:00:00+02:00" "invoicer: store, money helpers, HTML invoices, reconcile job"

cat > src/billing/balance.js <<'EOF'
import { toCents } from './money.js';

export function paidCents(inv, payments) {
  return payments
    .filter((p) => p.invoice_id === inv.id && p.status === 'succeeded')
    .reduce((sum, p) => sum + toCents(p.amount), 0);
}

export function outstandingCents(inv, payments) {
  return toCents(inv.amount) - paidCents(inv, payments);
}
EOF
cat > src/jobs/late-fees.js <<'EOF'
import { isOverdue, daysOverdue } from '../billing/status.js';
import { outstandingCents } from '../billing/balance.js';

export const GRACE_DAYS = 14;

// 03:00 UTC, after reconcile. 2% of what is still owed, at least EUR 5, once per invoice.
export function runLateFees(view, now) {
  const charged = [];
  for (const inv of view.invoices) {
    if (!isOverdue(inv, now) || inv.late_fee_cents) continue;
    if (daysOverdue(inv, now) <= GRACE_DAYS) continue;
    const outstanding = outstandingCents(inv, view.payments);
    if (outstanding <= 0) continue;
    inv.late_fee_cents = Math.max(500, Math.round(outstanding * 0.02));
    charged.push({ id: inv.id, cents: inv.late_fee_cents });
  }
  return charged;
}
EOF
cat > test/late-fees.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLateFees } from '../src/jobs/late-fees.js';

const now = '2026-10-01T03:00:00Z';

test('2% of the outstanding amount, minimum EUR 5', () => {
  const invoices = [
    { id: 'big', amount: 1200, due_date: '2026-09-01', paid_at: null },
    { id: 'small', amount: 40, due_date: '2026-09-01', paid_at: null },
  ];
  const charged = runLateFees({ invoices, payments: [] }, now);
  assert.deepEqual(charged, [{ id: 'big', cents: 2400 }, { id: 'small', cents: 500 }]);
});

test('partially paid invoices are charged on the remainder', () => {
  const invoices = [{ id: 'p', amount: 1000, due_date: '2026-09-01', paid_at: null }];
  const payments = [{ invoice_id: 'p', amount: 400, status: 'succeeded', received_at: '2026-09-30T10:00:00Z' }];
  assert.deepEqual(runLateFees({ invoices, payments }, now), [{ id: 'p', cents: 1200 }]);
});

test('no fee inside the grace period or twice', () => {
  const invoices = [
    { id: 'fresh', amount: 100, due_date: '2026-09-20', paid_at: null },
    { id: 'done', amount: 100, due_date: '2026-08-01', paid_at: null, late_fee_cents: 500 },
  ];
  assert.deepEqual(runLateFees({ invoices, payments: [] }, now), []);
});
EOF
cat >> CHANGELOG.md <<'EOF'

## 0.7.0 - 2026-06-20
- Late fees: 2% of the outstanding balance, min EUR 5, after 14 days.
EOF
commit "2026-06-20T15:30:00+02:00" "late fees: 2% of outstanding balance, min EUR 5, 14 days grace"

cat > src/payments/webhook.js <<'EOF'
// POST /webhooks/payments from the PSP. Records the charge as it arrives.
// paid_at is deliberately left alone: reconcile sets it (settlement date).
export function recordPayment(store, event) {
  if (!event || !event.id || !event.invoice_id) throw new Error('bad payment event');
  if (store.payments.some((p) => p.id === event.id)) return false; // PSP retries deliveries
  store.payments.push({
    id: event.id,
    invoice_id: event.invoice_id,
    amount: event.amount,
    status: event.status === 'succeeded' ? 'succeeded' : 'failed',
    received_at: event.created,
  });
  return true;
}
EOF
cat > test/webhook.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPayment } from '../src/payments/webhook.js';

test('records a payment once, never touches paid_at', () => {
  const store = { invoices: [{ id: 'i1', paid_at: null }], payments: [] };
  const ev = { id: 'ch_1', invoice_id: 'i1', amount: 12.5, status: 'succeeded', created: '2026-09-30T09:00:00Z' };
  assert.equal(recordPayment(store, ev), true);
  assert.equal(recordPayment(store, ev), false);
  assert.equal(store.payments.length, 1);
  assert.equal(store.invoices[0].paid_at, null);
});

test('anything but succeeded is stored as failed', () => {
  const store = { invoices: [], payments: [] };
  recordPayment(store, { id: 'ch_2', invoice_id: 'i1', amount: 5, status: 'requires_action', created: 'x' });
  assert.equal(store.payments[0].status, 'failed');
});
EOF
commit "2026-07-08T11:12:00+02:00" "payments: record PSP charges via webhook as they arrive"

cat > templates/reminder.txt <<'EOF'
Hello {{customer}},

invoice {{number}} over {{amount}} is {{days}} days overdue.
Please pay at your earliest convenience.

Thanks,
Ledgerly accounts
EOF
cat > src/jobs/reminders.js <<'EOF'
import { isOverdue, daysOverdue, DAY } from '../billing/status.js';
import { toCents, formatEUR } from '../billing/money.js';
import { loadTemplate, renderTemplate } from '../render/template.js';

// 18:00 UTC. One reminder per overdue invoice, at most once every 7 days.
export function runReminders(view, now, outbox) {
  const tpl = loadTemplate('reminder.txt');
  const t = new Date(now);
  const sent = [];
  for (const inv of view.invoices) {
    if (!isOverdue(inv, t)) continue;
    if (inv.last_reminder_at && t - new Date(inv.last_reminder_at) < 7 * DAY) continue;
    outbox.push({
      to: inv.email,
      subject: `Invoice ${inv.number} is overdue`,
      body: renderTemplate(tpl, {
        customer: inv.customer,
        number: inv.number,
        amount: formatEUR(toCents(inv.amount)),
        days: daysOverdue(inv, t),
      }),
    });
    inv.last_reminder_at = t.toISOString();
    sent.push(inv.id);
  }
  return sent;
}
EOF
cat > test/reminders.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReminders } from '../src/jobs/reminders.js';

const now = '2026-09-30T18:00:00Z';
const inv = (over) => ({ id: 'i1', number: 'L-1001', customer: 'Acme', email: 'ap@acme.test', amount: 120, due_date: '2026-09-10', paid_at: null, ...over });

test('reminds overdue invoices', () => {
  const outbox = [];
  const sent = runReminders({ invoices: [inv()], payments: [] }, now, outbox);
  assert.deepEqual(sent, ['i1']);
  assert.equal(outbox[0].to, 'ap@acme.test');
  assert.equal(outbox[0].subject, 'Invoice L-1001 is overdue');
});

test('at most once per 7 days', () => {
  const outbox = [];
  runReminders({ invoices: [inv({ last_reminder_at: '2026-09-26T18:00:00Z' })], payments: [] }, now, outbox);
  assert.equal(outbox.length, 0);
});

test('skips invoices marked paid', () => {
  const outbox = [];
  runReminders({ invoices: [inv({ paid_at: '2026-09-29T02:00:00Z' })], payments: [] }, now, outbox);
  assert.equal(outbox.length, 0);
});
EOF
cat >> CHANGELOG.md <<'EOF'

## 0.9.0 - 2026-08-12
- Evening reminder email for overdue invoices (weekly at most).
EOF
commit "2026-08-12T09:45:00+02:00" "reminders: evening email for overdue invoices"

mkdir -p docs/design
cat > docs/design/README.md <<'EOF'
# Design docs

Anything that adds a dependency, a new output format, or a new external integration
gets a design doc here *before* implementation. Reviewed in the Thursday architecture
meeting. Copy this outline:

    # <Title>
    Status: draft | approved | rejected
    Ticket: #NNN

    ## Context
    ## Goals / non-goals
    ## Options considered   (for each: how it works, cost, risks, dependencies)
    ## Proposal
    ## Open questions
EOF
cat > docs/design/2026-07-payment-webhooks.md <<'EOF'
# PSP payment webhooks
Status: approved
Ticket: #148

## Context
Payments only reached us through the nightly bank file, so customers saw stale balances all day.

## Goals / non-goals
Goal: record charges as soon as the PSP reports them. Non-goal: changing what "paid" means for
finance. paid_at stays the settlement date set by reconcile.

## Options considered
1. Poll the PSP API every 5 minutes. Simple, but it's rate-limited and lags.
2. Webhook endpoint with idempotent insert keyed by charge id. Needs signature verification.

## Proposal
Option 2, no SDK: the signature is a single HMAC we can check with node:crypto.

## Open questions
None left. Approved 2026-07-02.
EOF
commit "2026-09-01T10:00:00+02:00" "docs: design doc process and template"

# --- snapshot for #219 and a simulator for the nightly jobs ---
mkdir -p data/sim/2026-09-30
node - <<'EOF'
const fs = require('fs');
let seed = 219;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const customers = ['Acme Tools', 'Birch & Co', 'Cobalt Studio', 'Dunmore Farms', 'Elio Cafe', 'Fjord Travel', 'Granite Labs', 'Hollow Pines Inn', 'Iris Optics', 'Juniper Legal', 'Kite Media', 'Larch Dental'];
const invoices = [], payments = [];
let n = 1001, ch = 1;
const amount = () => Math.round((40 + rnd() * 1800) * 100) / 100;
function invoice(due, extra = {}) {
  const c = pick(customers), a = extra.amount ?? amount();
  const inv = { id: `inv-${n}`, number: `L-${n}`, customer: c, email: `ap@${c.toLowerCase().replace(/[^a-z]/g, '')}.test`,
    amount: a, due_date: due, lines: [{ description: 'Subscription ' + pick(['Team', 'Pro', 'Studio']), amount: a }],
    paid_at: null, last_reminder_at: null, late_fee_cents: 0, ...extra };
  delete inv.amount_override; n++; invoices.push(inv); return inv;
}
const pay = (inv, amt, status, at) => payments.push({ id: `ch_${String(ch++).padStart(4, '0')}`, invoice_id: inv.id, amount: amt, status, received_at: at });
const overdueDue = () => `2026-09-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}`;   // 18+ days late
const recentDue = () => `2026-09-${String(17 + Math.floor(rnd() * 12)).padStart(2, '0')}`;  // inside grace
const futureDue = () => `2026-10-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
const today = (h) => `2026-09-30T${String(h).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00Z`;
const order = [];
// A: overdue, nothing paid (some already reminded this week, some already charged a fee)
for (let i = 0; i < 14; i++) order.push(() => {
  const inv = invoice(i % 3 ? overdueDue() : recentDue());
  if (i === 4 || i === 9) inv.last_reminder_at = '2026-09-27T18:00:00.000Z';
  if (i === 2 || i === 7) inv.late_fee_cents = 1500;
});
// B: overdue, paid in full during the day
for (let i = 0; i < 6; i++) order.push(() => { const inv = invoice(i % 2 ? overdueDue() : recentDue()); pay(inv, inv.amount, 'succeeded', today(8 + i)); });
// C: overdue, paid in full in two parts that do not add up in floating point
order.push(() => { const inv = invoice(overdueDue(), { amount: 30.3, lines: [{ description: 'Subscription Team', amount: 30.3 }] }); pay(inv, 10.1, 'succeeded', today(9)); pay(inv, 20.2, 'succeeded', today(15)); });
order.push(() => { const inv = invoice(recentDue(), { amount: 0.3, lines: [{ description: 'Usage top-up', amount: 0.3 }] }); pay(inv, 0.1, 'succeeded', today(10)); pay(inv, 0.2, 'succeeded', today(11)); });
// D: overdue, partially paid during the day
for (let i = 0; i < 3; i++) order.push(() => { const inv = invoice(overdueDue()); pay(inv, Math.round(inv.amount * 40) / 100, 'succeeded', today(12 + i)); });
// E: overdue, card declined during the day
for (let i = 0; i < 2; i++) order.push(() => { const inv = invoice(overdueDue()); pay(inv, inv.amount, 'failed', today(13 + i)); });
// F: overdue, paid in full after the 18:00 run
order.push(() => { const inv = invoice(overdueDue()); pay(inv, inv.amount, 'succeeded', '2026-09-30T19:41:00Z'); });
// G: paid earlier and already reconciled
for (let i = 0; i < 3; i++) order.push(() => { const inv = invoice(overdueDue(), {}); pay(inv, inv.amount, 'succeeded', '2026-09-25T10:00:00Z'); inv.paid_at = '2026-09-26T02:00:00.000Z'; });
// H: not due yet, some paid early
for (let i = 0; i < 29; i++) order.push(() => { const inv = invoice(futureDue()); if (i % 5 === 0) pay(inv, inv.amount, 'succeeded', today(9 + (i % 8))); });
// deterministic shuffle so categories are interleaved
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
order.forEach((f) => f());
payments.sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
fs.writeFileSync('data/sim/2026-09-30/invoices.json', JSON.stringify(invoices, null, 2) + '\n');
fs.writeFileSync('data/sim/2026-09-30/payments.json', JSON.stringify(payments, null, 2) + '\n');
EOF
cat > scripts/simulate.js <<'EOF'
// Replays one evening + night of jobs against a data snapshot, in memory.
//   node scripts/simulate.js [data/sim/2026-09-30]
import { createHash } from 'node:crypto';
import { openStore } from '../src/store.js';
import { runReminders } from '../src/jobs/reminders.js';
import { runReconcile } from '../src/jobs/reconcile.js';
import { runLateFees } from '../src/jobs/late-fees.js';
import { formatEUR } from '../src/billing/money.js';

const dir = process.argv[2] || 'data/sim/2026-09-30';
const day = dir.split('/').pop();
const store = openStore(dir);
const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const outbox = [];
const reminded = runReminders(store.at(`${day}T18:00:00Z`), `${day}T18:00:00Z`, outbox);
console.log(`reminders  ${day} 18:00  ${reminded.length} sent`);
const marked = runReconcile(store.at(`${next}T02:00:00Z`), `${next}T02:00:00Z`);
console.log(`reconcile  ${next} 02:00  ${marked} marked paid`);
const fees = runLateFees(store.at(`${next}T03:00:00Z`), `${next}T03:00:00Z`);
console.log(`late fees  ${next} 03:00  ${fees.length} charged, ${formatEUR(fees.reduce((s, f) => s + f.cents, 0))}`);

const h = createHash('sha256');
h.update(JSON.stringify({ reminded: [...reminded].sort(), marked, fees: [...fees].sort((a, b) => a.id.localeCompare(b.id)) }));
console.log(`simulation digest ${h.digest('hex').slice(0, 12)}`);
EOF
node - <<'EOF'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.scripts.simulate = 'node scripts/simulate.js data/sim/2026-09-30';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
EOF
commit "2026-09-30T20:15:00+02:00" "sim: snapshot of 2026-09-30 and nightly job simulator (#219)"

# --- uncommitted: Priya's reminder wording in progress ---
cat > templates/reminder.txt <<'EOF'
Hi {{customer}},

just a friendly nudge: invoice {{number}} ({{amount}}) is now {{days}} days past due.
If you've already sent the payment, thank you, and please ignore this email.

TODO(priya): link to the payment page once #205 lands

Best,
Ledgerly accounts
EOF
