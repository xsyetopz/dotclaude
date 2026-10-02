#!/usr/bin/env bash
# pulse: ESM analytics rollups. The weekly report buckets events by UTC day
# (dayKey) and uses UTC midnights as the week window, although config/pulse.json
# has timezone Europe/Warsaw and docs/metrics.md says reports use local days.
# Storage partitions are UTC days by design, via the same dayKey(). W13 2026 ends
# on the CET->CEST switch (29 March). data/events/ is an untracked, gitignored local
# copy; out/weekly-2026-W13.csv is the user's stale (wrong) output.
set -euo pipefail

export GIT_AUTHOR_NAME="Joanna Kędzierska" GIT_AUTHOR_EMAIL="joanna.k@acme-pulse.io"
export GIT_COMMITTER_NAME="Joanna Kędzierska" GIT_COMMITTER_EMAIL="joanna.k@acme-pulse.io"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- pulse 2.3: UTC-partitioned event log and ingest
cat > .gitignore <<'__FX__'
node_modules/
out/
# local copy of the event log, see scripts/pull-events.sh
data/events/
__FX__
cat > README.md <<'__FX__'
# pulse

Usage rollups from the product event log. The weekly CSV goes into the Monday
metrics review next to the product dashboard.

```
scripts/pull-events.sh 2026-03-20 2026-03-31   # local copy of the partitions
npm run weekly -- 2026-W13                     # -> out/weekly-2026-W13.csv
npm test
```

- docs/storage.md: event log layout
- docs/metrics.md: metric definitions
__FX__
cat > package.json <<'__FX__'
{
  "name": "pulse",
  "version": "2.3.0",
  "private": true,
  "type": "module",
  "description": "Product analytics rollups: daily and weekly usage reports from the event log",
  "scripts": {
    "ingest": "node bin/ingest.js",
    "test": "node --test test/"
  },
  "engines": {
    "node": ">=20"
  }
}
__FX__
mkdir -p config
cat > config/pulse.json <<'__FX__'
{
  "eventsDir": "data/events",
  "outDir": "out",
  "currency": "EUR"
}
__FX__
mkdir -p src
cat > src/config.js <<'__FX__'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pulse.json'), 'utf8'));
  return {
    ...raw,
    eventsDir: path.resolve(ROOT, raw.eventsDir),
    outDir: path.resolve(ROOT, raw.outDir),
  };
}
__FX__
mkdir -p src
cat > src/time.js <<'__FX__'
// Day keys are YYYY-MM-DD strings. Event timestamps are epoch milliseconds.

export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
__FX__
mkdir -p src
cat > src/partitions.js <<'__FX__'
import fs from 'node:fs';
import path from 'node:path';
import { dayKey, dayRange } from './time.js';

// The event log is partitioned by UTC day: data/events/<YYYY-MM-DD>.ndjson.
// See docs/storage.md. Ingestion, compaction and the warehouse export all
// depend on that layout.

export function partitionFor(ts) {
  return `${dayKey(ts)}.ndjson`;
}

export function readPartition(dir, day) {
  const file = path.join(dir, `${day}.ndjson`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Events with fromTs <= ts < toTs, reading only the partitions that can hold them.
export function readEvents(dir, fromTs, toTs) {
  const events = [];
  for (const day of dayRange(dayKey(fromTs), dayKey(toTs - 1))) {
    for (const e of readPartition(dir, day)) if (e.ts >= fromTs && e.ts < toTs) events.push(e);
  }
  return events;
}

export function appendEvents(dir, events) {
  const byFile = new Map();
  for (const e of events) {
    const f = partitionFor(e.ts);
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(JSON.stringify(e));
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, lines] of byFile) fs.appendFileSync(path.join(dir, f), lines.join('\n') + '\n');
  return [...byFile.keys()].sort();
}
__FX__
mkdir -p bin
cat > bin/ingest.js <<'__FX__'
#!/usr/bin/env node
// Append NDJSON events (stdin or file args) into the UTC day partitions.
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { appendEvents } from '../src/partitions.js';

const inputs = process.argv.length > 2 ? process.argv.slice(2).map((f) => fs.readFileSync(f, 'utf8')) : [fs.readFileSync(0, 'utf8')];
const events = inputs.flatMap((s) => s.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
for (const e of events) {
  if (typeof e.ts !== 'number' || !e.type || !e.user) throw new Error(`bad event: ${JSON.stringify(e)}`);
}
const touched = appendEvents(loadConfig().eventsDir, events);
console.error(`ingested ${events.length} events into ${touched.join(', ')}`);
__FX__
chmod +x bin/ingest.js
mkdir -p scripts
cat > scripts/pull-events.sh <<'__FX__'
#!/usr/bin/env bash
# Sync UTC day partitions from the event bucket into data/events/.
# usage: scripts/pull-events.sh 2026-03-20 2026-03-31
set -euo pipefail
from=${1:?from day}
to=${2:?to day}
: "${PULSE_BUCKET:=s3://acme-pulse-events/prod}"
command -v aws >/dev/null || { echo "pull-events: aws CLI not found" >&2; exit 1; }
d=$from
while [[ "$d" < "$to" || "$d" == "$to" ]]; do
  aws s3 cp --only-show-errors "$PULSE_BUCKET/$d.ndjson" "data/events/$d.ndjson"
  d=$(node -e 'const d=new Date(process.argv[1]+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);console.log(d.toISOString().slice(0,10))' "$d")
done
__FX__
chmod +x scripts/pull-events.sh
mkdir -p docs
cat > docs/storage.md <<'__FX__'
# Event log storage

Events are NDJSON, one object per line:

    {"id":"ev_0001a","ts":1774220700000,"type":"session_start","user":"u042"}

`ts` is epoch milliseconds (UTC). The log is partitioned by **UTC day**:
`<bucket>/<YYYY-MM-DD>.ndjson` holds every event with
`YYYY-MM-DDT00:00:00Z <= ts < next day`. Ingestion (`bin/ingest.js`), nightly
compaction and the warehouse export all locate partitions with
`partitionFor()` / `dayKey()` in `src/`, so the layout must not change without
migrating the bucket.

Readers that need a time window should go through `readEvents(dir, fromTs,
toTs)`, which works out which partitions overlap the window.
__FX__
mkdir -p test
cat > test/time.test.js <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, dayRange } from '../src/time.js';

test('dayKey is the UTC calendar day', () => {
  assert.equal(dayKey(Date.parse('2026-03-22T23:30:00Z')), '2026-03-22');
  assert.equal(dayKey(Date.parse('2026-03-23T00:00:00Z')), '2026-03-23');
});

test('addDays and dayRange cross month ends', () => {
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
  assert.deepEqual(dayRange('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});
__FX__
mkdir -p test
cat > test/partitions.test.js <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partitionFor, appendEvents, readEvents } from '../src/partitions.js';

test('partitions are UTC days', () => {
  assert.equal(partitionFor(Date.parse('2026-03-22T23:30:00Z')), '2026-03-22.ndjson');
  assert.equal(partitionFor(Date.parse('2026-03-29T22:15:00Z')), '2026-03-29.ndjson');
});

test('readEvents spans partitions and is half-open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-'));
  const ts = (s) => Date.parse(s);
  const touched = appendEvents(dir, [
    { id: 'a', ts: ts('2026-03-22T23:10:00Z'), type: 'session_start', user: 'u1' },
    { id: 'b', ts: ts('2026-03-23T08:00:00Z'), type: 'session_start', user: 'u2' },
    { id: 'c', ts: ts('2026-03-24T00:00:00Z'), type: 'session_start', user: 'u3' },
  ]);
  assert.deepEqual(touched, ['2026-03-22.ndjson', '2026-03-23.ndjson', '2026-03-24.ndjson']);
  const got = readEvents(dir, ts('2026-03-22T23:00:00Z'), ts('2026-03-24T00:00:00Z')).map((e) => e.id);
  assert.deepEqual(got, ['a', 'b']);
  fs.rmSync(dir, { recursive: true, force: true });
});
__FX__
git add -A
commit "2025-11-03T09:30:00Z" "pulse 2.3: UTC-partitioned event log and ingest"

# --- weekly usage report (out/weekly-<week>.csv) for the metrics review
cat > package.json <<'__FX__'
{
  "name": "pulse",
  "version": "2.4.1",
  "private": true,
  "type": "module",
  "description": "Product analytics rollups: daily and weekly usage reports from the event log",
  "scripts": {
    "ingest": "node bin/ingest.js",
    "weekly": "node bin/weekly.js",
    "test": "node --test test/"
  },
  "engines": { "node": ">=20" }
}
__FX__
mkdir -p config
cat > config/pulse.json <<'__FX__'
{
  "timezone": "Europe/Warsaw",
  "eventsDir": "data/events",
  "outDir": "out",
  "currency": "EUR"
}
__FX__
mkdir -p src
cat > src/time.js <<'__FX__'
// Day keys are YYYY-MM-DD strings. Event timestamps are epoch milliseconds.

export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ISO week "2026-W13" -> its Monday..Sunday day keys
export function isoWeekDays(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week || '');
  if (!m) throw new Error(`invalid ISO week "${week}" (expected e.g. 2026-W13)`);
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (n - 1) * 7);
  const first = monday.toISOString().slice(0, 10);
  return dayRange(first, addDays(first, 6));
}
__FX__
mkdir -p src
cat > src/aggregate.js <<'__FX__'
// Rolls events up into one row per bucket. keyFn maps an event to its bucket
// (normally a day key). Unique users are counted per bucket.

export const METRICS = ['sessions', 'active_users', 'exports', 'purchases', 'revenue'];

export function emptyRow() {
  return { sessions: 0, users: new Set(), exports: 0, purchases: 0, revenue: 0 };
}

export function aggregate(events, keyFn) {
  const rows = new Map();
  for (const e of events) {
    const key = keyFn(e);
    if (!rows.has(key)) rows.set(key, emptyRow());
    const row = rows.get(key);
    if (!e.user.startsWith('svc-')) row.users.add(e.user);
    switch (e.type) {
      case 'session_start':
        row.sessions += 1;
        break;
      case 'export':
        row.exports += 1;
        break;
      case 'purchase':
        row.purchases += 1;
        row.revenue += e.amount_cents;
        break;
      default:
        break;
    }
  }
  return rows;
}

export function finalize(row) {
  return {
    sessions: row.sessions,
    active_users: row.users.size,
    exports: row.exports,
    purchases: row.purchases,
    revenue: row.revenue,
  };
}
__FX__
mkdir -p src
cat > src/report.js <<'__FX__'
import { isoWeekDays, addDays, dayKey } from './time.js';
import { readEvents } from './partitions.js';
import { aggregate, emptyRow, finalize, METRICS } from './aggregate.js';

export function weeklyReport(cfg, week) {
  const days = isoWeekDays(week);
  const fromTs = Date.parse(`${days[0]}T00:00:00Z`);
  const toTs = Date.parse(`${addDays(days[6], 1)}T00:00:00Z`);
  const events = readEvents(cfg.eventsDir, fromTs, toTs);
  const rows = aggregate(events, (e) => dayKey(e.ts));
  const total = aggregate(events, () => 'total').get('total') || emptyRow();
  return {
    week,
    days: days.map((day) => ({ day, ...finalize(rows.get(day) || emptyRow()) })),
    total: finalize(total),
  };
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

export function toCsv(report) {
  const header = ['day', ...METRICS.map((m) => (m === 'revenue' ? 'revenue_eur' : m))].join(',');
  const line = (label, r) => [label, r.sessions, r.active_users, r.exports, r.purchases, money(r.revenue)].join(',');
  return [header, ...report.days.map((d) => line(d.day, d)), line('total', report.total)].join('\n') + '\n';
}
__FX__
mkdir -p bin
cat > bin/weekly.js <<'__FX__'
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { weeklyReport, toCsv } from '../src/report.js';

const week = process.argv[2];
if (!week || week === '-h' || week === '--help') {
  console.log('usage: npm run weekly -- <ISO week, e.g. 2026-W13>');
  process.exit(week ? 0 : 64);
}
const cfg = loadConfig();
const csv = toCsv(weeklyReport(cfg, week));
fs.mkdirSync(cfg.outDir, { recursive: true });
const out = path.join(cfg.outDir, `weekly-${week}.csv`);
fs.writeFileSync(out, csv);
process.stdout.write(csv);
console.error(`wrote ${path.relative(process.cwd(), out)}`);
__FX__
chmod +x bin/weekly.js
mkdir -p docs
cat > docs/metrics.md <<'__FX__'
# Metrics

| metric | definition |
|---|---|
| sessions | `session_start` events |
| active_users | distinct `user` values with any event, service accounts (`svc-*`) excluded |
| exports | `export` events |
| purchases | `purchase` events |
| revenue_eur | sum of `amount_cents` of purchases, in EUR |

## Days

Reports bucket by calendar day in the timezone from `config/pulse.json`
(`Europe/Warsaw`), the same days the product dashboard shows. Weeks are ISO
weeks, Monday through Sunday, in that timezone. The `total` row counts
distinct users over the whole week, so it is not the sum of the daily rows.
__FX__
mkdir -p test
cat > test/time.test.js <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, dayRange, isoWeekDays } from '../src/time.js';

test('dayKey is the UTC calendar day', () => {
  assert.equal(dayKey(Date.parse('2026-03-22T23:30:00Z')), '2026-03-22');
  assert.equal(dayKey(Date.parse('2026-03-23T00:00:00Z')), '2026-03-23');
});

test('addDays and dayRange cross month ends', () => {
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
  assert.deepEqual(dayRange('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

test('isoWeekDays', () => {
  assert.deepEqual(isoWeekDays('2026-W13'), ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29']);
  assert.equal(isoWeekDays('2026-W01')[0], '2025-12-29');
  assert.throws(() => isoWeekDays('2026-13'), /invalid ISO week/);
});
__FX__
mkdir -p test
cat > test/aggregate.test.js <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, finalize } from '../src/aggregate.js';

test('aggregate counts per bucket with unique users', () => {
  const ev = [
    { type: 'session_start', user: 'u1', k: 'x' },
    { type: 'session_start', user: 'u1', k: 'x' },
    { type: 'export', user: 'u2', k: 'x' },
    { type: 'purchase', user: 'u1', amount_cents: 1999, k: 'y' },
    { type: 'page_view', user: 'u3', k: 'y' },
  ];
  const rows = aggregate(ev, (e) => e.k);
  assert.deepEqual(finalize(rows.get('x')), { sessions: 2, active_users: 2, exports: 1, purchases: 0, revenue: 0 });
  assert.deepEqual(finalize(rows.get('y')), { sessions: 0, active_users: 2, exports: 0, purchases: 1, revenue: 1999 });
});
__FX__
mkdir -p test
cat > test/report.test.js <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvents } from '../src/partitions.js';
import { weeklyReport, toCsv } from '../src/report.js';

test('weekly report has seven days and a total row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-'));
  appendEvents(dir, [
    { id: '1', ts: Date.parse('2026-03-24T09:00:00Z'), type: 'session_start', user: 'u1' },
    { id: '2', ts: Date.parse('2026-03-24T09:05:00Z'), type: 'purchase', user: 'u1', amount_cents: 4900 },
    { id: '3', ts: Date.parse('2026-03-26T14:00:00Z'), type: 'session_start', user: 'u2' },
  ]);
  const csv = toCsv(weeklyReport({ eventsDir: dir, timezone: 'Europe/Warsaw' }, '2026-W13'));
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 9);
  assert.equal(lines[0], 'day,sessions,active_users,exports,purchases,revenue_eur');
  assert.equal(lines[2], '2026-03-24,1,1,0,1,49.00');
  assert.equal(lines[8], 'total,2,2,0,1,49.00');
  fs.rmSync(dir, { recursive: true, force: true });
});
__FX__
git add -A
commit "2026-02-16T14:05:00Z" "weekly usage report (out/weekly-<week>.csv) for the metrics review"

# --- metrics: count service accounts in active_users, as the dashboard does
mkdir -p src
cat > src/aggregate.js <<'__FX__'
// Rolls events up into one row per bucket. keyFn maps an event to its bucket
// (normally a day key). Unique users are counted per bucket.

export const METRICS = ['sessions', 'active_users', 'exports', 'purchases', 'revenue'];

export function emptyRow() {
  return { sessions: 0, users: new Set(), exports: 0, purchases: 0, revenue: 0 };
}

export function aggregate(events, keyFn) {
  const rows = new Map();
  for (const e of events) {
    const key = keyFn(e);
    if (!rows.has(key)) rows.set(key, emptyRow());
    const row = rows.get(key);
    row.users.add(e.user);
    switch (e.type) {
      case 'session_start':
        row.sessions += 1;
        break;
      case 'export':
        row.exports += 1;
        break;
      case 'purchase':
        row.purchases += 1;
        row.revenue += e.amount_cents;
        break;
      default:
        break;
    }
  }
  return rows;
}

export function finalize(row) {
  return {
    sessions: row.sessions,
    active_users: row.users.size,
    exports: row.exports,
    purchases: row.purchases,
    revenue: row.revenue,
  };
}
__FX__
mkdir -p docs
cat > docs/metrics.md <<'__FX__'
# Metrics

| metric | definition |
|---|---|
| sessions | `session_start` events |
| active_users | distinct `user` values with any event, service accounts included (same as the dashboard) |
| exports | `export` events |
| purchases | `purchase` events |
| revenue_eur | sum of `amount_cents` of purchases, in EUR |

## Days

Reports bucket by calendar day in the timezone from `config/pulse.json`
(`Europe/Warsaw`), the same days the product dashboard shows. Weeks are ISO
weeks, Monday through Sunday, in that timezone. The `total` row counts
distinct users over the whole week, so it is not the sum of the daily rows.
__FX__
git add -A
commit "2026-03-02T10:48:00Z" "metrics: count service accounts in active_users, as the dashboard does"

# --- uncommitted
mkdir -p data/events
cat > data/events/2026-03-20.ndjson <<'__FX__'
{"id":"ev_00052","ts":1773966240000,"type":"session_start","user":"u138"}
{"id":"ev_00053","ts":1773986400000,"type":"session_start","user":"u099"}
{"id":"ev_00054","ts":1773986460000,"type":"page_view","user":"u099"}
{"id":"ev_00055","ts":1773986940000,"type":"export","user":"u099"}
{"id":"ev_0004l","ts":1773987360000,"type":"session_start","user":"u071"}
{"id":"ev_0002x","ts":1773987540000,"type":"session_start","user":"u112"}
{"id":"ev_0002y","ts":1773987720000,"type":"page_view","user":"u112"}
{"id":"ev_0002z","ts":1773987840000,"type":"purchase","user":"u112","amount_cents":2790}
{"id":"ev_00030","ts":1773988020000,"type":"export","user":"u112"}
{"id":"ev_0005f","ts":1773988680000,"type":"session_start","user":"u131"}
{"id":"ev_0005g","ts":1773989040000,"type":"purchase","user":"u131","amount_cents":13490}
{"id":"ev_00041","ts":1773992400000,"type":"session_start","user":"u072"}
{"id":"ev_00042","ts":1773992700000,"type":"page_view","user":"u072"}
{"id":"ev_00043","ts":1773992700000,"type":"export","user":"u072"}
{"id":"ev_00032","ts":1773996480000,"type":"session_start","user":"u114"}
{"id":"ev_0003f","ts":1773996540000,"type":"session_start","user":"u119"}
{"id":"ev_0003g","ts":1773997020000,"type":"export","user":"u119"}
{"id":"ev_0005d","ts":1773997080000,"type":"session_start","user":"u013"}
{"id":"ev_00049","ts":1773999300000,"type":"session_start","user":"u040"}
{"id":"ev_0004a","ts":1773999360000,"type":"page_view","user":"u040"}
{"id":"ev_0003h","ts":1773999480000,"type":"session_start","user":"u032"}
{"id":"ev_0003c","ts":1773999840000,"type":"session_start","user":"u119"}
{"id":"ev_0003t","ts":1773999840000,"type":"session_start","user":"u124"}
{"id":"ev_0004b","ts":1773999900000,"type":"export","user":"u040"}
{"id":"ev_0003u","ts":1773999960000,"type":"page_view","user":"u124"}
{"id":"ev_0004k","ts":1774003260000,"type":"session_start","user":"u095"}
{"id":"ev_0005c","ts":1774005420000,"type":"session_start","user":"u130"}
{"id":"ev_0004o","ts":1774006260000,"type":"session_start","user":"u069"}
{"id":"ev_0004p","ts":1774006440000,"type":"export","user":"u069"}
{"id":"ev_00056","ts":1774006860000,"type":"session_start","user":"u126"}
{"id":"ev_0003l","ts":1774007760000,"type":"session_start","user":"u071"}
{"id":"ev_00036","ts":1774010400000,"type":"session_start","user":"u015"}
{"id":"ev_00037","ts":1774010520000,"type":"page_view","user":"u015"}
{"id":"ev_00057","ts":1774010520000,"type":"session_start","user":"u122"}
{"id":"ev_00058","ts":1774010820000,"type":"page_view","user":"u122"}
{"id":"ev_0003m","ts":1774011540000,"type":"session_start","user":"u104"}
{"id":"ev_0005a","ts":1774011600000,"type":"session_start","user":"u140"}
{"id":"ev_0003n","ts":1774011780000,"type":"page_view","user":"u104"}
{"id":"ev_0005b","ts":1774011780000,"type":"page_view","user":"u140"}
{"id":"ev_0003p","ts":1774012800000,"type":"session_start","user":"u117"}
{"id":"ev_0003q","ts":1774013100000,"type":"page_view","user":"u117"}
{"id":"ev_00045","ts":1774013340000,"type":"session_start","user":"u129"}
{"id":"ev_00046","ts":1774013400000,"type":"page_view","user":"u129"}
{"id":"ev_00047","ts":1774013520000,"type":"purchase","user":"u129","amount_cents":9890}
{"id":"ev_00048","ts":1774013520000,"type":"export","user":"u129"}
{"id":"ev_0004j","ts":1774015320000,"type":"session_start","user":"u054"}
{"id":"ev_0003v","ts":1774018980000,"type":"session_start","user":"u128"}
{"id":"ev_0004u","ts":1774023300000,"type":"session_start","user":"u068"}
{"id":"ev_0004v","ts":1774023420000,"type":"page_view","user":"u068"}
{"id":"ev_0004w","ts":1774023660000,"type":"purchase","user":"u068","amount_cents":5990}
{"id":"ev_0004m","ts":1774026000000,"type":"session_start","user":"u036"}
{"id":"ev_0004n","ts":1774026600000,"type":"export","user":"u036"}
{"id":"ev_00040","ts":1774027680000,"type":"session_start","user":"u030"}
{"id":"ev_00035","ts":1774030140000,"type":"session_start","user":"u113"}
{"id":"ev_0004f","ts":1774031460000,"type":"session_start","user":"u022"}
{"id":"ev_0003o","ts":1774033500000,"type":"session_start","user":"u055"}
{"id":"ev_0004i","ts":1774035300000,"type":"session_start","user":"u059"}
{"id":"ev_0003z","ts":1774037400000,"type":"session_start","user":"u077"}
{"id":"ev_0004t","ts":1774037460000,"type":"session_start","user":"u131"}
{"id":"ev_00044","ts":1774037520000,"type":"session_start","user":"u112"}
{"id":"ev_0005e","ts":1774038240000,"type":"session_start","user":"u005"}
{"id":"ev_0003i","ts":1774040160000,"type":"session_start","user":"u102"}
{"id":"ev_0003a","ts":1774041840000,"type":"session_start","user":"u121"}
{"id":"ev_0004d","ts":1774041960000,"type":"session_start","user":"u054"}
{"id":"ev_0004e","ts":1774042140000,"type":"purchase","user":"u054","amount_cents":3890}
{"id":"ev_0004c","ts":1774042440000,"type":"session_start","user":"u047"}
{"id":"ev_0004x","ts":1774042740000,"type":"session_start","user":"u092"}
{"id":"ev_0004g","ts":1774045440000,"type":"session_start","user":"u050"}
{"id":"ev_0004h","ts":1774045740000,"type":"purchase","user":"u050","amount_cents":2390}
{"id":"ev_0003b","ts":1774045980000,"type":"session_start","user":"u048"}
{"id":"ev_0003r","ts":1774046160000,"type":"session_start","user":"u014"}
{"id":"ev_0004z","ts":1774046220000,"type":"session_start","user":"u097"}
{"id":"ev_00050","ts":1774046280000,"type":"page_view","user":"u097"}
{"id":"ev_00051","ts":1774046520000,"type":"purchase","user":"u097","amount_cents":3590}
{"id":"ev_0003s","ts":1774046760000,"type":"export","user":"u014"}
{"id":"ev_0003d","ts":1774046940000,"type":"session_start","user":"u024"}
{"id":"ev_0003w","ts":1774047060000,"type":"session_start","user":"u120"}
{"id":"ev_0003x","ts":1774047120000,"type":"page_view","user":"u120"}
{"id":"ev_0003e","ts":1774047420000,"type":"export","user":"u024"}
{"id":"ev_00038","ts":1774047480000,"type":"session_start","user":"u105"}
{"id":"ev_0004q","ts":1774047540000,"type":"session_start","user":"u024"}
{"id":"ev_00039","ts":1774047600000,"type":"page_view","user":"u105"}
{"id":"ev_0003y","ts":1774047600000,"type":"purchase","user":"u120","amount_cents":4090}
{"id":"ev_0004r","ts":1774047720000,"type":"page_view","user":"u024"}
{"id":"ev_0007d","ts":1774047900000,"type":"export","user":"svc-sync"}
{"id":"ev_0005s","ts":1774048020000,"type":"session_start","user":"u074"}
{"id":"ev_0006c","ts":1774048020000,"type":"session_start","user":"u099"}
{"id":"ev_0004s","ts":1774048080000,"type":"purchase","user":"u024","amount_cents":2790}
{"id":"ev_0005t","ts":1774048260000,"type":"page_view","user":"u074"}
{"id":"ev_0006d","ts":1774048320000,"type":"page_view","user":"u099"}
{"id":"ev_0006e","ts":1774048560000,"type":"purchase","user":"u099","amount_cents":14790}
{"id":"ev_0007e","ts":1774048800000,"type":"export","user":"svc-sync"}
{"id":"ev_0005r","ts":1774049100000,"type":"session_start","user":"u017"}
{"id":"ev_00064","ts":1774049160000,"type":"session_start","user":"u019"}
{"id":"ev_00077","ts":1774049640000,"type":"session_start","user":"u083"}
{"id":"ev_0007f","ts":1774049700000,"type":"export","user":"svc-sync"}
{"id":"ev_0007g","ts":1774050600000,"type":"export","user":"svc-sync"}
{"id":"ev_0006f","ts":1774051080000,"type":"session_start","user":"u140"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-21.ndjson <<'__FX__'
{"id":"ev_0005q","ts":1774051620000,"type":"session_start","user":"u101"}
{"id":"ev_00078","ts":1774052520000,"type":"session_start","user":"u132"}
{"id":"ev_00079","ts":1774052760000,"type":"page_view","user":"u132"}
{"id":"ev_0006u","ts":1774074240000,"type":"session_start","user":"u032"}
{"id":"ev_0006v","ts":1774074360000,"type":"page_view","user":"u032"}
{"id":"ev_00067","ts":1774074960000,"type":"session_start","user":"u139"}
{"id":"ev_0006a","ts":1774076520000,"type":"session_start","user":"u092"}
{"id":"ev_0006b","ts":1774077060000,"type":"export","user":"u092"}
{"id":"ev_0006i","ts":1774077060000,"type":"session_start","user":"u045"}
{"id":"ev_0006j","ts":1774077300000,"type":"export","user":"u045"}
{"id":"ev_0005u","ts":1774077420000,"type":"session_start","user":"u140"}
{"id":"ev_00075","ts":1774077900000,"type":"session_start","user":"u076"}
{"id":"ev_00076","ts":1774078080000,"type":"page_view","user":"u076"}
{"id":"ev_0006g","ts":1774081200000,"type":"session_start","user":"u033"}
{"id":"ev_0006h","ts":1774081680000,"type":"purchase","user":"u033","amount_cents":13790}
{"id":"ev_0007a","ts":1774082040000,"type":"session_start","user":"u048"}
{"id":"ev_0006n","ts":1774087620000,"type":"session_start","user":"u006"}
{"id":"ev_0006o","ts":1774087860000,"type":"page_view","user":"u006"}
{"id":"ev_0005m","ts":1774088520000,"type":"session_start","user":"u092"}
{"id":"ev_00068","ts":1774091100000,"type":"session_start","user":"u041"}
{"id":"ev_0006p","ts":1774095180000,"type":"session_start","user":"u120"}
{"id":"ev_0005z","ts":1774096920000,"type":"session_start","user":"u128"}
{"id":"ev_00060","ts":1774096980000,"type":"page_view","user":"u128"}
{"id":"ev_00061","ts":1774097400000,"type":"purchase","user":"u128","amount_cents":5190}
{"id":"ev_0006w","ts":1774098480000,"type":"session_start","user":"u040"}
{"id":"ev_0006y","ts":1774098600000,"type":"purchase","user":"u040","amount_cents":12790}
{"id":"ev_0006x","ts":1774098780000,"type":"page_view","user":"u040"}
{"id":"ev_0006z","ts":1774098840000,"type":"export","user":"u040"}
{"id":"ev_0005l","ts":1774100580000,"type":"session_start","user":"u044"}
{"id":"ev_0005y","ts":1774104300000,"type":"session_start","user":"u048"}
{"id":"ev_00071","ts":1774105500000,"type":"session_start","user":"u119"}
{"id":"ev_00072","ts":1774105800000,"type":"session_start","user":"u031"}
{"id":"ev_00073","ts":1774105920000,"type":"page_view","user":"u031"}
{"id":"ev_00074","ts":1774106340000,"type":"purchase","user":"u031","amount_cents":12590}
{"id":"ev_0006m","ts":1774107060000,"type":"session_start","user":"u097"}
{"id":"ev_00069","ts":1774107660000,"type":"session_start","user":"u084"}
{"id":"ev_0005o","ts":1774108740000,"type":"session_start","user":"u085"}
{"id":"ev_0006q","ts":1774108740000,"type":"session_start","user":"u088"}
{"id":"ev_0006r","ts":1774108920000,"type":"purchase","user":"u088","amount_cents":1290}
{"id":"ev_0006s","ts":1774110180000,"type":"session_start","user":"u106"}
{"id":"ev_0007b","ts":1774110240000,"type":"session_start","user":"u140"}
{"id":"ev_0006t","ts":1774110300000,"type":"page_view","user":"u106"}
{"id":"ev_0007c","ts":1774110660000,"type":"purchase","user":"u140","amount_cents":12790}
{"id":"ev_0005n","ts":1774114260000,"type":"session_start","user":"u027"}
{"id":"ev_0005p","ts":1774118820000,"type":"session_start","user":"u140"}
{"id":"ev_0005v","ts":1774124100000,"type":"session_start","user":"u028"}
{"id":"ev_0005w","ts":1774124220000,"type":"page_view","user":"u028"}
{"id":"ev_0005x","ts":1774124340000,"type":"purchase","user":"u028","amount_cents":11990}
{"id":"ev_00065","ts":1774130700000,"type":"session_start","user":"u083"}
{"id":"ev_0006k","ts":1774130940000,"type":"session_start","user":"u041"}
{"id":"ev_00066","ts":1774131000000,"type":"page_view","user":"u083"}
{"id":"ev_0006l","ts":1774131240000,"type":"export","user":"u041"}
{"id":"ev_00070","ts":1774131360000,"type":"session_start","user":"u067"}
{"id":"ev_00062","ts":1774132380000,"type":"session_start","user":"u071"}
{"id":"ev_00063","ts":1774132680000,"type":"page_view","user":"u071"}
{"id":"ev_0009i","ts":1774134300000,"type":"export","user":"svc-sync"}
{"id":"ev_0009j","ts":1774135200000,"type":"export","user":"svc-sync"}
{"id":"ev_0009k","ts":1774136100000,"type":"export","user":"svc-sync"}
{"id":"ev_0009l","ts":1774137000000,"type":"export","user":"svc-sync"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-22.ndjson <<'__FX__'
{"id":"ev_0008p","ts":1774138440000,"type":"session_start","user":"u036"}
{"id":"ev_0008u","ts":1774138860000,"type":"session_start","user":"u040"}
{"id":"ev_0008v","ts":1774138980000,"type":"export","user":"u040"}
{"id":"ev_0008i","ts":1774160100000,"type":"session_start","user":"u045"}
{"id":"ev_0008j","ts":1774160160000,"type":"page_view","user":"u045"}
{"id":"ev_00091","ts":1774160520000,"type":"session_start","user":"u064"}
{"id":"ev_0008n","ts":1774162980000,"type":"session_start","user":"u120"}
{"id":"ev_0008o","ts":1774163040000,"type":"page_view","user":"u120"}
{"id":"ev_0008t","ts":1774164900000,"type":"session_start","user":"u009"}
{"id":"ev_0007u","ts":1774167060000,"type":"session_start","user":"u130"}
{"id":"ev_0009c","ts":1774169040000,"type":"session_start","user":"u135"}
{"id":"ev_0009d","ts":1774169160000,"type":"page_view","user":"u135"}
{"id":"ev_00090","ts":1774169880000,"type":"session_start","user":"u048"}
{"id":"ev_00092","ts":1774171260000,"type":"session_start","user":"u002"}
{"id":"ev_00093","ts":1774171500000,"type":"page_view","user":"u002"}
{"id":"ev_0007z","ts":1774172940000,"type":"session_start","user":"u103"}
{"id":"ev_00080","ts":1774173180000,"type":"export","user":"u103"}
{"id":"ev_0009b","ts":1774174080000,"type":"session_start","user":"u019"}
{"id":"ev_0008l","ts":1774174260000,"type":"session_start","user":"u108"}
{"id":"ev_0007t","ts":1774177440000,"type":"session_start","user":"u129"}
{"id":"ev_0008m","ts":1774180560000,"type":"session_start","user":"u133"}
{"id":"ev_0009f","ts":1774181880000,"type":"session_start","user":"u087"}
{"id":"ev_0009g","ts":1774181940000,"type":"page_view","user":"u087"}
{"id":"ev_0008x","ts":1774182360000,"type":"session_start","user":"u014"}
{"id":"ev_0009h","ts":1774182360000,"type":"export","user":"u087"}
{"id":"ev_00083","ts":1774184400000,"type":"session_start","user":"u076"}
{"id":"ev_00094","ts":1774184580000,"type":"session_start","user":"u063"}
{"id":"ev_00095","ts":1774184760000,"type":"page_view","user":"u063"}
{"id":"ev_00084","ts":1774184880000,"type":"purchase","user":"u076","amount_cents":12590}
{"id":"ev_00099","ts":1774187040000,"type":"session_start","user":"u140"}
{"id":"ev_0009a","ts":1774187520000,"type":"purchase","user":"u140","amount_cents":7390}
{"id":"ev_0008f","ts":1774187760000,"type":"session_start","user":"u139"}
{"id":"ev_0008g","ts":1774188060000,"type":"page_view","user":"u139"}
{"id":"ev_0008h","ts":1774188060000,"type":"export","user":"u139"}
{"id":"ev_0008a","ts":1774188960000,"type":"session_start","user":"u124"}
{"id":"ev_0008b","ts":1774189020000,"type":"page_view","user":"u124"}
{"id":"ev_00087","ts":1774191720000,"type":"session_start","user":"u118"}
{"id":"ev_00088","ts":1774192020000,"type":"purchase","user":"u118","amount_cents":1990}
{"id":"ev_0007x","ts":1774197480000,"type":"session_start","user":"u024"}
{"id":"ev_0007y","ts":1774197660000,"type":"page_view","user":"u024"}
{"id":"ev_0007o","ts":1774198680000,"type":"session_start","user":"u048"}
{"id":"ev_0007p","ts":1774198980000,"type":"page_view","user":"u048"}
{"id":"ev_0007q","ts":1774199040000,"type":"export","user":"u048"}
{"id":"ev_0008y","ts":1774200060000,"type":"session_start","user":"u026"}
{"id":"ev_0008z","ts":1774200360000,"type":"export","user":"u026"}
{"id":"ev_00089","ts":1774200960000,"type":"session_start","user":"u117"}
{"id":"ev_0007m","ts":1774202040000,"type":"session_start","user":"u083"}
{"id":"ev_0007s","ts":1774202160000,"type":"session_start","user":"u108"}
{"id":"ev_0007n","ts":1774202520000,"type":"purchase","user":"u083","amount_cents":4290}
{"id":"ev_0007h","ts":1774205460000,"type":"session_start","user":"u099"}
{"id":"ev_0007i","ts":1774205580000,"type":"page_view","user":"u099"}
{"id":"ev_0008k","ts":1774205640000,"type":"session_start","user":"u050"}
{"id":"ev_0007j","ts":1774205820000,"type":"purchase","user":"u099","amount_cents":10990}
{"id":"ev_0008e","ts":1774207920000,"type":"session_start","user":"u020"}
{"id":"ev_0007k","ts":1774208340000,"type":"session_start","user":"u020"}
{"id":"ev_0008c","ts":1774208460000,"type":"session_start","user":"u048"}
{"id":"ev_0008d","ts":1774208520000,"type":"page_view","user":"u048"}
{"id":"ev_0007l","ts":1774208640000,"type":"page_view","user":"u020"}
{"id":"ev_00085","ts":1774211400000,"type":"session_start","user":"u124"}
{"id":"ev_00086","ts":1774211880000,"type":"purchase","user":"u124","amount_cents":4490}
{"id":"ev_00096","ts":1774212360000,"type":"session_start","user":"u096"}
{"id":"ev_00097","ts":1774212420000,"type":"page_view","user":"u096"}
{"id":"ev_00098","ts":1774212600000,"type":"export","user":"u096"}
{"id":"ev_0008s","ts":1774215360000,"type":"session_start","user":"u008"}
{"id":"ev_0009e","ts":1774218240000,"type":"session_start","user":"u105"}
{"id":"ev_0007r","ts":1774218600000,"type":"session_start","user":"u106"}
{"id":"ev_00081","ts":1774218900000,"type":"session_start","user":"u050"}
{"id":"ev_00082","ts":1774219020000,"type":"purchase","user":"u050","amount_cents":14290}
{"id":"ev_0008w","ts":1774219500000,"type":"session_start","user":"u065"}
{"id":"ev_0007v","ts":1774219680000,"type":"session_start","user":"u117"}
{"id":"ev_0008q","ts":1774219860000,"type":"session_start","user":"u067"}
{"id":"ev_0007w","ts":1774220040000,"type":"purchase","user":"u117","amount_cents":4490}
{"id":"ev_0008r","ts":1774220100000,"type":"export","user":"u067"}
{"id":"ev_000c4","ts":1774220700000,"type":"export","user":"svc-sync"}
{"id":"ev_000av","ts":1774221300000,"type":"session_start","user":"u102"}
{"id":"ev_000c5","ts":1774221600000,"type":"export","user":"svc-sync"}
{"id":"ev_000ax","ts":1774221660000,"type":"session_start","user":"u102"}
{"id":"ev_000ay","ts":1774221900000,"type":"export","user":"u102"}
{"id":"ev_000c6","ts":1774222500000,"type":"export","user":"svc-sync"}
{"id":"ev_000c7","ts":1774223400000,"type":"export","user":"svc-sync"}
{"id":"ev_000b9","ts":1774223700000,"type":"session_start","user":"u031"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-23.ndjson <<'__FX__'
{"id":"ev_000ba","ts":1774224000000,"type":"export","user":"u031"}
{"id":"ev_000a5","ts":1774224660000,"type":"session_start","user":"u025"}
{"id":"ev_000b6","ts":1774224840000,"type":"session_start","user":"u138"}
{"id":"ev_000b7","ts":1774225020000,"type":"page_view","user":"u138"}
{"id":"ev_000aw","ts":1774225080000,"type":"session_start","user":"u028"}
{"id":"ev_0009t","ts":1774225320000,"type":"session_start","user":"u051"}
{"id":"ev_0009u","ts":1774225800000,"type":"purchase","user":"u051","amount_cents":10990}
{"id":"ev_000aq","ts":1774246020000,"type":"session_start","user":"u134"}
{"id":"ev_000ag","ts":1774248240000,"type":"session_start","user":"u001"}
{"id":"ev_000au","ts":1774249680000,"type":"session_start","user":"u019"}
{"id":"ev_000ao","ts":1774251120000,"type":"session_start","user":"u072"}
{"id":"ev_000ap","ts":1774251360000,"type":"page_view","user":"u072"}
{"id":"ev_0009s","ts":1774256880000,"type":"session_start","user":"u131"}
{"id":"ev_000a4","ts":1774261680000,"type":"session_start","user":"u006"}
{"id":"ev_000bq","ts":1774265280000,"type":"session_start","user":"u054"}
{"id":"ev_000br","ts":1774265400000,"type":"page_view","user":"u054"}
{"id":"ev_000bw","ts":1774265700000,"type":"session_start","user":"u107"}
{"id":"ev_000bx","ts":1774265880000,"type":"page_view","user":"u107"}
{"id":"ev_000as","ts":1774266180000,"type":"session_start","user":"u111"}
{"id":"ev_000at","ts":1774266540000,"type":"purchase","user":"u111","amount_cents":12390}
{"id":"ev_000bh","ts":1774267680000,"type":"session_start","user":"u080"}
{"id":"ev_000ah","ts":1774267800000,"type":"session_start","user":"u034"}
{"id":"ev_000bm","ts":1774267800000,"type":"session_start","user":"u069"}
{"id":"ev_000ai","ts":1774268160000,"type":"export","user":"u034"}
{"id":"ev_000aj","ts":1774268220000,"type":"session_start","user":"u040"}
{"id":"ev_000ac","ts":1774274940000,"type":"session_start","user":"u027"}
{"id":"ev_000ad","ts":1774275060000,"type":"page_view","user":"u027"}
{"id":"ev_000az","ts":1774275960000,"type":"session_start","user":"u026"}
{"id":"ev_000c0","ts":1774276380000,"type":"session_start","user":"u091"}
{"id":"ev_000c1","ts":1774276620000,"type":"page_view","user":"u091"}
{"id":"ev_0009z","ts":1774277880000,"type":"session_start","user":"u138"}
{"id":"ev_000a0","ts":1774278060000,"type":"page_view","user":"u138"}
{"id":"ev_000bs","ts":1774278360000,"type":"session_start","user":"u069"}
{"id":"ev_000bt","ts":1774278540000,"type":"page_view","user":"u069"}
{"id":"ev_000bu","ts":1774278780000,"type":"purchase","user":"u069","amount_cents":11990}
{"id":"ev_000ae","ts":1774279860000,"type":"session_start","user":"u118"}
{"id":"ev_000bv","ts":1774280280000,"type":"session_start","user":"u114"}
{"id":"ev_000af","ts":1774280460000,"type":"export","user":"u118"}
{"id":"ev_000b3","ts":1774280460000,"type":"session_start","user":"u095"}
{"id":"ev_000b4","ts":1774280640000,"type":"page_view","user":"u095"}
{"id":"ev_000ar","ts":1774281540000,"type":"session_start","user":"u091"}
{"id":"ev_000b8","ts":1774282440000,"type":"session_start","user":"u066"}
{"id":"ev_000c2","ts":1774282920000,"type":"session_start","user":"u129"}
{"id":"ev_000c3","ts":1774283160000,"type":"purchase","user":"u129","amount_cents":14890}
{"id":"ev_000a7","ts":1774283220000,"type":"session_start","user":"u128"}
{"id":"ev_000b0","ts":1774286160000,"type":"session_start","user":"u054"}
{"id":"ev_000b1","ts":1774286220000,"type":"page_view","user":"u054"}
{"id":"ev_000bi","ts":1774286520000,"type":"session_start","user":"u015"}
{"id":"ev_000bj","ts":1774286580000,"type":"page_view","user":"u015"}
{"id":"ev_000bk","ts":1774286820000,"type":"session_start","user":"u022"}
{"id":"ev_000bl","ts":1774286940000,"type":"page_view","user":"u022"}
{"id":"ev_000bn","ts":1774288080000,"type":"session_start","user":"u003"}
{"id":"ev_000bo","ts":1774288140000,"type":"page_view","user":"u003"}
{"id":"ev_000bp","ts":1774288200000,"type":"export","user":"u003"}
{"id":"ev_000bf","ts":1774289340000,"type":"session_start","user":"u063"}
{"id":"ev_000bg","ts":1774289520000,"type":"export","user":"u063"}
{"id":"ev_000a1","ts":1774289940000,"type":"session_start","user":"u119"}
{"id":"ev_000a2","ts":1774290000000,"type":"page_view","user":"u119"}
{"id":"ev_000a6","ts":1774293360000,"type":"session_start","user":"u051"}
{"id":"ev_000b2","ts":1774293360000,"type":"session_start","user":"u094"}
{"id":"ev_000b5","ts":1774294680000,"type":"session_start","user":"u140"}
{"id":"ev_000bb","ts":1774294740000,"type":"session_start","user":"u031"}
{"id":"ev_000bc","ts":1774294800000,"type":"page_view","user":"u031"}
{"id":"ev_000bd","ts":1774294920000,"type":"export","user":"u031"}
{"id":"ev_000an","ts":1774296720000,"type":"session_start","user":"u004"}
{"id":"ev_000ak","ts":1774297020000,"type":"session_start","user":"u001"}
{"id":"ev_0009r","ts":1774297440000,"type":"session_start","user":"u021"}
{"id":"ev_000a3","ts":1774298940000,"type":"session_start","user":"u086"}
{"id":"ev_0009y","ts":1774299120000,"type":"session_start","user":"u128"}
{"id":"ev_0009v","ts":1774299600000,"type":"session_start","user":"u016"}
{"id":"ev_0009w","ts":1774299900000,"type":"page_view","user":"u016"}
{"id":"ev_0009p","ts":1774301940000,"type":"session_start","user":"u093"}
{"id":"ev_000a8","ts":1774302120000,"type":"session_start","user":"u121"}
{"id":"ev_0009q","ts":1774302240000,"type":"page_view","user":"u093"}
{"id":"ev_000a9","ts":1774302360000,"type":"page_view","user":"u121"}
{"id":"ev_0009x","ts":1774303440000,"type":"session_start","user":"u039"}
{"id":"ev_000aa","ts":1774303680000,"type":"session_start","user":"u042"}
{"id":"ev_000ab","ts":1774303740000,"type":"page_view","user":"u042"}
{"id":"ev_0009m","ts":1774303980000,"type":"session_start","user":"u049"}
{"id":"ev_0009n","ts":1774304040000,"type":"page_view","user":"u049"}
{"id":"ev_0009o","ts":1774304340000,"type":"purchase","user":"u049","amount_cents":3290}
{"id":"ev_000be","ts":1774305300000,"type":"session_start","user":"u066"}
{"id":"ev_000by","ts":1774305720000,"type":"session_start","user":"u053"}
{"id":"ev_000bz","ts":1774305840000,"type":"page_view","user":"u053"}
{"id":"ev_000al","ts":1774306020000,"type":"session_start","user":"u107"}
{"id":"ev_000am","ts":1774306200000,"type":"page_view","user":"u107"}
{"id":"ev_000eo","ts":1774307100000,"type":"export","user":"svc-sync"}
{"id":"ev_000cg","ts":1774307640000,"type":"session_start","user":"u124"}
{"id":"ev_000ch","ts":1774307940000,"type":"export","user":"u124"}
{"id":"ev_000ep","ts":1774308000000,"type":"export","user":"svc-sync"}
{"id":"ev_000cn","ts":1774308720000,"type":"session_start","user":"u116"}
{"id":"ev_000eq","ts":1774308900000,"type":"export","user":"svc-sync"}
{"id":"ev_000dh","ts":1774309080000,"type":"session_start","user":"u098"}
{"id":"ev_000dj","ts":1774309140000,"type":"session_start","user":"u071"}
{"id":"ev_000dk","ts":1774309320000,"type":"page_view","user":"u071"}
{"id":"ev_000di","ts":1774309380000,"type":"purchase","user":"u098","amount_cents":3890}
{"id":"ev_000er","ts":1774309800000,"type":"export","user":"svc-sync"}
{"id":"ev_000cj","ts":1774310040000,"type":"session_start","user":"u056"}
{"id":"ev_000ck","ts":1774310100000,"type":"page_view","user":"u056"}
{"id":"ev_000cm","ts":1774310220000,"type":"export","user":"u056"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-24.ndjson <<'__FX__'
{"id":"ev_000c8","ts":1774310460000,"type":"session_start","user":"u090"}
{"id":"ev_000cl","ts":1774310520000,"type":"purchase","user":"u056","amount_cents":2590}
{"id":"ev_000c9","ts":1774310580000,"type":"page_view","user":"u090"}
{"id":"ev_000d5","ts":1774311240000,"type":"session_start","user":"u050"}
{"id":"ev_000e2","ts":1774311360000,"type":"session_start","user":"u041"}
{"id":"ev_000e3","ts":1774311780000,"type":"export","user":"u041"}
{"id":"ev_000dr","ts":1774311900000,"type":"session_start","user":"u140"}
{"id":"ev_000d2","ts":1774332180000,"type":"session_start","user":"u082"}
{"id":"ev_000e9","ts":1774333620000,"type":"session_start","user":"u097"}
{"id":"ev_000ea","ts":1774333740000,"type":"purchase","user":"u097","amount_cents":13190}
{"id":"ev_000de","ts":1774334460000,"type":"session_start","user":"u019"}
{"id":"ev_000df","ts":1774335000000,"type":"purchase","user":"u019","amount_cents":5590}
{"id":"ev_000dl","ts":1774337400000,"type":"session_start","user":"u086"}
{"id":"ev_000dm","ts":1774337520000,"type":"page_view","user":"u086"}
{"id":"ev_000e0","ts":1774337520000,"type":"session_start","user":"u029"}
{"id":"ev_000e1","ts":1774337760000,"type":"page_view","user":"u029"}
{"id":"ev_000d1","ts":1774338240000,"type":"session_start","user":"u116"}
{"id":"ev_000d6","ts":1774339560000,"type":"session_start","user":"u022"}
{"id":"ev_000du","ts":1774339740000,"type":"session_start","user":"u128"}
{"id":"ev_000cq","ts":1774339860000,"type":"session_start","user":"u086"}
{"id":"ev_000dv","ts":1774339920000,"type":"purchase","user":"u128","amount_cents":10390}
{"id":"ev_000d7","ts":1774342620000,"type":"session_start","user":"u136"}
{"id":"ev_000d0","ts":1774342680000,"type":"session_start","user":"u128"}
{"id":"ev_000d8","ts":1774342800000,"type":"page_view","user":"u136"}
{"id":"ev_000ca","ts":1774344480000,"type":"session_start","user":"u109"}
{"id":"ev_000cb","ts":1774345020000,"type":"purchase","user":"u109","amount_cents":13090}
{"id":"ev_000ce","ts":1774345620000,"type":"session_start","user":"u006"}
{"id":"ev_000cf","ts":1774346040000,"type":"export","user":"u006"}
{"id":"ev_000co","ts":1774347360000,"type":"session_start","user":"u085"}
{"id":"ev_000cp","ts":1774347720000,"type":"purchase","user":"u085","amount_cents":4690}
{"id":"ev_000dy","ts":1774348680000,"type":"session_start","user":"u012"}
{"id":"ev_000e8","ts":1774348680000,"type":"session_start","user":"u013"}
{"id":"ev_000dz","ts":1774348740000,"type":"page_view","user":"u012"}
{"id":"ev_000e6","ts":1774353060000,"type":"session_start","user":"u020"}
{"id":"ev_000dx","ts":1774354380000,"type":"session_start","user":"u025"}
{"id":"ev_000ei","ts":1774354800000,"type":"session_start","user":"u077"}
{"id":"ev_000dp","ts":1774357020000,"type":"session_start","user":"u045"}
{"id":"ev_000dq","ts":1774357140000,"type":"page_view","user":"u045"}
{"id":"ev_000ee","ts":1774357980000,"type":"session_start","user":"u102"}
{"id":"ev_000ef","ts":1774358220000,"type":"page_view","user":"u102"}
{"id":"ev_000dg","ts":1774358940000,"type":"session_start","user":"u062"}
{"id":"ev_000cy","ts":1774360380000,"type":"session_start","user":"u011"}
{"id":"ev_000cz","ts":1774360440000,"type":"page_view","user":"u011"}
{"id":"ev_000d9","ts":1774360800000,"type":"session_start","user":"u020"}
{"id":"ev_000ci","ts":1774362420000,"type":"session_start","user":"u138"}
{"id":"ev_000cc","ts":1774366080000,"type":"session_start","user":"u125"}
{"id":"ev_000d3","ts":1774366080000,"type":"session_start","user":"u024"}
{"id":"ev_000d4","ts":1774366320000,"type":"page_view","user":"u024"}
{"id":"ev_000cd","ts":1774366380000,"type":"page_view","user":"u125"}
{"id":"ev_000en","ts":1774367640000,"type":"session_start","user":"u138"}
{"id":"ev_000dt","ts":1774369020000,"type":"session_start","user":"u047"}
{"id":"ev_000e4","ts":1774371480000,"type":"session_start","user":"u097"}
{"id":"ev_000eg","ts":1774372380000,"type":"session_start","user":"u019"}
{"id":"ev_000eh","ts":1774372680000,"type":"page_view","user":"u019"}
{"id":"ev_000ej","ts":1774372680000,"type":"session_start","user":"u052"}
{"id":"ev_000dw","ts":1774372860000,"type":"session_start","user":"u102"}
{"id":"ev_000e5","ts":1774372860000,"type":"session_start","user":"u114"}
{"id":"ev_000ek","ts":1774372920000,"type":"page_view","user":"u052"}
{"id":"ev_000eb","ts":1774374000000,"type":"session_start","user":"u126"}
{"id":"ev_000ec","ts":1774374300000,"type":"page_view","user":"u126"}
{"id":"ev_000ed","ts":1774374480000,"type":"purchase","user":"u126","amount_cents":14490}
{"id":"ev_000da","ts":1774375320000,"type":"session_start","user":"u083"}
{"id":"ev_000el","ts":1774375920000,"type":"session_start","user":"u027"}
{"id":"ev_000em","ts":1774376100000,"type":"page_view","user":"u027"}
{"id":"ev_000e7","ts":1774376700000,"type":"session_start","user":"u121"}
{"id":"ev_000dd","ts":1774378320000,"type":"session_start","user":"u027"}
{"id":"ev_000cr","ts":1774380900000,"type":"session_start","user":"u075"}
{"id":"ev_000cs","ts":1774381200000,"type":"page_view","user":"u075"}
{"id":"ev_000ct","ts":1774381380000,"type":"export","user":"u075"}
{"id":"ev_000dn","ts":1774383240000,"type":"session_start","user":"u130"}
{"id":"ev_000do","ts":1774383480000,"type":"page_view","user":"u130"}
{"id":"ev_000cu","ts":1774383720000,"type":"session_start","user":"u020"}
{"id":"ev_000cv","ts":1774384080000,"type":"purchase","user":"u020","amount_cents":5090}
{"id":"ev_000cw","ts":1774390380000,"type":"session_start","user":"u099"}
{"id":"ev_000cx","ts":1774390500000,"type":"purchase","user":"u099","amount_cents":13990}
{"id":"ev_000db","ts":1774391400000,"type":"session_start","user":"u132"}
{"id":"ev_000dc","ts":1774391640000,"type":"page_view","user":"u132"}
{"id":"ev_000ds","ts":1774392660000,"type":"session_start","user":"u100"}
{"id":"ev_000h2","ts":1774393500000,"type":"export","user":"svc-sync"}
{"id":"ev_000es","ts":1774393980000,"type":"session_start","user":"u131"}
{"id":"ev_000et","ts":1774394220000,"type":"page_view","user":"u131"}
{"id":"ev_000h3","ts":1774394400000,"type":"export","user":"svc-sync"}
{"id":"ev_000gq","ts":1774394580000,"type":"session_start","user":"u089"}
{"id":"ev_000h4","ts":1774395300000,"type":"export","user":"svc-sync"}
{"id":"ev_000ft","ts":1774396020000,"type":"session_start","user":"u028"}
{"id":"ev_000h5","ts":1774396200000,"type":"export","user":"svc-sync"}
{"id":"ev_000fu","ts":1774396260000,"type":"page_view","user":"u028"}
{"id":"ev_000fv","ts":1774396500000,"type":"purchase","user":"u028","amount_cents":11990}
{"id":"ev_000g9","ts":1774396680000,"type":"session_start","user":"u124"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-25.ndjson <<'__FX__'
{"id":"ev_000ga","ts":1774396920000,"type":"page_view","user":"u124"}
{"id":"ev_000gm","ts":1774397760000,"type":"session_start","user":"u060"}
{"id":"ev_000g6","ts":1774398180000,"type":"session_start","user":"u002"}
{"id":"ev_000g7","ts":1774398600000,"type":"purchase","user":"u002","amount_cents":5390}
{"id":"ev_000f8","ts":1774421760000,"type":"session_start","user":"u070"}
{"id":"ev_000f9","ts":1774421940000,"type":"page_view","user":"u070"}
{"id":"ev_000fg","ts":1774425180000,"type":"session_start","user":"u002"}
{"id":"ev_000fh","ts":1774425300000,"type":"page_view","user":"u002"}
{"id":"ev_000fc","ts":1774425780000,"type":"session_start","user":"u109"}
{"id":"ev_000gw","ts":1774425780000,"type":"session_start","user":"u013"}
{"id":"ev_000gx","ts":1774426020000,"type":"page_view","user":"u013"}
{"id":"ev_000gy","ts":1774426320000,"type":"purchase","user":"u013","amount_cents":6890}
{"id":"ev_000g4","ts":1774427040000,"type":"session_start","user":"u135"}
{"id":"ev_000g5","ts":1774427520000,"type":"export","user":"u135"}
{"id":"ev_000ev","ts":1774428780000,"type":"session_start","user":"u044"}
{"id":"ev_000ew","ts":1774429320000,"type":"export","user":"u044"}
{"id":"ev_000fy","ts":1774429440000,"type":"session_start","user":"u002"}
{"id":"ev_000fz","ts":1774429680000,"type":"page_view","user":"u002"}
{"id":"ev_000fa","ts":1774431420000,"type":"session_start","user":"u045"}
{"id":"ev_000fb","ts":1774431600000,"type":"purchase","user":"u045","amount_cents":14090}
{"id":"ev_000gg","ts":1774432320000,"type":"session_start","user":"u027"}
{"id":"ev_000f2","ts":1774432380000,"type":"session_start","user":"u067"}
{"id":"ev_000gh","ts":1774432560000,"type":"page_view","user":"u027"}
{"id":"ev_000g2","ts":1774434540000,"type":"session_start","user":"u025"}
{"id":"ev_000g8","ts":1774434900000,"type":"session_start","user":"u043"}
{"id":"ev_000h1","ts":1774435680000,"type":"session_start","user":"u022"}
{"id":"ev_000ff","ts":1774436220000,"type":"session_start","user":"u091"}
{"id":"ev_000fo","ts":1774437540000,"type":"session_start","user":"u125"}
{"id":"ev_000gi","ts":1774441140000,"type":"session_start","user":"u088"}
{"id":"ev_000fi","ts":1774442160000,"type":"session_start","user":"u062"}
{"id":"ev_000g0","ts":1774443120000,"type":"session_start","user":"u091"}
{"id":"ev_000g1","ts":1774443300000,"type":"page_view","user":"u091"}
{"id":"ev_000fq","ts":1774445160000,"type":"session_start","user":"u006"}
{"id":"ev_000fr","ts":1774445400000,"type":"page_view","user":"u006"}
{"id":"ev_000fn","ts":1774446060000,"type":"session_start","user":"u031"}
{"id":"ev_000fm","ts":1774447680000,"type":"session_start","user":"u022"}
{"id":"ev_000gu","ts":1774448400000,"type":"session_start","user":"u133"}
{"id":"ev_000gv","ts":1774448880000,"type":"purchase","user":"u133","amount_cents":3990}
{"id":"ev_000gd","ts":1774449600000,"type":"session_start","user":"u112"}
{"id":"ev_000ge","ts":1774449720000,"type":"page_view","user":"u112"}
{"id":"ev_000gf","ts":1774449840000,"type":"export","user":"u112"}
{"id":"ev_000g3","ts":1774450440000,"type":"session_start","user":"u123"}
{"id":"ev_000gn","ts":1774458180000,"type":"session_start","user":"u082"}
{"id":"ev_000go","ts":1774458420000,"type":"export","user":"u082"}
{"id":"ev_000fw","ts":1774459200000,"type":"session_start","user":"u012"}
{"id":"ev_000fx","ts":1774459260000,"type":"page_view","user":"u012"}
{"id":"ev_000fs","ts":1774459440000,"type":"session_start","user":"u023"}
{"id":"ev_000gk","ts":1774459800000,"type":"session_start","user":"u120"}
{"id":"ev_000f1","ts":1774459980000,"type":"session_start","user":"u052"}
{"id":"ev_000gl","ts":1774460100000,"type":"page_view","user":"u120"}
{"id":"ev_000f3","ts":1774462140000,"type":"session_start","user":"u087"}
{"id":"ev_000gj","ts":1774462260000,"type":"session_start","user":"u126"}
{"id":"ev_000f4","ts":1774462440000,"type":"page_view","user":"u087"}
{"id":"ev_000f0","ts":1774462800000,"type":"session_start","user":"u093"}
{"id":"ev_000ez","ts":1774464720000,"type":"session_start","user":"u081"}
{"id":"ev_000eu","ts":1774465560000,"type":"session_start","user":"u131"}
{"id":"ev_000fj","ts":1774466940000,"type":"session_start","user":"u049"}
{"id":"ev_000fk","ts":1774467060000,"type":"page_view","user":"u049"}
{"id":"ev_000fp","ts":1774469820000,"type":"session_start","user":"u063"}
{"id":"ev_000gp","ts":1774470960000,"type":"session_start","user":"u094"}
{"id":"ev_000ex","ts":1774472220000,"type":"session_start","user":"u120"}
{"id":"ev_000gr","ts":1774472340000,"type":"session_start","user":"u043"}
{"id":"ev_000ey","ts":1774472460000,"type":"page_view","user":"u120"}
{"id":"ev_000gs","ts":1774472520000,"type":"page_view","user":"u043"}
{"id":"ev_000gt","ts":1774472760000,"type":"purchase","user":"u043","amount_cents":3590}
{"id":"ev_000f5","ts":1774474380000,"type":"session_start","user":"u061"}
{"id":"ev_000f7","ts":1774474440000,"type":"export","user":"u061"}
{"id":"ev_000f6","ts":1774474500000,"type":"page_view","user":"u061"}
{"id":"ev_000gz","ts":1774477740000,"type":"session_start","user":"u089"}
{"id":"ev_000h0","ts":1774478040000,"type":"page_view","user":"u089"}
{"id":"ev_000fd","ts":1774478700000,"type":"session_start","user":"u076"}
{"id":"ev_000fe","ts":1774478760000,"type":"page_view","user":"u076"}
{"id":"ev_000gb","ts":1774479060000,"type":"session_start","user":"u052"}
{"id":"ev_000gc","ts":1774479360000,"type":"page_view","user":"u052"}
{"id":"ev_000fl","ts":1774479540000,"type":"session_start","user":"u072"}
{"id":"ev_000k3","ts":1774479900000,"type":"export","user":"svc-sync"}
{"id":"ev_000ic","ts":1774480200000,"type":"session_start","user":"u029"}
{"id":"ev_000id","ts":1774480500000,"type":"purchase","user":"u029","amount_cents":7790}
{"id":"ev_000k4","ts":1774480800000,"type":"export","user":"svc-sync"}
{"id":"ev_000k5","ts":1774481700000,"type":"export","user":"svc-sync"}
{"id":"ev_000in","ts":1774481820000,"type":"session_start","user":"u057"}
{"id":"ev_000io","ts":1774481940000,"type":"purchase","user":"u057","amount_cents":5090}
{"id":"ev_000k6","ts":1774482600000,"type":"export","user":"svc-sync"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-26.ndjson <<'__FX__'
{"id":"ev_000i6","ts":1774483380000,"type":"session_start","user":"u034"}
{"id":"ev_000i7","ts":1774483740000,"type":"purchase","user":"u034","amount_cents":13090}
{"id":"ev_000jq","ts":1774505400000,"type":"session_start","user":"u108"}
{"id":"ev_000hz","ts":1774507140000,"type":"session_start","user":"u035"}
{"id":"ev_000i0","ts":1774507440000,"type":"export","user":"u035"}
{"id":"ev_000hk","ts":1774507680000,"type":"session_start","user":"u063"}
{"id":"ev_000hl","ts":1774507860000,"type":"page_view","user":"u063"}
{"id":"ev_000jt","ts":1774508100000,"type":"session_start","user":"u019"}
{"id":"ev_000ik","ts":1774510680000,"type":"session_start","user":"u129"}
{"id":"ev_000hn","ts":1774512000000,"type":"session_start","user":"u068"}
{"id":"ev_000ho","ts":1774512180000,"type":"page_view","user":"u068"}
{"id":"ev_000i3","ts":1774513020000,"type":"session_start","user":"u100"}
{"id":"ev_000i4","ts":1774513260000,"type":"page_view","user":"u100"}
{"id":"ev_000i5","ts":1774513440000,"type":"export","user":"u100"}
{"id":"ev_000is","ts":1774514640000,"type":"session_start","user":"u068"}
{"id":"ev_000hp","ts":1774514700000,"type":"session_start","user":"u135"}
{"id":"ev_000hq","ts":1774514940000,"type":"page_view","user":"u135"}
{"id":"ev_000it","ts":1774514940000,"type":"page_view","user":"u068"}
{"id":"ev_000jw","ts":1774519860000,"type":"session_start","user":"u007"}
{"id":"ev_000jg","ts":1774520100000,"type":"session_start","user":"u113"}
{"id":"ev_000jh","ts":1774520220000,"type":"page_view","user":"u113"}
{"id":"ev_000ie","ts":1774521540000,"type":"session_start","user":"u117"}
{"id":"ev_000k2","ts":1774522800000,"type":"session_start","user":"u072"}
{"id":"ev_000h6","ts":1774522860000,"type":"session_start","user":"u119"}
{"id":"ev_000hd","ts":1774523640000,"type":"session_start","user":"u082"}
{"id":"ev_000he","ts":1774523820000,"type":"page_view","user":"u082"}
{"id":"ev_000hf","ts":1774524720000,"type":"session_start","user":"u011"}
{"id":"ev_000hh","ts":1774524960000,"type":"export","user":"u011"}
{"id":"ev_000hg","ts":1774525020000,"type":"page_view","user":"u011"}
{"id":"ev_000il","ts":1774526100000,"type":"session_start","user":"u127"}
{"id":"ev_000im","ts":1774526220000,"type":"page_view","user":"u127"}
{"id":"ev_000hr","ts":1774526340000,"type":"session_start","user":"u065"}
{"id":"ev_000hs","ts":1774526460000,"type":"page_view","user":"u065"}
{"id":"ev_000ht","ts":1774526460000,"type":"purchase","user":"u065","amount_cents":7290}
{"id":"ev_000jz","ts":1774527300000,"type":"session_start","user":"u040"}
{"id":"ev_000k0","ts":1774527480000,"type":"page_view","user":"u040"}
{"id":"ev_000k1","ts":1774527840000,"type":"purchase","user":"u040","amount_cents":10490}
{"id":"ev_000jx","ts":1774528500000,"type":"session_start","user":"u064"}
{"id":"ev_000jy","ts":1774528800000,"type":"page_view","user":"u064"}
{"id":"ev_000hw","ts":1774531620000,"type":"session_start","user":"u023"}
{"id":"ev_000hx","ts":1774531680000,"type":"page_view","user":"u023"}
{"id":"ev_000hy","ts":1774531740000,"type":"export","user":"u023"}
{"id":"ev_000hm","ts":1774532760000,"type":"session_start","user":"u105"}
{"id":"ev_000jp","ts":1774533060000,"type":"session_start","user":"u055"}
{"id":"ev_000jb","ts":1774533480000,"type":"session_start","user":"u019"}
{"id":"ev_000jo","ts":1774533720000,"type":"session_start","user":"u008"}
{"id":"ev_000ia","ts":1774534380000,"type":"session_start","user":"u070"}
{"id":"ev_000ib","ts":1774534620000,"type":"page_view","user":"u070"}
{"id":"ev_000ji","ts":1774538880000,"type":"session_start","user":"u041"}
{"id":"ev_000jj","ts":1774539360000,"type":"purchase","user":"u041","amount_cents":7190}
{"id":"ev_000iu","ts":1774540020000,"type":"session_start","user":"u023"}
{"id":"ev_000iv","ts":1774540140000,"type":"page_view","user":"u023"}
{"id":"ev_000iw","ts":1774540200000,"type":"export","user":"u023"}
{"id":"ev_000hi","ts":1774540800000,"type":"session_start","user":"u027"}
{"id":"ev_000hj","ts":1774540860000,"type":"page_view","user":"u027"}
{"id":"ev_000i2","ts":1774541640000,"type":"session_start","user":"u005"}
{"id":"ev_000ip","ts":1774542000000,"type":"session_start","user":"u106"}
{"id":"ev_000je","ts":1774543140000,"type":"session_start","user":"u127"}
{"id":"ev_000jf","ts":1774543620000,"type":"purchase","user":"u127","amount_cents":12790}
{"id":"ev_000hu","ts":1774543920000,"type":"session_start","user":"u105"}
{"id":"ev_000jc","ts":1774544160000,"type":"session_start","user":"u136"}
{"id":"ev_000jd","ts":1774544220000,"type":"page_view","user":"u136"}
{"id":"ev_000hv","ts":1774544340000,"type":"export","user":"u105"}
{"id":"ev_000h7","ts":1774544580000,"type":"session_start","user":"u097"}
{"id":"ev_000j5","ts":1774545120000,"type":"session_start","user":"u036"}
{"id":"ev_000j6","ts":1774545180000,"type":"page_view","user":"u036"}
{"id":"ev_000ju","ts":1774545300000,"type":"session_start","user":"u070"}
{"id":"ev_000j9","ts":1774545420000,"type":"session_start","user":"u086"}
{"id":"ev_000ja","ts":1774545720000,"type":"page_view","user":"u086"}
{"id":"ev_000jm","ts":1774545720000,"type":"session_start","user":"u029"}
{"id":"ev_000jn","ts":1774546020000,"type":"page_view","user":"u029"}
{"id":"ev_000ii","ts":1774546500000,"type":"session_start","user":"u064"}
{"id":"ev_000ij","ts":1774548060000,"type":"session_start","user":"u113"}
{"id":"ev_000i8","ts":1774548660000,"type":"session_start","user":"u133"}
{"id":"ev_000if","ts":1774548660000,"type":"session_start","user":"u021"}
{"id":"ev_000i9","ts":1774548780000,"type":"page_view","user":"u133"}
{"id":"ev_000ig","ts":1774548780000,"type":"purchase","user":"u021","amount_cents":3390}
{"id":"ev_000ix","ts":1774551360000,"type":"session_start","user":"u135"}
{"id":"ev_000iq","ts":1774551420000,"type":"session_start","user":"u100"}
{"id":"ev_000iy","ts":1774551660000,"type":"page_view","user":"u135"}
{"id":"ev_000ir","ts":1774551720000,"type":"page_view","user":"u100"}
{"id":"ev_000jv","ts":1774551840000,"type":"session_start","user":"u012"}
{"id":"ev_000hb","ts":1774555440000,"type":"session_start","user":"u069"}
{"id":"ev_000j7","ts":1774555680000,"type":"session_start","user":"u121"}
{"id":"ev_000j8","ts":1774555800000,"type":"page_view","user":"u121"}
{"id":"ev_000hc","ts":1774556040000,"type":"export","user":"u069"}
{"id":"ev_000jr","ts":1774556100000,"type":"session_start","user":"u026"}
{"id":"ev_000js","ts":1774556280000,"type":"page_view","user":"u026"}
{"id":"ev_000h8","ts":1774558260000,"type":"session_start","user":"u058"}
{"id":"ev_000h9","ts":1774558440000,"type":"purchase","user":"u058","amount_cents":11290}
{"id":"ev_000ha","ts":1774558620000,"type":"export","user":"u058"}
{"id":"ev_000j0","ts":1774559160000,"type":"session_start","user":"u062"}
{"id":"ev_000i1","ts":1774559220000,"type":"session_start","user":"u106"}
{"id":"ev_000j1","ts":1774559400000,"type":"page_view","user":"u062"}
{"id":"ev_000j2","ts":1774559400000,"type":"purchase","user":"u062","amount_cents":8590}
{"id":"ev_000ih","ts":1774560060000,"type":"session_start","user":"u057"}
{"id":"ev_000iz","ts":1774562160000,"type":"session_start","user":"u125"}
{"id":"ev_000j3","ts":1774563120000,"type":"session_start","user":"u063"}
{"id":"ev_000j4","ts":1774563360000,"type":"page_view","user":"u063"}
{"id":"ev_000jk","ts":1774565100000,"type":"session_start","user":"u095"}
{"id":"ev_000jl","ts":1774565160000,"type":"page_view","user":"u095"}
{"id":"ev_000nd","ts":1774566300000,"type":"export","user":"svc-sync"}
{"id":"ev_000l2","ts":1774567020000,"type":"session_start","user":"u079"}
{"id":"ev_000ne","ts":1774567200000,"type":"export","user":"svc-sync"}
{"id":"ev_000l3","ts":1774567260000,"type":"page_view","user":"u079"}
{"id":"ev_000nf","ts":1774568100000,"type":"export","user":"svc-sync"}
{"id":"ev_000ng","ts":1774569000000,"type":"export","user":"svc-sync"}
{"id":"ev_000lj","ts":1774569060000,"type":"session_start","user":"u024"}
{"id":"ev_000ki","ts":1774569120000,"type":"session_start","user":"u140"}
{"id":"ev_000lk","ts":1774569180000,"type":"page_view","user":"u024"}
{"id":"ev_000ll","ts":1774569480000,"type":"purchase","user":"u024","amount_cents":12290}
{"id":"ev_000lu","ts":1774569540000,"type":"session_start","user":"u080"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-27.ndjson <<'__FX__'
{"id":"ev_000lw","ts":1774569660000,"type":"export","user":"u080"}
{"id":"ev_000lv","ts":1774569840000,"type":"page_view","user":"u080"}
{"id":"ev_000mf","ts":1774571100000,"type":"session_start","user":"u036"}
{"id":"ev_000mn","ts":1774591620000,"type":"session_start","user":"u137"}
{"id":"ev_000mo","ts":1774591620000,"type":"session_start","user":"u082"}
{"id":"ev_000mp","ts":1774591980000,"type":"export","user":"u082"}
{"id":"ev_000m6","ts":1774592340000,"type":"session_start","user":"u009"}
{"id":"ev_000m7","ts":1774592520000,"type":"page_view","user":"u009"}
{"id":"ev_000m1","ts":1774593360000,"type":"session_start","user":"u028"}
{"id":"ev_000ka","ts":1774593540000,"type":"session_start","user":"u034"}
{"id":"ev_000m2","ts":1774593540000,"type":"page_view","user":"u028"}
{"id":"ev_000kv","ts":1774595340000,"type":"session_start","user":"u125"}
{"id":"ev_000kw","ts":1774595520000,"type":"page_view","user":"u125"}
{"id":"ev_000m8","ts":1774596000000,"type":"session_start","user":"u016"}
{"id":"ev_000l8","ts":1774596120000,"type":"session_start","user":"u035"}
{"id":"ev_000m9","ts":1774596120000,"type":"page_view","user":"u016"}
{"id":"ev_000l9","ts":1774596600000,"type":"purchase","user":"u035","amount_cents":11690}
{"id":"ev_000lx","ts":1774598160000,"type":"session_start","user":"u017"}
{"id":"ev_000ly","ts":1774598760000,"type":"export","user":"u017"}
{"id":"ev_000ln","ts":1774599540000,"type":"session_start","user":"u117"}
{"id":"ev_000lo","ts":1774599840000,"type":"page_view","user":"u117"}
{"id":"ev_000m4","ts":1774600560000,"type":"session_start","user":"u138"}
{"id":"ev_000mq","ts":1774600620000,"type":"session_start","user":"u080"}
{"id":"ev_000ks","ts":1774600740000,"type":"session_start","user":"u064"}
{"id":"ev_000kt","ts":1774600800000,"type":"page_view","user":"u064"}
{"id":"ev_000m5","ts":1774600860000,"type":"page_view","user":"u138"}
{"id":"ev_000ku","ts":1774600920000,"type":"purchase","user":"u064","amount_cents":4190}
{"id":"ev_000mr","ts":1774600980000,"type":"purchase","user":"u080","amount_cents":3990}
{"id":"ev_000ms","ts":1774601160000,"type":"export","user":"u080"}
{"id":"ev_000n3","ts":1774601940000,"type":"session_start","user":"u071"}
{"id":"ev_000n4","ts":1774602000000,"type":"page_view","user":"u071"}
{"id":"ev_000lf","ts":1774603320000,"type":"session_start","user":"u105"}
{"id":"ev_000nb","ts":1774605180000,"type":"session_start","user":"u112"}
{"id":"ev_000lp","ts":1774606020000,"type":"session_start","user":"u062"}
{"id":"ev_000n7","ts":1774606140000,"type":"session_start","user":"u115"}
{"id":"ev_000lm","ts":1774606740000,"type":"session_start","user":"u011"}
{"id":"ev_000lz","ts":1774607880000,"type":"session_start","user":"u074"}
{"id":"ev_000m0","ts":1774608120000,"type":"page_view","user":"u074"}
{"id":"ev_000n9","ts":1774609980000,"type":"session_start","user":"u131"}
{"id":"ev_000na","ts":1774610280000,"type":"page_view","user":"u131"}
{"id":"ev_000ke","ts":1774610820000,"type":"session_start","user":"u108"}
{"id":"ev_000mh","ts":1774612020000,"type":"session_start","user":"u083"}
{"id":"ev_000mi","ts":1774612440000,"type":"purchase","user":"u083","amount_cents":5790}
{"id":"ev_000mj","ts":1774612620000,"type":"export","user":"u083"}
{"id":"ev_000l0","ts":1774615800000,"type":"session_start","user":"u062"}
{"id":"ev_000l1","ts":1774615860000,"type":"page_view","user":"u062"}
{"id":"ev_000li","ts":1774616460000,"type":"session_start","user":"u042"}
{"id":"ev_000ma","ts":1774621260000,"type":"session_start","user":"u079"}
{"id":"ev_000nc","ts":1774621260000,"type":"session_start","user":"u085"}
{"id":"ev_000mc","ts":1774622220000,"type":"session_start","user":"u114"}
{"id":"ev_000me","ts":1774622400000,"type":"purchase","user":"u114","amount_cents":8490}
{"id":"ev_000md","ts":1774622520000,"type":"page_view","user":"u114"}
{"id":"ev_000kj","ts":1774625580000,"type":"session_start","user":"u126"}
{"id":"ev_000kk","ts":1774625880000,"type":"page_view","user":"u126"}
{"id":"ev_000kl","ts":1774626000000,"type":"purchase","user":"u126","amount_cents":10390}
{"id":"ev_000mt","ts":1774627200000,"type":"session_start","user":"u080"}
{"id":"ev_000n0","ts":1774628880000,"type":"session_start","user":"u046"}
{"id":"ev_000n1","ts":1774629000000,"type":"purchase","user":"u046","amount_cents":8490}
{"id":"ev_000kf","ts":1774629960000,"type":"session_start","user":"u125"}
{"id":"ev_000kg","ts":1774630200000,"type":"page_view","user":"u125"}
{"id":"ev_000l4","ts":1774630320000,"type":"session_start","user":"u088"}
{"id":"ev_000l5","ts":1774630380000,"type":"page_view","user":"u088"}
{"id":"ev_000my","ts":1774631700000,"type":"session_start","user":"u070"}
{"id":"ev_000mz","ts":1774631760000,"type":"page_view","user":"u070"}
{"id":"ev_000k8","ts":1774631880000,"type":"session_start","user":"u085"}
{"id":"ev_000k9","ts":1774632180000,"type":"page_view","user":"u085"}
{"id":"ev_000l6","ts":1774632840000,"type":"session_start","user":"u100"}
{"id":"ev_000l7","ts":1774632960000,"type":"page_view","user":"u100"}
{"id":"ev_000kx","ts":1774633260000,"type":"session_start","user":"u127"}
{"id":"ev_000ky","ts":1774633560000,"type":"page_view","user":"u127"}
{"id":"ev_000kz","ts":1774633620000,"type":"export","user":"u127"}
{"id":"ev_000kb","ts":1774635840000,"type":"session_start","user":"u133"}
{"id":"ev_000mg","ts":1774636140000,"type":"session_start","user":"u104"}
{"id":"ev_000kc","ts":1774636320000,"type":"purchase","user":"u133","amount_cents":8090}
{"id":"ev_000m3","ts":1774638000000,"type":"session_start","user":"u081"}
{"id":"ev_000km","ts":1774638900000,"type":"session_start","user":"u116"}
{"id":"ev_000kn","ts":1774639200000,"type":"page_view","user":"u116"}
{"id":"ev_000mk","ts":1774640640000,"type":"session_start","user":"u027"}
{"id":"ev_000mm","ts":1774640760000,"type":"export","user":"u027"}
{"id":"ev_000ml","ts":1774640940000,"type":"purchase","user":"u027","amount_cents":10390}
{"id":"ev_000n5","ts":1774640940000,"type":"session_start","user":"u040"}
{"id":"ev_000n6","ts":1774641060000,"type":"page_view","user":"u040"}
{"id":"ev_000lc","ts":1774641720000,"type":"session_start","user":"u010"}
{"id":"ev_000mx","ts":1774641840000,"type":"session_start","user":"u134"}
{"id":"ev_000ld","ts":1774642020000,"type":"page_view","user":"u010"}
{"id":"ev_000le","ts":1774642140000,"type":"purchase","user":"u010","amount_cents":14590}
{"id":"ev_000n2","ts":1774644060000,"type":"session_start","user":"u138"}
{"id":"ev_000kd","ts":1774645440000,"type":"session_start","user":"u059"}
{"id":"ev_000kq","ts":1774647120000,"type":"session_start","user":"u122"}
{"id":"ev_000ko","ts":1774647240000,"type":"session_start","user":"u062"}
{"id":"ev_000kr","ts":1774647360000,"type":"page_view","user":"u122"}
{"id":"ev_000lg","ts":1774647360000,"type":"session_start","user":"u047"}
{"id":"ev_000kp","ts":1774647420000,"type":"purchase","user":"u062","amount_cents":9290}
{"id":"ev_000kh","ts":1774647540000,"type":"session_start","user":"u010"}
{"id":"ev_000lh","ts":1774647720000,"type":"purchase","user":"u047","amount_cents":12290}
{"id":"ev_000k7","ts":1774648860000,"type":"session_start","user":"u086"}
{"id":"ev_000mb","ts":1774649760000,"type":"session_start","user":"u116"}
{"id":"ev_000lq","ts":1774650180000,"type":"session_start","user":"u111"}
{"id":"ev_000lr","ts":1774650480000,"type":"page_view","user":"u111"}
{"id":"ev_000mu","ts":1774650540000,"type":"session_start","user":"u022"}
{"id":"ev_000mv","ts":1774650600000,"type":"page_view","user":"u022"}
{"id":"ev_000ls","ts":1774650900000,"type":"session_start","user":"u046"}
{"id":"ev_000lt","ts":1774650960000,"type":"page_view","user":"u046"}
{"id":"ev_000mw","ts":1774650960000,"type":"purchase","user":"u022","amount_cents":14690}
{"id":"ev_000la","ts":1774651200000,"type":"session_start","user":"u116"}
{"id":"ev_000lb","ts":1774651380000,"type":"page_view","user":"u116"}
{"id":"ev_000n8","ts":1774652100000,"type":"session_start","user":"u032"}
{"id":"ev_000o1","ts":1774652460000,"type":"session_start","user":"u056"}
{"id":"ev_000pi","ts":1774652700000,"type":"export","user":"svc-sync"}
{"id":"ev_000nu","ts":1774652940000,"type":"session_start","user":"u135"}
{"id":"ev_000nv","ts":1774653000000,"type":"page_view","user":"u135"}
{"id":"ev_000o2","ts":1774653060000,"type":"export","user":"u056"}
{"id":"ev_000pj","ts":1774653600000,"type":"export","user":"svc-sync"}
{"id":"ev_000pk","ts":1774654500000,"type":"export","user":"svc-sync"}
{"id":"ev_000pl","ts":1774655400000,"type":"export","user":"svc-sync"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-28.ndjson <<'__FX__'
{"id":"ev_000p7","ts":1774656540000,"type":"session_start","user":"u047"}
{"id":"ev_000p8","ts":1774656960000,"type":"purchase","user":"u047","amount_cents":1990}
{"id":"ev_000ol","ts":1774657440000,"type":"session_start","user":"u041"}
{"id":"ev_000np","ts":1774657740000,"type":"session_start","user":"u031"}
{"id":"ev_000om","ts":1774657740000,"type":"page_view","user":"u041"}
{"id":"ev_000nq","ts":1774658040000,"type":"page_view","user":"u031"}
{"id":"ev_000nn","ts":1774678740000,"type":"session_start","user":"u128"}
{"id":"ev_000no","ts":1774679160000,"type":"purchase","user":"u128","amount_cents":10790}
{"id":"ev_000nk","ts":1774680120000,"type":"session_start","user":"u033"}
{"id":"ev_000ny","ts":1774680780000,"type":"session_start","user":"u064"}
{"id":"ev_000nz","ts":1774680900000,"type":"page_view","user":"u064"}
{"id":"ev_000nr","ts":1774681560000,"type":"session_start","user":"u137"}
{"id":"ev_000ns","ts":1774681800000,"type":"page_view","user":"u137"}
{"id":"ev_000o9","ts":1774685820000,"type":"session_start","user":"u020"}
{"id":"ev_000pg","ts":1774685940000,"type":"session_start","user":"u044"}
{"id":"ev_000oa","ts":1774686000000,"type":"page_view","user":"u020"}
{"id":"ev_000ph","ts":1774686120000,"type":"export","user":"u044"}
{"id":"ev_000o3","ts":1774688160000,"type":"session_start","user":"u022"}
{"id":"ev_000ok","ts":1774690020000,"type":"session_start","user":"u019"}
{"id":"ev_000o0","ts":1774692000000,"type":"session_start","user":"u094"}
{"id":"ev_000p0","ts":1774692240000,"type":"session_start","user":"u003"}
{"id":"ev_000p1","ts":1774692420000,"type":"page_view","user":"u003"}
{"id":"ev_000ot","ts":1774693740000,"type":"session_start","user":"u124"}
{"id":"ev_000oy","ts":1774693740000,"type":"session_start","user":"u055"}
{"id":"ev_000ou","ts":1774694160000,"type":"export","user":"u124"}
{"id":"ev_000oc","ts":1774695960000,"type":"session_start","user":"u036"}
{"id":"ev_000od","ts":1774696260000,"type":"page_view","user":"u036"}
{"id":"ev_000o4","ts":1774696860000,"type":"session_start","user":"u034"}
{"id":"ev_000of","ts":1774697280000,"type":"session_start","user":"u019"}
{"id":"ev_000og","ts":1774697580000,"type":"page_view","user":"u019"}
{"id":"ev_000o5","ts":1774700940000,"type":"session_start","user":"u132"}
{"id":"ev_000o6","ts":1774701180000,"type":"page_view","user":"u132"}
{"id":"ev_000pd","ts":1774701780000,"type":"session_start","user":"u031"}
{"id":"ev_000p2","ts":1774703820000,"type":"session_start","user":"u003"}
{"id":"ev_000p3","ts":1774704000000,"type":"page_view","user":"u003"}
{"id":"ev_000p4","ts":1774704300000,"type":"purchase","user":"u003","amount_cents":8490}
{"id":"ev_000nl","ts":1774707780000,"type":"session_start","user":"u079"}
{"id":"ev_000nm","ts":1774708260000,"type":"purchase","user":"u079","amount_cents":8090}
{"id":"ev_000pe","ts":1774709280000,"type":"session_start","user":"u128"}
{"id":"ev_000oz","ts":1774709460000,"type":"session_start","user":"u012"}
{"id":"ev_000op","ts":1774713720000,"type":"session_start","user":"u029"}
{"id":"ev_000pf","ts":1774713780000,"type":"session_start","user":"u009"}
{"id":"ev_000nt","ts":1774714800000,"type":"session_start","user":"u017"}
{"id":"ev_000nw","ts":1774715160000,"type":"session_start","user":"u077"}
{"id":"ev_000ob","ts":1774715400000,"type":"session_start","user":"u084"}
{"id":"ev_000nx","ts":1774715760000,"type":"export","user":"u077"}
{"id":"ev_000or","ts":1774719300000,"type":"session_start","user":"u076"}
{"id":"ev_000os","ts":1774719480000,"type":"page_view","user":"u076"}
{"id":"ev_000nh","ts":1774720440000,"type":"session_start","user":"u130"}
{"id":"ev_000ni","ts":1774720560000,"type":"page_view","user":"u130"}
{"id":"ev_000nj","ts":1774720560000,"type":"purchase","user":"u130","amount_cents":4690}
{"id":"ev_000ov","ts":1774721520000,"type":"session_start","user":"u085"}
{"id":"ev_000ow","ts":1774721640000,"type":"purchase","user":"u085","amount_cents":11390}
{"id":"ev_000ox","ts":1774722000000,"type":"export","user":"u085"}
{"id":"ev_000pb","ts":1774722060000,"type":"session_start","user":"u044"}
{"id":"ev_000pc","ts":1774722360000,"type":"export","user":"u044"}
{"id":"ev_000p9","ts":1774726860000,"type":"session_start","user":"u024"}
{"id":"ev_000pa","ts":1774726980000,"type":"page_view","user":"u024"}
{"id":"ev_000oh","ts":1774730400000,"type":"session_start","user":"u037"}
{"id":"ev_000oj","ts":1774730460000,"type":"export","user":"u037"}
{"id":"ev_000oi","ts":1774730820000,"type":"purchase","user":"u037","amount_cents":9990}
{"id":"ev_000o7","ts":1774733280000,"type":"session_start","user":"u026"}
{"id":"ev_000o8","ts":1774733400000,"type":"page_view","user":"u026"}
{"id":"ev_000on","ts":1774734600000,"type":"session_start","user":"u134"}
{"id":"ev_000oo","ts":1774735620000,"type":"session_start","user":"u058"}
{"id":"ev_000p5","ts":1774736160000,"type":"session_start","user":"u085"}
{"id":"ev_000p6","ts":1774736220000,"type":"page_view","user":"u085"}
{"id":"ev_000oe","ts":1774736460000,"type":"session_start","user":"u096"}
{"id":"ev_000oq","ts":1774738380000,"type":"session_start","user":"u119"}
{"id":"ev_000rn","ts":1774739100000,"type":"export","user":"svc-sync"}
{"id":"ev_000ro","ts":1774740000000,"type":"export","user":"svc-sync"}
{"id":"ev_000rp","ts":1774740900000,"type":"export","user":"svc-sync"}
{"id":"ev_000pm","ts":1774741260000,"type":"session_start","user":"u089"}
{"id":"ev_000pn","ts":1774741320000,"type":"export","user":"u089"}
{"id":"ev_000rq","ts":1774741800000,"type":"export","user":"svc-sync"}
{"id":"ev_000ps","ts":1774741980000,"type":"session_start","user":"u001"}
{"id":"ev_000po","ts":1774742100000,"type":"session_start","user":"u121"}
{"id":"ev_000pp","ts":1774742160000,"type":"page_view","user":"u121"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-29.ndjson <<'__FX__'
{"id":"ev_000qd","ts":1774742820000,"type":"session_start","user":"u064"}
{"id":"ev_000pw","ts":1774743000000,"type":"session_start","user":"u074"}
{"id":"ev_000pt","ts":1774743060000,"type":"session_start","user":"u060"}
{"id":"ev_000pv","ts":1774743180000,"type":"export","user":"u060"}
{"id":"ev_000px","ts":1774743180000,"type":"export","user":"u074"}
{"id":"ev_000pu","ts":1774743240000,"type":"purchase","user":"u060","amount_cents":14590}
{"id":"ev_000qb","ts":1774743600000,"type":"session_start","user":"u069"}
{"id":"ev_000qc","ts":1774743660000,"type":"page_view","user":"u069"}
{"id":"ev_000r6","ts":1774761960000,"type":"session_start","user":"u063"}
{"id":"ev_000pr","ts":1774763280000,"type":"session_start","user":"u002"}
{"id":"ev_000q3","ts":1774764180000,"type":"session_start","user":"u015"}
{"id":"ev_000q4","ts":1774764420000,"type":"page_view","user":"u015"}
{"id":"ev_000qq","ts":1774765560000,"type":"session_start","user":"u020"}
{"id":"ev_000qv","ts":1774766160000,"type":"session_start","user":"u080"}
{"id":"ev_000qw","ts":1774766460000,"type":"page_view","user":"u080"}
{"id":"ev_000rc","ts":1774766700000,"type":"session_start","user":"u037"}
{"id":"ev_000r7","ts":1774766760000,"type":"session_start","user":"u090"}
{"id":"ev_000rd","ts":1774766940000,"type":"page_view","user":"u037"}
{"id":"ev_000ri","ts":1774770000000,"type":"session_start","user":"u028"}
{"id":"ev_000rj","ts":1774771140000,"type":"session_start","user":"u045"}
{"id":"ev_000rk","ts":1774771260000,"type":"page_view","user":"u045"}
{"id":"ev_000r1","ts":1774771620000,"type":"session_start","user":"u045"}
{"id":"ev_000qe","ts":1774772280000,"type":"session_start","user":"u128"}
{"id":"ev_000qf","ts":1774772820000,"type":"export","user":"u128"}
{"id":"ev_000py","ts":1774777140000,"type":"session_start","user":"u064"}
{"id":"ev_000rh","ts":1774778040000,"type":"session_start","user":"u130"}
{"id":"ev_000qx","ts":1774779120000,"type":"session_start","user":"u085"}
{"id":"ev_000qy","ts":1774779180000,"type":"page_view","user":"u085"}
{"id":"ev_000r5","ts":1774780200000,"type":"session_start","user":"u070"}
{"id":"ev_000r2","ts":1774780680000,"type":"session_start","user":"u030"}
{"id":"ev_000qk","ts":1774781160000,"type":"session_start","user":"u071"}
{"id":"ev_000ql","ts":1774781340000,"type":"page_view","user":"u071"}
{"id":"ev_000rb","ts":1774781520000,"type":"session_start","user":"u135"}
{"id":"ev_000qm","ts":1774781580000,"type":"purchase","user":"u071","amount_cents":12190}
{"id":"ev_000rl","ts":1774782480000,"type":"session_start","user":"u086"}
{"id":"ev_000rm","ts":1774782600000,"type":"purchase","user":"u086","amount_cents":7990}
{"id":"ev_000rf","ts":1774783080000,"type":"session_start","user":"u053"}
{"id":"ev_000rg","ts":1774783260000,"type":"page_view","user":"u053"}
{"id":"ev_000re","ts":1774784100000,"type":"session_start","user":"u128"}
{"id":"ev_000qz","ts":1774785000000,"type":"session_start","user":"u120"}
{"id":"ev_000r0","ts":1774785240000,"type":"page_view","user":"u120"}
{"id":"ev_000r9","ts":1774787700000,"type":"session_start","user":"u104"}
{"id":"ev_000qr","ts":1774787880000,"type":"session_start","user":"u090"}
{"id":"ev_000ra","ts":1774788000000,"type":"export","user":"u104"}
{"id":"ev_000qs","ts":1774788300000,"type":"purchase","user":"u090","amount_cents":11390}
{"id":"ev_000q9","ts":1774790460000,"type":"session_start","user":"u044"}
{"id":"ev_000q1","ts":1774790520000,"type":"session_start","user":"u023"}
{"id":"ev_000q2","ts":1774790760000,"type":"page_view","user":"u023"}
{"id":"ev_000qa","ts":1774791060000,"type":"export","user":"u044"}
{"id":"ev_000q5","ts":1774791840000,"type":"session_start","user":"u134"}
{"id":"ev_000q6","ts":1774792020000,"type":"page_view","user":"u134"}
{"id":"ev_000pz","ts":1774795980000,"type":"session_start","user":"u109"}
{"id":"ev_000q0","ts":1774796280000,"type":"page_view","user":"u109"}
{"id":"ev_000q7","ts":1774800360000,"type":"session_start","user":"u114"}
{"id":"ev_000q8","ts":1774800600000,"type":"page_view","user":"u114"}
{"id":"ev_000qi","ts":1774805700000,"type":"session_start","user":"u086"}
{"id":"ev_000qj","ts":1774806000000,"type":"page_view","user":"u086"}
{"id":"ev_000qt","ts":1774806600000,"type":"session_start","user":"u080"}
{"id":"ev_000qu","ts":1774807020000,"type":"purchase","user":"u080","amount_cents":6190}
{"id":"ev_000qg","ts":1774810980000,"type":"session_start","user":"u073"}
{"id":"ev_000qh","ts":1774811040000,"type":"page_view","user":"u073"}
{"id":"ev_000r8","ts":1774811580000,"type":"session_start","user":"u083"}
{"id":"ev_000qn","ts":1774813860000,"type":"session_start","user":"u058"}
{"id":"ev_000qo","ts":1774813920000,"type":"page_view","user":"u058"}
{"id":"ev_000qp","ts":1774813980000,"type":"purchase","user":"u058","amount_cents":5390}
{"id":"ev_000r3","ts":1774814040000,"type":"session_start","user":"u043"}
{"id":"ev_000r4","ts":1774814160000,"type":"page_view","user":"u043"}
{"id":"ev_000pq","ts":1774815180000,"type":"session_start","user":"u008"}
{"id":"ev_000ui","ts":1774821900000,"type":"export","user":"svc-sync"}
{"id":"ev_000uj","ts":1774822800000,"type":"export","user":"svc-sync"}
{"id":"ev_000t7","ts":1774822980000,"type":"session_start","user":"u099"}
{"id":"ev_000t8","ts":1774823100000,"type":"page_view","user":"u099"}
{"id":"ev_000uk","ts":1774823700000,"type":"export","user":"svc-sync"}
{"id":"ev_000tn","ts":1774824600000,"type":"session_start","user":"u101"}
{"id":"ev_000ul","ts":1774824600000,"type":"export","user":"svc-sync"}
{"id":"ev_000s6","ts":1774824720000,"type":"session_start","user":"u018"}
{"id":"ev_000s7","ts":1774824840000,"type":"export","user":"u018"}
{"id":"ev_000u0","ts":1774825500000,"type":"session_start","user":"u013"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-30.ndjson <<'__FX__'
{"id":"ev_000sk","ts":1774847460000,"type":"session_start","user":"u063"}
{"id":"ev_000te","ts":1774848420000,"type":"session_start","user":"u133"}
{"id":"ev_000t9","ts":1774851060000,"type":"session_start","user":"u021"}
{"id":"ev_000ta","ts":1774851180000,"type":"page_view","user":"u021"}
{"id":"ev_000su","ts":1774851600000,"type":"session_start","user":"u067"}
{"id":"ev_000ug","ts":1774854600000,"type":"session_start","user":"u039"}
{"id":"ev_000sw","ts":1774855560000,"type":"session_start","user":"u004"}
{"id":"ev_000sx","ts":1774855860000,"type":"page_view","user":"u004"}
{"id":"ev_000t2","ts":1774856700000,"type":"session_start","user":"u007"}
{"id":"ev_000t3","ts":1774856760000,"type":"page_view","user":"u007"}
{"id":"ev_000sf","ts":1774860120000,"type":"session_start","user":"u081"}
{"id":"ev_000sg","ts":1774860180000,"type":"page_view","user":"u081"}
{"id":"ev_000tx","ts":1774860480000,"type":"session_start","user":"u025"}
{"id":"ev_000sv","ts":1774860780000,"type":"session_start","user":"u137"}
{"id":"ev_000s3","ts":1774861380000,"type":"session_start","user":"u066"}
{"id":"ev_000u1","ts":1774861740000,"type":"session_start","user":"u075"}
{"id":"ev_000tl","ts":1774862700000,"type":"session_start","user":"u050"}
{"id":"ev_000tm","ts":1774862880000,"type":"page_view","user":"u050"}
{"id":"ev_000ud","ts":1774863900000,"type":"session_start","user":"u079"}
{"id":"ev_000ue","ts":1774863960000,"type":"page_view","user":"u079"}
{"id":"ev_000uf","ts":1774864500000,"type":"export","user":"u079"}
{"id":"ev_000tf","ts":1774864560000,"type":"session_start","user":"u064"}
{"id":"ev_000sl","ts":1774864680000,"type":"session_start","user":"u036"}
{"id":"ev_000sm","ts":1774864740000,"type":"page_view","user":"u036"}
{"id":"ev_000tg","ts":1774864860000,"type":"page_view","user":"u064"}
{"id":"ev_000tb","ts":1774865040000,"type":"session_start","user":"u123"}
{"id":"ev_000tc","ts":1774865340000,"type":"page_view","user":"u123"}
{"id":"ev_000s4","ts":1774865580000,"type":"session_start","user":"u138"}
{"id":"ev_000s5","ts":1774865880000,"type":"page_view","user":"u138"}
{"id":"ev_000td","ts":1774869480000,"type":"session_start","user":"u026"}
{"id":"ev_000to","ts":1774870320000,"type":"session_start","user":"u033"}
{"id":"ev_000tp","ts":1774870440000,"type":"page_view","user":"u033"}
{"id":"ev_000tq","ts":1774870560000,"type":"purchase","user":"u033","amount_cents":13190}
{"id":"ev_000u2","ts":1774872780000,"type":"session_start","user":"u095"}
{"id":"ev_000ti","ts":1774874400000,"type":"session_start","user":"u115"}
{"id":"ev_000tj","ts":1774874640000,"type":"page_view","user":"u115"}
{"id":"ev_000sp","ts":1774874760000,"type":"session_start","user":"u068"}
{"id":"ev_000tk","ts":1774874940000,"type":"export","user":"u115"}
{"id":"ev_000sq","ts":1774875000000,"type":"page_view","user":"u068"}
{"id":"ev_000rv","ts":1774876380000,"type":"session_start","user":"u126"}
{"id":"ev_000rw","ts":1774876680000,"type":"purchase","user":"u126","amount_cents":12090}
{"id":"ev_000t0","ts":1774878540000,"type":"session_start","user":"u019"}
{"id":"ev_000t1","ts":1774878660000,"type":"page_view","user":"u019"}
{"id":"ev_000sr","ts":1774880100000,"type":"session_start","user":"u035"}
{"id":"ev_000sj","ts":1774883160000,"type":"session_start","user":"u094"}
{"id":"ev_000s1","ts":1774884660000,"type":"session_start","user":"u087"}
{"id":"ev_000ss","ts":1774885080000,"type":"session_start","user":"u088"}
{"id":"ev_000s2","ts":1774885140000,"type":"purchase","user":"u087","amount_cents":12490}
{"id":"ev_000st","ts":1774885200000,"type":"page_view","user":"u088"}
{"id":"ev_000ua","ts":1774887480000,"type":"session_start","user":"u066"}
{"id":"ev_000s8","ts":1774887660000,"type":"session_start","user":"u055"}
{"id":"ev_000u3","ts":1774887720000,"type":"session_start","user":"u040"}
{"id":"ev_000u4","ts":1774887780000,"type":"page_view","user":"u040"}
{"id":"ev_000s9","ts":1774887900000,"type":"page_view","user":"u055"}
{"id":"ev_000sa","ts":1774888140000,"type":"purchase","user":"u055","amount_cents":3590}
{"id":"ev_000u9","ts":1774888440000,"type":"session_start","user":"u063"}
{"id":"ev_000th","ts":1774888680000,"type":"session_start","user":"u114"}
{"id":"ev_000sd","ts":1774889100000,"type":"session_start","user":"u093"}
{"id":"ev_000t4","ts":1774889700000,"type":"session_start","user":"u102"}
{"id":"ev_000t5","ts":1774889940000,"type":"page_view","user":"u102"}
{"id":"ev_000t6","ts":1774890240000,"type":"export","user":"u102"}
{"id":"ev_000u6","ts":1774891080000,"type":"session_start","user":"u024"}
{"id":"ev_000u7","ts":1774891500000,"type":"session_start","user":"u100"}
{"id":"ev_000u8","ts":1774891560000,"type":"page_view","user":"u100"}
{"id":"ev_000tr","ts":1774893480000,"type":"session_start","user":"u130"}
{"id":"ev_000rx","ts":1774897080000,"type":"session_start","user":"u027"}
{"id":"ev_000ry","ts":1774897320000,"type":"page_view","user":"u027"}
{"id":"ev_000ru","ts":1774897560000,"type":"session_start","user":"u026"}
{"id":"ev_000ts","ts":1774899420000,"type":"session_start","user":"u070"}
{"id":"ev_000tt","ts":1774899600000,"type":"page_view","user":"u070"}
{"id":"ev_000rr","ts":1774899780000,"type":"session_start","user":"u123"}
{"id":"ev_000rs","ts":1774899840000,"type":"page_view","user":"u123"}
{"id":"ev_000tz","ts":1774899900000,"type":"session_start","user":"u115"}
{"id":"ev_000rt","ts":1774900020000,"type":"purchase","user":"u123","amount_cents":10790}
{"id":"ev_000sh","ts":1774900200000,"type":"session_start","user":"u137"}
{"id":"ev_000si","ts":1774900500000,"type":"page_view","user":"u137"}
{"id":"ev_000sb","ts":1774901940000,"type":"session_start","user":"u114"}
{"id":"ev_000sc","ts":1774902300000,"type":"purchase","user":"u114","amount_cents":5390}
{"id":"ev_000se","ts":1774903020000,"type":"session_start","user":"u023"}
{"id":"ev_000uc","ts":1774903680000,"type":"session_start","user":"u077"}
{"id":"ev_000ty","ts":1774904160000,"type":"session_start","user":"u014"}
{"id":"ev_000sy","ts":1774904460000,"type":"session_start","user":"u058"}
{"id":"ev_000tu","ts":1774904640000,"type":"session_start","user":"u119"}
{"id":"ev_000sz","ts":1774904760000,"type":"export","user":"u058"}
{"id":"ev_000tv","ts":1774904820000,"type":"page_view","user":"u119"}
{"id":"ev_000tw","ts":1774904880000,"type":"purchase","user":"u119","amount_cents":7990}
{"id":"ev_000sn","ts":1774905480000,"type":"session_start","user":"u078"}
{"id":"ev_000ub","ts":1774905600000,"type":"session_start","user":"u024"}
{"id":"ev_000so","ts":1774905660000,"type":"page_view","user":"u078"}
{"id":"ev_000rz","ts":1774906200000,"type":"session_start","user":"u068"}
{"id":"ev_000s0","ts":1774906500000,"type":"purchase","user":"u068","amount_cents":4990}
{"id":"ev_000uh","ts":1774907280000,"type":"session_start","user":"u090"}
{"id":"ev_000u5","ts":1774907760000,"type":"session_start","user":"u007"}
{"id":"ev_000x9","ts":1774908300000,"type":"export","user":"svc-sync"}
{"id":"ev_000va","ts":1774908480000,"type":"session_start","user":"u077"}
{"id":"ev_000vb","ts":1774908780000,"type":"page_view","user":"u077"}
{"id":"ev_000xa","ts":1774909200000,"type":"export","user":"svc-sync"}
{"id":"ev_000up","ts":1774909440000,"type":"session_start","user":"u060"}
{"id":"ev_000xb","ts":1774910100000,"type":"export","user":"svc-sync"}
{"id":"ev_000vl","ts":1774910760000,"type":"session_start","user":"u113"}
{"id":"ev_000uu","ts":1774910880000,"type":"session_start","user":"u076"}
{"id":"ev_000vm","ts":1774910940000,"type":"page_view","user":"u113"}
{"id":"ev_000xc","ts":1774911000000,"type":"export","user":"svc-sync"}
{"id":"ev_000uv","ts":1774911360000,"type":"export","user":"u076"}
{"id":"ev_000un","ts":1774911540000,"type":"session_start","user":"u121"}
{"id":"ev_000uo","ts":1774911600000,"type":"page_view","user":"u121"}
{"id":"ev_000wo","ts":1774911660000,"type":"session_start","user":"u067"}
{"id":"ev_000wp","ts":1774911780000,"type":"export","user":"u067"}
{"id":"ev_000wq","ts":1774912080000,"type":"session_start","user":"u130"}
{"id":"ev_000wr","ts":1774912320000,"type":"page_view","user":"u130"}
__FX__
mkdir -p data/events
cat > data/events/2026-03-31.ndjson <<'__FX__'
{"id":"ev_000x8","ts":1774934760000,"type":"session_start","user":"u110"}
{"id":"ev_000x0","ts":1774934820000,"type":"session_start","user":"u105"}
{"id":"ev_000ws","ts":1774936020000,"type":"session_start","user":"u009"}
{"id":"ev_000wt","ts":1774936320000,"type":"export","user":"u009"}
{"id":"ev_000wx","ts":1774937100000,"type":"session_start","user":"u084"}
{"id":"ev_000wy","ts":1774937220000,"type":"export","user":"u084"}
{"id":"ev_000vh","ts":1774938600000,"type":"session_start","user":"u059"}
{"id":"ev_000vi","ts":1774938780000,"type":"page_view","user":"u059"}
{"id":"ev_000w5","ts":1774939800000,"type":"session_start","user":"u022"}
{"id":"ev_000w6","ts":1774939860000,"type":"page_view","user":"u022"}
{"id":"ev_000wj","ts":1774941240000,"type":"session_start","user":"u033"}
{"id":"ev_000wk","ts":1774941420000,"type":"page_view","user":"u033"}
{"id":"ev_000uy","ts":1774943580000,"type":"session_start","user":"u089"}
{"id":"ev_000vc","ts":1774943880000,"type":"session_start","user":"u006"}
{"id":"ev_000ve","ts":1774944000000,"type":"export","user":"u006"}
{"id":"ev_000vd","ts":1774944060000,"type":"page_view","user":"u006"}
{"id":"ev_000wi","ts":1774944600000,"type":"session_start","user":"u109"}
{"id":"ev_000vp","ts":1774947480000,"type":"session_start","user":"u013"}
{"id":"ev_000v8","ts":1774947600000,"type":"session_start","user":"u098"}
{"id":"ev_000vq","ts":1774947600000,"type":"page_view","user":"u013"}
{"id":"ev_000wu","ts":1774949220000,"type":"session_start","user":"u052"}
{"id":"ev_000ww","ts":1774949280000,"type":"export","user":"u052"}
{"id":"ev_000wv","ts":1774949520000,"type":"page_view","user":"u052"}
{"id":"ev_000w1","ts":1774950000000,"type":"session_start","user":"u130"}
{"id":"ev_000x6","ts":1774952100000,"type":"session_start","user":"u137"}
{"id":"ev_000wg","ts":1774952160000,"type":"session_start","user":"u091"}
{"id":"ev_000x7","ts":1774952520000,"type":"export","user":"u137"}
{"id":"ev_000wb","ts":1774952640000,"type":"session_start","user":"u058"}
{"id":"ev_000wc","ts":1774952700000,"type":"session_start","user":"u005"}
{"id":"ev_000wh","ts":1774952700000,"type":"purchase","user":"u091","amount_cents":6990}
{"id":"ev_000vv","ts":1774953480000,"type":"session_start","user":"u037"}
{"id":"ev_000v7","ts":1774953600000,"type":"session_start","user":"u112"}
{"id":"ev_000uz","ts":1774953900000,"type":"session_start","user":"u108"}
{"id":"ev_000vw","ts":1774953900000,"type":"export","user":"u037"}
{"id":"ev_000wn","ts":1774954260000,"type":"session_start","user":"u043"}
{"id":"ev_000vt","ts":1774954800000,"type":"session_start","user":"u102"}
{"id":"ev_000v2","ts":1774960320000,"type":"session_start","user":"u095"}
{"id":"ev_000v3","ts":1774960440000,"type":"page_view","user":"u095"}
{"id":"ev_000v4","ts":1774960680000,"type":"purchase","user":"u095","amount_cents":12790}
{"id":"ev_000wm","ts":1774961400000,"type":"session_start","user":"u059"}
{"id":"ev_000w4","ts":1774961880000,"type":"session_start","user":"u122"}
{"id":"ev_000uw","ts":1774962420000,"type":"session_start","user":"u029"}
{"id":"ev_000ux","ts":1774962540000,"type":"page_view","user":"u029"}
{"id":"ev_000vn","ts":1774962840000,"type":"session_start","user":"u127"}
{"id":"ev_000vo","ts":1774963380000,"type":"purchase","user":"u127","amount_cents":3090}
{"id":"ev_000wz","ts":1774964160000,"type":"session_start","user":"u037"}
{"id":"ev_000um","ts":1774967460000,"type":"session_start","user":"u099"}
{"id":"ev_000vr","ts":1774968780000,"type":"session_start","user":"u045"}
{"id":"ev_000vs","ts":1774969020000,"type":"purchase","user":"u045","amount_cents":4590}
{"id":"ev_000v0","ts":1774970580000,"type":"session_start","user":"u032"}
{"id":"ev_000v1","ts":1774971120000,"type":"purchase","user":"u032","amount_cents":6190}
{"id":"ev_000w3","ts":1774972680000,"type":"session_start","user":"u088"}
{"id":"ev_000wa","ts":1774972860000,"type":"session_start","user":"u004"}
{"id":"ev_000vj","ts":1774973160000,"type":"session_start","user":"u045"}
{"id":"ev_000vk","ts":1774973340000,"type":"page_view","user":"u045"}
{"id":"ev_000vx","ts":1774976400000,"type":"session_start","user":"u026"}
{"id":"ev_000vy","ts":1774976520000,"type":"page_view","user":"u026"}
{"id":"ev_000w0","ts":1774976760000,"type":"export","user":"u026"}
{"id":"ev_000vz","ts":1774976940000,"type":"purchase","user":"u026","amount_cents":2590}
{"id":"ev_000we","ts":1774978380000,"type":"session_start","user":"u021"}
{"id":"ev_000wf","ts":1774978440000,"type":"page_view","user":"u021"}
{"id":"ev_000vf","ts":1774979580000,"type":"session_start","user":"u036"}
{"id":"ev_000vg","ts":1774979700000,"type":"page_view","user":"u036"}
{"id":"ev_000x1","ts":1774980480000,"type":"session_start","user":"u081"}
{"id":"ev_000x2","ts":1774980540000,"type":"page_view","user":"u081"}
{"id":"ev_000x3","ts":1774980960000,"type":"export","user":"u081"}
{"id":"ev_000w9","ts":1774981560000,"type":"session_start","user":"u062"}
{"id":"ev_000uq","ts":1774984140000,"type":"session_start","user":"u027"}
{"id":"ev_000w7","ts":1774985340000,"type":"session_start","user":"u061"}
{"id":"ev_000w8","ts":1774985520000,"type":"page_view","user":"u061"}
{"id":"ev_000v5","ts":1774985700000,"type":"session_start","user":"u002"}
{"id":"ev_000v6","ts":1774985820000,"type":"page_view","user":"u002"}
{"id":"ev_000ur","ts":1774986540000,"type":"session_start","user":"u004"}
{"id":"ev_000ut","ts":1774986660000,"type":"export","user":"u004"}
{"id":"ev_000us","ts":1774986900000,"type":"purchase","user":"u004","amount_cents":7190}
{"id":"ev_000vu","ts":1774986900000,"type":"session_start","user":"u038"}
{"id":"ev_000v9","ts":1774988520000,"type":"session_start","user":"u066"}
{"id":"ev_000wl","ts":1774990800000,"type":"session_start","user":"u118"}
{"id":"ev_000w2","ts":1774991280000,"type":"session_start","user":"u112"}
{"id":"ev_000wd","ts":1774992420000,"type":"session_start","user":"u038"}
{"id":"ev_000x4","ts":1774993980000,"type":"session_start","user":"u114"}
{"id":"ev_000x5","ts":1774994040000,"type":"page_view","user":"u114"}
{"id":"ev_000zu","ts":1774994700000,"type":"export","user":"svc-sync"}
{"id":"ev_000yn","ts":1774995480000,"type":"session_start","user":"u071"}
{"id":"ev_000zv","ts":1774995600000,"type":"export","user":"svc-sync"}
{"id":"ev_000z6","ts":1774996080000,"type":"session_start","user":"u124"}
{"id":"ev_000zw","ts":1774996500000,"type":"export","user":"svc-sync"}
{"id":"ev_000z7","ts":1774996680000,"type":"export","user":"u124"}
{"id":"ev_000z8","ts":1774997160000,"type":"session_start","user":"u129"}
{"id":"ev_000zn","ts":1774997280000,"type":"session_start","user":"u139"}
{"id":"ev_000zo","ts":1774997400000,"type":"page_view","user":"u139"}
{"id":"ev_000zx","ts":1774997400000,"type":"export","user":"svc-sync"}
{"id":"ev_000yg","ts":1774998300000,"type":"session_start","user":"u003"}
{"id":"ev_000yh","ts":1774998360000,"type":"page_view","user":"u003"}
{"id":"ev_000za","ts":1774998660000,"type":"session_start","user":"u129"}
{"id":"ev_000yk","ts":1774999080000,"type":"session_start","user":"u126"}
{"id":"ev_000yl","ts":1774999200000,"type":"page_view","user":"u126"}
{"id":"ev_000zi","ts":1774999200000,"type":"session_start","user":"u003"}
{"id":"ev_000ym","ts":1774999560000,"type":"purchase","user":"u126","amount_cents":12390}
{"id":"ev_000zj","ts":1774999680000,"type":"purchase","user":"u003","amount_cents":11190}
{"id":"ev_000yd","ts":1774999740000,"type":"session_start","user":"u031"}
{"id":"ev_000ye","ts":1774999980000,"type":"page_view","user":"u031"}
__FX__
npm run --silent weekly -- 2026-W13 >/dev/null 2>&1
