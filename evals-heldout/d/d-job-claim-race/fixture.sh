#!/usr/bin/env bash
# thumbd: Node (CommonJS) batch thumbnail renderer. Forked worker processes claim
# spool jobs with a check-then-write lock (existsSync, async read, writeFileSync),
# so two workers can claim the same job. The user blames claimTimeoutMs; the
# duplicates in var/billing-2026-09.ndjson are milliseconds apart. npm run stress
# starts with four stale locks, so a fix must also take over stale locks atomically.
# var/ is gitignored (local copy of the September billing export and a log).
set -euo pipefail

export GIT_AUTHOR_NAME="Femi Adeyemi" GIT_AUTHOR_EMAIL="femi.adeyemi@lumen-media.io"
export GIT_COMMITTER_NAME="Femi Adeyemi" GIT_COMMITTER_EMAIL="femi.adeyemi@lumen-media.io"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- thumbd 2.0: spool queue with forked workers
cat > .gitignore <<'__FX__'
node_modules/
spool/
var/
.DS_Store
__FX__
cat > README.md <<'__FX__'
# thumbd

Batch thumbnail renderer for the media library. Jobs are queued as JSON files
in a spool directory; `bin/run-batch.js` forks `workers` worker processes
that render every configured size through the imgproc service and append one
billing line per finished job to `var/billing.ndjson`.

```
npm run seed -- 20        # queue 20 synthetic jobs (dev only)
npm run batch             # run all pending jobs
npm run billing           # summarize the billing file
npm test
```

Configuration lives in `config/thumbd.json`; `THUMBD_CONFIG` points at another
file, and `THUMBD_RENDERER=fake` swaps imgproc for the local stand-in.

See `docs/queue.md` for how the spool and claims work and
`docs/operations.md` for the runbook.

__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.0.0 (2025-06-10)
- Spool queue with forked worker processes, replacing the single-process
  renderer.
__FX__
cat > package.json <<'__FX__'
{
  "name": "thumbd",
  "version": "2.0.0",
  "private": true,
  "description": "Batch thumbnail renderer for the media library (spool queue + forked workers)",
  "bin": { "thumbd": "bin/run-batch.js" },
  "scripts": {
    "batch": "node bin/run-batch.js",
    "billing": "node bin/billing-report.js",
    "seed": "node scripts/seed-jobs.js",
    "test": "node --test test/*.test.js"
  },
  "engines": { "node": ">=20" }
}
__FX__
mkdir -p config
cat > config/thumbd.json <<'__FX__'
{
  "workers": 2,
  "pollMs": 250,
  "renderer": "imgproc",
  "spool": "spool",
  "billing": "var/billing.ndjson",
  "unitPriceEur": 0.012,
  "sizes": [[320, 180], [640, 360], [1280, 720]]
}
__FX__
mkdir -p src
cat > src/config.js <<'__FX__'
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// THUMBD_CONFIG lets the stress test and the tests run against their own spool.
function load(file = process.env.THUMBD_CONFIG || path.join(ROOT, 'config/thumbd.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['workers', 'pollMs', 'spool', 'billing', 'sizes']) {
    if (cfg[key] === undefined) throw new Error(`config ${file}: missing ${key}`);
  }
  return {
    ...cfg,
    renderer: process.env.THUMBD_RENDERER || cfg.renderer,
    spool: path.resolve(ROOT, cfg.spool),
    billing: path.resolve(ROOT, cfg.billing),
    file,
  };
}

module.exports = { load, ROOT };
__FX__
mkdir -p src
cat > src/log.js <<'__FX__'
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.THUMBD_LOG || 'info'] ?? 20;

function line(level, msg) {
  if (LEVELS[level] < min) return;
  const tag = process.env.THUMBD_WORKER ? ` w${process.env.THUMBD_WORKER}` : '';
  process.stderr.write(`${new Date().toISOString()} ${level.toUpperCase()}${tag} ${msg}\n`);
}

module.exports = {
  debug: (m) => line('debug', m),
  info: (m) => line('info', m),
  warn: (m) => line('warn', m),
  error: (m) => line('error', m),
};
__FX__
mkdir -p src
cat > src/job.js <<'__FX__'
'use strict';

// A job asks for every configured size of one source image.
// { id, asset, src: { w, h, bytes }, notBefore? }
function parseJob(text) {
  const job = JSON.parse(text);
  if (typeof job.id !== 'string' || !/^[a-z0-9-]+$/.test(job.id)) throw new Error(`bad job id ${job.id}`);
  const { w, h, bytes } = job.src || {};
  if (![w, h, bytes].every((n) => Number.isInteger(n) && n > 0)) throw new Error(`job ${job.id}: bad src`);
  return job;
}

// Billable units: one per output size, plus one per started MB of source.
function units(job, sizes) {
  return sizes.length + Math.ceil(job.src.bytes / 1_000_000);
}

function isDue(job, now = Date.now()) {
  return !job.notBefore || Date.parse(job.notBefore) <= now;
}

module.exports = { parseJob, units, isDue };
__FX__
mkdir -p src
cat > src/render.js <<'__FX__'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');

// Fit (w, h) inside (bw, bh), keeping the aspect ratio.
function fit(w, h, bw, bh) {
  const k = Math.min(bw / w, bh / h, 1);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// imgproc is the paid rendering service's CLI. Every invocation is a billed
// render on their side.
function imgproc(job, sizes) {
  return new Promise((resolve, reject) => {
    const args = ['render', job.asset, ...sizes.map(([w, h]) => `${w}x${h}`), '--json'];
    const p = spawn('imgproc', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`imgproc exit ${code}`))));
  });
}

// Local stand-in used by tests and the stress test. It takes time proportional
// to the source size and logs every render to THUMBD_FAKE_LOG, the way the
// provider's usage export would.
function fake(job, sizes) {
  const ms = 4 + Math.round(job.src.bytes / 400_000);
  return new Promise((resolve) => {
    setTimeout(() => {
      if (process.env.THUMBD_FAKE_LOG) {
        fs.appendFileSync(process.env.THUMBD_FAKE_LOG, `${job.id} ${process.pid}\n`);
      }
      resolve(
        sizes.map(([bw, bh]) => {
          const [w, h] = fit(job.src.w, job.src.h, bw, bh);
          const digest = crypto.createHash('sha1').update(`${job.id}:${w}x${h}`).digest('hex').slice(0, 12);
          return { box: `${bw}x${bh}`, w, h, digest };
        })
      );
    }, ms);
  });
}

const renderers = { imgproc, fake };

function render(name, job, sizes) {
  const r = renderers[name];
  if (!r) throw new Error(`unknown renderer ${name}`);
  return r(job, sizes);
}

module.exports = { render, fit };
__FX__
mkdir -p src
cat > src/billing.js <<'__FX__'
'use strict';
const fs = require('fs');
const path = require('path');

// One line per finished job. Finance invoices customers from this file.
function record(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

function read(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function summarize(entries, unitPriceEur) {
  const byJob = new Map();
  for (const e of entries) byJob.set(e.job, (byJob.get(e.job) || 0) + 1);
  const units = entries.reduce((s, e) => s + e.units, 0);
  return {
    lines: entries.length,
    jobs: byJob.size,
    duplicates: [...byJob.values()].reduce((s, n) => s + n - 1, 0),
    units,
    eur: Math.round(units * unitPriceEur * 100) / 100,
  };
}

module.exports = { record, read, summarize };
__FX__
mkdir -p src
cat > src/spool.js <<'__FX__'
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { parseJob, isDue } = require('./job');

// spool/
//   pending/<id>.json   queued jobs
//   locks/<id>.lock     claimed by a worker ({ owner, at })
//   done/<id>.json      render results
//   failed/<id>.json    job + error
function dirs(root) {
  return {
    pending: path.join(root, 'pending'),
    locks: path.join(root, 'locks'),
    done: path.join(root, 'done'),
    failed: path.join(root, 'failed'),
  };
}

function ensure(root) {
  for (const d of Object.values(dirs(root))) fs.mkdirSync(d, { recursive: true });
}

function enqueue(root, job) {
  fs.writeFileSync(path.join(dirs(root).pending, `${job.id}.json`), JSON.stringify(job));
}

function listPending(root) {
  return fs
    .readdirSync(dirs(root).pending)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function lockPath(root, id) {
  return path.join(dirs(root).locks, `${id}.lock`);
}

// Claim a pending job for `owner`. Returns the job, or null when another
// worker holds it, it already finished, or it is not due yet.
async function claim(root, id, { owner, now = Date.now() }) {
  const lock = lockPath(root, id);
  if (fs.existsSync(lock)) return null;
  let job;
  try {
    job = parseJob(await fsp.readFile(path.join(dirs(root).pending, `${id}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null; // finished meanwhile
    throw err;
  }
  if (!isDue(job, now)) return null;
  fs.writeFileSync(lock, JSON.stringify({ owner, at: new Date(now).toISOString() }));
  return job;
}

function complete(root, id, result) {
  const d = dirs(root);
  fs.writeFileSync(path.join(d.done, `${id}.json`), JSON.stringify(result));
  fs.rmSync(path.join(d.pending, `${id}.json`), { force: true });
  fs.rmSync(lockPath(root, id), { force: true });
}

function fail(root, id, job, err) {
  const d = dirs(root);
  fs.writeFileSync(path.join(d.failed, `${id}.json`), JSON.stringify({ job, error: String(err && err.message) }));
  fs.rmSync(path.join(d.pending, `${id}.json`), { force: true });
  fs.rmSync(lockPath(root, id), { force: true });
}

module.exports = { dirs, ensure, enqueue, listPending, lockPath, claim, complete, fail };
__FX__
mkdir -p src
cat > src/worker.js <<'__FX__'
'use strict';
// Worker process, forked by src/supervisor.js. Runs jobs from the spool until
// nothing is left, then exits.
const config = require('./config');
const spool = require('./spool');
const billing = require('./billing');
const { render } = require('./render');
const { units } = require('./job');
const log = require('./log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(cfg, id, owner) {
  const job = await spool.claim(cfg.spool, id, { owner });
  if (!job) return false;
  log.debug(`claimed ${id}`);
  try {
    const outputs = await render(cfg.renderer, job, cfg.sizes);
    billing.record(cfg.billing, { job: id, asset: job.asset, units: units(job, cfg.sizes), worker: owner, at: new Date().toISOString() });
    spool.complete(cfg.spool, id, { id, outputs });
  } catch (err) {
    log.error(`${id}: ${err.message}`);
    spool.fail(cfg.spool, id, job, err);
  }
  return true;
}

async function loop(cfg, owner) {
  let done = 0;
  for (;;) {
    const pending = spool.listPending(cfg.spool);
    if (pending.length === 0) return done;
    let progressed = false;
    for (const id of pending) {
      if (await runOne(cfg, id, owner)) {
        done++;
        progressed = true;
        break; // rescan: earlier jobs may have been released
      }
    }
    if (!progressed) await sleep(cfg.pollMs);
  }
}

if (require.main === module) {
  const cfg = config.load();
  const owner = `${require('os').hostname()}:${process.pid}`;
  process.on('disconnect', () => process.exit(0)); // supervisor went away
  process.send({ type: 'ready' });
  process.on('message', async (m) => {
    if (m.type !== 'start') return;
    const done = await loop(cfg, owner);
    process.send({ type: 'finished', done }, () => process.exit(0));
  });
}

module.exports = { loop, runOne };
__FX__
mkdir -p src
cat > src/supervisor.js <<'__FX__'
'use strict';
const path = require('path');
const { fork } = require('child_process');
const log = require('./log');

// Fork cfg.workers worker processes, start them together once all are up
// (so the batch duration is measured from a common start), and resolve with
// the number of jobs each one ran.
function runBatch(cfg, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const workers = [];
    let ready = 0;
    const done = [];
    for (let i = 0; i < cfg.workers; i++) {
      const w = fork(path.join(__dirname, 'worker.js'), [], {
        env: { ...process.env, ...env, THUMBD_WORKER: String(i + 1) },
      });
      workers.push(w);
      w.on('message', (m) => {
        if (m.type === 'ready' && ++ready === cfg.workers) {
          const t0 = Date.now();
          workers.forEach((x) => x.send({ type: 'start' }));
          log.info(`batch started with ${cfg.workers} workers`);
          done.t0 = t0;
        }
        if (m.type === 'finished') done.push(m.done);
      });
      w.on('error', reject);
      w.on('exit', (code) => {
        if (code !== 0) return reject(new Error(`worker ${i + 1} exited with ${code}`));
        if (done.length === cfg.workers) resolve({ perWorker: done.slice(), ms: Date.now() - done.t0 });
      });
    }
  });
}

module.exports = { runBatch };
__FX__
mkdir -p bin
cat > bin/run-batch.js <<'__FX__'
#!/usr/bin/env node
'use strict';
const config = require('../src/config');
const spool = require('../src/spool');
const { runBatch } = require('../src/supervisor');
const log = require('../src/log');

async function main() {
  const cfg = config.load();
  spool.ensure(cfg.spool);
  const n = spool.listPending(cfg.spool).length;
  if (n === 0) {
    log.info('nothing pending');
    return;
  }
  log.info(`${n} pending job(s), renderer ${cfg.renderer}`);
  const { perWorker, ms } = await runBatch(cfg);
  log.info(`batch finished in ${ms} ms, jobs per worker: ${perWorker.join(', ')}`);
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exit(1);
});
__FX__
chmod +x bin/run-batch.js
mkdir -p bin
cat > bin/billing-report.js <<'__FX__'
#!/usr/bin/env node
'use strict';
// usage: npm run billing -- [file]   (default: the configured billing file)
const config = require('../src/config');
const billing = require('../src/billing');

const cfg = config.load();
const file = process.argv[2] || cfg.billing;
const entries = billing.read(file);
const s = billing.summarize(entries, cfg.unitPriceEur);
console.log(`file:        ${file}`);
console.log(`lines:       ${s.lines}`);
console.log(`jobs:        ${s.jobs}`);
console.log(`duplicates:  ${s.duplicates}`);
console.log(`units:       ${s.units}`);
console.log(`amount EUR:  ${s.eur.toFixed(2)}`);
__FX__
chmod +x bin/billing-report.js
mkdir -p scripts
cat > scripts/seed-jobs.js <<'__FX__'
#!/usr/bin/env node
'use strict';
// usage: node scripts/seed-jobs.js [count] [seed]
// Queue synthetic jobs into the configured spool (deterministic for a seed).
const config = require('../src/config');
const spool = require('../src/spool');

function* jobs(count, seed = 7) {
  let x = seed >>> 0;
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const shapes = [[4032, 3024], [3024, 4032], [1920, 1080], [6000, 4000], [1080, 1350], [2048, 2048]];
  for (let i = 1; i <= count; i++) {
    const [w, h] = shapes[Math.floor(rnd() * shapes.length)];
    const bytes = 200_000 + Math.floor(rnd() * 5_800_000);
    yield { id: `t-${String(i).padStart(4, '0')}`, asset: `media/lib/${String(i).padStart(6, '0')}.jpg`, src: { w, h, bytes } };
  }
}

function seed(root, count, s) {
  spool.ensure(root);
  let n = 0;
  for (const job of jobs(count, s)) {
    spool.enqueue(root, job);
    n++;
  }
  return n;
}

if (require.main === module) {
  const cfg = config.load();
  const n = seed(cfg.spool, Number(process.argv[2] || 20), Number(process.argv[3] || 7));
  console.log(`queued ${n} job(s) in ${cfg.spool}`);
}

module.exports = { jobs, seed };
__FX__
mkdir -p test
cat > test/helpers.js <<'__FX__'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpSpool() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbd-test-'));
  return root;
}

const job = (id, extra = {}) => ({ id, asset: `media/lib/${id}.jpg`, src: { w: 4032, h: 3024, bytes: 2_400_000 }, ...extra });

module.exports = { tmpSpool, job };
__FX__
mkdir -p test
cat > test/job.test.js <<'__FX__'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseJob, units, isDue } = require('../src/job');
const { job } = require('./helpers');

test('parseJob accepts a well-formed job', () => {
  assert.deepStrictEqual(parseJob(JSON.stringify(job('t-0001'))).src.w, 4032);
});

test('parseJob rejects bad ids and sizes', () => {
  assert.throws(() => parseJob(JSON.stringify(job('T 1'))), /bad job id/);
  assert.throws(() => parseJob(JSON.stringify({ id: 'x', src: { w: 0, h: 1, bytes: 1 } })), /bad src/);
});

test('units: one per size plus one per started MB', () => {
  const sizes = [[320, 180], [640, 360], [1280, 720]];
  assert.strictEqual(units(job('a'), sizes), 3 + 3);
  assert.strictEqual(units(job('b', { src: { w: 1, h: 1, bytes: 1_000_000 } }), sizes), 3 + 1);
});

test('isDue honours notBefore', () => {
  const now = Date.parse('2026-09-18T10:00:00Z');
  assert.ok(isDue(job('a'), now));
  assert.ok(!isDue(job('a', { notBefore: '2026-09-18T11:00:00Z' }), now));
  assert.ok(isDue(job('a', { notBefore: '2026-09-18T09:00:00Z' }), now));
});
__FX__
mkdir -p test
cat > test/render.test.js <<'__FX__'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { render, fit } = require('../src/render');
const { job } = require('./helpers');

test('fit keeps the aspect ratio and never upscales', () => {
  assert.deepStrictEqual(fit(4032, 3024, 320, 180), [240, 180]);
  assert.deepStrictEqual(fit(3024, 4032, 1280, 720), [540, 720]);
  assert.deepStrictEqual(fit(200, 100, 640, 360), [200, 100]);
});

test('fake renderer returns one output per size', async () => {
  const out = await render('fake', job('t-0009'), [[320, 180], [640, 360]]);
  assert.deepStrictEqual(out.map((o) => `${o.w}x${o.h}`), ['240x180', '480x360']);
  assert.match(out[0].digest, /^[0-9a-f]{12}$/);
});

test('unknown renderer is an error', () => {
  assert.throws(() => render('gimp', job('a'), []), /unknown renderer/);
});
__FX__
mkdir -p test
cat > test/billing.test.js <<'__FX__'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const billing = require('../src/billing');
const { tmpSpool } = require('./helpers');

test('record appends ndjson lines and read returns them', () => {
  const file = path.join(tmpSpool(), 'billing.ndjson');
  billing.record(file, { job: 'a', units: 6 });
  billing.record(file, { job: 'b', units: 4 });
  assert.deepStrictEqual(billing.read(file).map((e) => e.job), ['a', 'b']);
});

test('summarize counts duplicate jobs and the amount', () => {
  const s = billing.summarize(
    [
      { job: 'a', units: 6 },
      { job: 'b', units: 4 },
      { job: 'a', units: 6 },
    ],
    0.0004
  );
  assert.deepStrictEqual(s, { lines: 3, jobs: 2, duplicates: 1, units: 16, eur: 0.01 });
});
__FX__
mkdir -p test
cat > test/spool.test.js <<'__FX__'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const spool = require('../src/spool');
const { tmpSpool, job } = require('./helpers');

function setup(...jobs) {
  const root = tmpSpool();
  spool.ensure(root);
  for (const j of jobs) spool.enqueue(root, j);
  return root;
}
const opts = { owner: 'test:1' };

test('listPending is sorted by id', () => {
  const root = setup(job('t-0003'), job('t-0001'), job('t-0002'));
  assert.deepStrictEqual(spool.listPending(root), ['t-0001', 't-0002', 't-0003']);
});

test('a claimed job cannot be claimed again', async () => {
  const root = setup(job('t-0001'));
  assert.strictEqual((await spool.claim(root, 't-0001', opts)).id, 't-0001');
  assert.strictEqual(await spool.claim(root, 't-0001', { ...opts, owner: 'test:2' }), null);
});

test('a job that is not due is left alone', async () => {
  const root = setup(job('t-0001', { notBefore: '2999-01-01T00:00:00Z' }));
  assert.strictEqual(await spool.claim(root, 't-0001', opts), null);
  assert.ok(!fs.existsSync(spool.lockPath(root, 't-0001')));
});

test('a finished job cannot be claimed', async () => {
  const root = setup(job('t-0001'));
  await spool.claim(root, 't-0001', opts);
  spool.complete(root, 't-0001', { id: 't-0001', outputs: [] });
  assert.deepStrictEqual(spool.listPending(root), []);
  assert.strictEqual(await spool.claim(root, 't-0001', opts), null);
  assert.ok(fs.existsSync(path.join(spool.dirs(root).done, 't-0001.json')));
});

test('fail moves the job aside and releases the lock', async () => {
  const root = setup(job('t-0001'));
  const j = await spool.claim(root, 't-0001', opts);
  spool.fail(root, 't-0001', j, new Error('imgproc exit 3'));
  assert.ok(!fs.existsSync(spool.lockPath(root, 't-0001')));
  assert.match(fs.readFileSync(path.join(spool.dirs(root).failed, 't-0001.json'), 'utf8'), /imgproc exit 3/);
});
__FX__
mkdir -p docs
cat > docs/queue.md <<'__FX__'
# Spool and claims

```
spool/pending/<id>.json   queued jobs
spool/locks/<id>.lock     claim held by a worker: { owner: "host:pid", at }
spool/done/<id>.json      render results
spool/failed/<id>.json    job + error message
```

`bin/run-batch.js` forks `workers` worker processes (`src/worker.js`). They
are separate processes on purpose: imgproc occasionally leaks memory on huge
TIFFs, and a dying worker must not take the batch down with it. Workers share
nothing except the spool directory, so the lock files are the only
coordination between them.

Each worker loops:

1. list `pending/`, sorted by id;
2. try to claim the first job it can (`spool.claim`);
3. render all sizes, append the billing line, `spool.complete` (writes
   `done/`, removes the pending file, then the lock);
4. go back to 1. When nothing is claimable it sleeps `pollMs`; when
   `pending/` is empty it exits.

A lock is held until the job is completed or failed.

Billing is per finished job. Rendering the same job twice is billed twice by
imgproc *and* by us.
__FX__
mkdir -p docs
cat > docs/operations.md <<'__FX__'
# thumbd runbook

## Nightly batch

Cron on render-01/render-02 runs `npm run batch` at 01:30. Logs go to
`var/log/thumbd-<date>.log`. Finance pulls `var/billing.ndjson` on the 1st
and exports the previous month as `billing-<yyyy-mm>.ndjson`.

## Re-running a failed job

Move `spool/failed/<id>.json` back to `spool/pending/` (only the `job` field)
and run the batch.

## Duplicate charges

`npm run billing -- <file>` prints the duplicate count for a billing export.
Duplicates must be credited manually by finance (see the billing wiki).
__FX__
git add -A
commit "2025-06-10T08:12:00Z" "thumbd 2.0: spool queue with forked workers"

# --- workers: 2 -> 4 for the library backfill
mkdir -p config
cat > config/thumbd.json <<'__FX__'
{
  "workers": 4,
  "pollMs": 250,
  "renderer": "imgproc",
  "spool": "spool",
  "billing": "var/billing.ndjson",
  "unitPriceEur": 0.012,
  "sizes": [[320, 180], [640, 360], [1280, 720]]
}
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.0.1 (2025-08-04)
- 4 workers for the library backfill.

## 2.0.0 (2025-06-10)
- Spool queue with forked worker processes, replacing the single-process
  renderer.
__FX__
git add -A
commit "2025-08-04T14:40:00Z" "workers: 2 -> 4 for the library backfill"

# --- spool: take over locks older than claimTimeoutMs (INC-311)
mkdir -p src
cat > src/spool.js <<'__FX__'
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const log = require('./log');
const { parseJob, isDue } = require('./job');

// spool/
//   pending/<id>.json   queued jobs
//   locks/<id>.lock     claimed by a worker ({ owner, at })
//   done/<id>.json      render results
//   failed/<id>.json    job + error
function dirs(root) {
  return {
    pending: path.join(root, 'pending'),
    locks: path.join(root, 'locks'),
    done: path.join(root, 'done'),
    failed: path.join(root, 'failed'),
  };
}

function ensure(root) {
  for (const d of Object.values(dirs(root))) fs.mkdirSync(d, { recursive: true });
}

function enqueue(root, job) {
  fs.writeFileSync(path.join(dirs(root).pending, `${job.id}.json`), JSON.stringify(job));
}

function listPending(root) {
  return fs
    .readdirSync(dirs(root).pending)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function lockPath(root, id) {
  return path.join(dirs(root).locks, `${id}.lock`);
}

function isStale(file, timeoutMs, now = Date.now()) {
  try {
    return now - fs.statSync(file).mtimeMs > timeoutMs;
  } catch {
    return true;
  }
}

// Claim a pending job for `owner`. Returns the job, or null when another
// worker holds it, it already finished, or it is not due yet. A lock older
// than timeoutMs belongs to a worker that died mid-render and is taken over.
async function claim(root, id, { timeoutMs, owner, now = Date.now() }) {
  const lock = lockPath(root, id);
  if (fs.existsSync(lock)) {
    if (!isStale(lock, timeoutMs, now)) return null;
    log.warn(`reclaiming stale lock for ${id}`);
  }
  let job;
  try {
    job = parseJob(await fsp.readFile(path.join(dirs(root).pending, `${id}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null; // finished meanwhile
    throw err;
  }
  if (!isDue(job, now)) return null;
  fs.writeFileSync(lock, JSON.stringify({ owner, at: new Date(now).toISOString() }));
  return job;
}

function complete(root, id, result) {
  const d = dirs(root);
  fs.writeFileSync(path.join(d.done, `${id}.json`), JSON.stringify(result));
  fs.rmSync(path.join(d.pending, `${id}.json`), { force: true });
  fs.rmSync(lockPath(root, id), { force: true });
}

function fail(root, id, job, err) {
  const d = dirs(root);
  fs.writeFileSync(path.join(d.failed, `${id}.json`), JSON.stringify({ job, error: String(err && err.message) }));
  fs.rmSync(path.join(d.pending, `${id}.json`), { force: true });
  fs.rmSync(lockPath(root, id), { force: true });
}

module.exports = { dirs, ensure, enqueue, listPending, lockPath, isStale, claim, complete, fail };
__FX__
mkdir -p src
cat > src/worker.js <<'__FX__'
'use strict';
// Worker process, forked by src/supervisor.js. Runs jobs from the spool until
// nothing is left, then exits.
const config = require('./config');
const spool = require('./spool');
const billing = require('./billing');
const { render } = require('./render');
const { units } = require('./job');
const log = require('./log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(cfg, id, owner) {
  const job = await spool.claim(cfg.spool, id, { timeoutMs: cfg.claimTimeoutMs, owner });
  if (!job) return false;
  log.debug(`claimed ${id}`);
  try {
    const outputs = await render(cfg.renderer, job, cfg.sizes);
    billing.record(cfg.billing, { job: id, asset: job.asset, units: units(job, cfg.sizes), worker: owner, at: new Date().toISOString() });
    spool.complete(cfg.spool, id, { id, outputs });
  } catch (err) {
    log.error(`${id}: ${err.message}`);
    spool.fail(cfg.spool, id, job, err);
  }
  return true;
}

async function loop(cfg, owner) {
  let done = 0;
  for (;;) {
    const pending = spool.listPending(cfg.spool);
    if (pending.length === 0) return done;
    let progressed = false;
    for (const id of pending) {
      if (await runOne(cfg, id, owner)) {
        done++;
        progressed = true;
        break; // rescan: earlier jobs may have been released
      }
    }
    if (!progressed) await sleep(cfg.pollMs);
  }
}

if (require.main === module) {
  const cfg = config.load();
  const owner = `${require('os').hostname()}:${process.pid}`;
  process.on('disconnect', () => process.exit(0)); // supervisor went away
  process.send({ type: 'ready' });
  process.on('message', async (m) => {
    if (m.type !== 'start') return;
    const done = await loop(cfg, owner);
    process.send({ type: 'finished', done }, () => process.exit(0));
  });
}

module.exports = { loop, runOne };
__FX__
mkdir -p config
cat > config/thumbd.json <<'__FX__'
{
  "workers": 4,
  "claimTimeoutMs": 30000,
  "pollMs": 250,
  "renderer": "imgproc",
  "spool": "spool",
  "billing": "var/billing.ndjson",
  "unitPriceEur": 0.012,
  "sizes": [[320, 180], [640, 360], [1280, 720]]
}
__FX__
mkdir -p src
cat > src/config.js <<'__FX__'
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// THUMBD_CONFIG lets the stress test and the tests run against their own spool.
function load(file = process.env.THUMBD_CONFIG || path.join(ROOT, 'config/thumbd.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['workers', 'claimTimeoutMs', 'pollMs', 'spool', 'billing', 'sizes']) {
    if (cfg[key] === undefined) throw new Error(`config ${file}: missing ${key}`);
  }
  return {
    ...cfg,
    renderer: process.env.THUMBD_RENDERER || cfg.renderer,
    spool: path.resolve(ROOT, cfg.spool),
    billing: path.resolve(ROOT, cfg.billing),
    file,
  };
}

module.exports = { load, ROOT };
__FX__
mkdir -p test
cat > test/spool.test.js <<'__FX__'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const spool = require('../src/spool');
const { tmpSpool, job } = require('./helpers');

function setup(...jobs) {
  const root = tmpSpool();
  spool.ensure(root);
  for (const j of jobs) spool.enqueue(root, j);
  return root;
}
const opts = { timeoutMs: 30_000, owner: 'test:1' };

test('listPending is sorted by id', () => {
  const root = setup(job('t-0003'), job('t-0001'), job('t-0002'));
  assert.deepStrictEqual(spool.listPending(root), ['t-0001', 't-0002', 't-0003']);
});

test('a claimed job cannot be claimed again', async () => {
  const root = setup(job('t-0001'));
  assert.strictEqual((await spool.claim(root, 't-0001', opts)).id, 't-0001');
  assert.strictEqual(await spool.claim(root, 't-0001', { ...opts, owner: 'test:2' }), null);
});

test('a stale lock is taken over', async () => {
  const root = setup(job('t-0001'));
  const lock = spool.lockPath(root, 't-0001');
  fs.writeFileSync(lock, JSON.stringify({ owner: 'dead:9', at: '2026-01-01T00:00:00Z' }));
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(lock, old, old);
  assert.strictEqual((await spool.claim(root, 't-0001', opts)).id, 't-0001');
  assert.strictEqual(JSON.parse(fs.readFileSync(lock, 'utf8')).owner, 'test:1');
});

test('a job that is not due is left alone', async () => {
  const root = setup(job('t-0001', { notBefore: '2999-01-01T00:00:00Z' }));
  assert.strictEqual(await spool.claim(root, 't-0001', opts), null);
  assert.ok(!fs.existsSync(spool.lockPath(root, 't-0001')));
});

test('a finished job cannot be claimed', async () => {
  const root = setup(job('t-0001'));
  await spool.claim(root, 't-0001', opts);
  spool.complete(root, 't-0001', { id: 't-0001', outputs: [] });
  assert.deepStrictEqual(spool.listPending(root), []);
  assert.strictEqual(await spool.claim(root, 't-0001', opts), null);
  assert.ok(fs.existsSync(path.join(spool.dirs(root).done, 't-0001.json')));
});

test('fail moves the job aside and releases the lock', async () => {
  const root = setup(job('t-0001'));
  const j = await spool.claim(root, 't-0001', opts);
  spool.fail(root, 't-0001', j, new Error('imgproc exit 3'));
  assert.ok(!fs.existsSync(spool.lockPath(root, 't-0001')));
  assert.match(fs.readFileSync(path.join(spool.dirs(root).failed, 't-0001.json'), 'utf8'), /imgproc exit 3/);
});
__FX__
mkdir -p docs
cat > docs/operations.md <<'__FX__'
# thumbd runbook

## Nightly batch

Cron on render-01/render-02 runs `npm run batch` at 01:30. Logs go to
`var/log/thumbd-<date>.log`. Finance pulls `var/billing.ndjson` on the 1st
and exports the previous month as `billing-<yyyy-mm>.ndjson`.

## INC-311 (2025-08-29): batch stuck after OOM kill

The kernel OOM-killed a worker mid-render. Its lock stayed in
`spool/locks/` forever and the job never ran again, and because workers
always rescan from the first pending id, every later batch skipped it.
Fix (2025-09-02): locks older than `claimTimeoutMs` are taken over. If you
see `reclaiming stale lock` in the log, check the host for OOM kills.

## Re-running a failed job

Move `spool/failed/<id>.json` back to `spool/pending/` (only the `job` field)
and run the batch.

## Duplicate charges

`npm run billing -- <file>` prints the duplicate count for a billing export.
Duplicates must be credited manually by finance (see the billing wiki).
__FX__
mkdir -p docs
cat > docs/queue.md <<'__FX__'
# Spool and claims

```
spool/pending/<id>.json   queued jobs
spool/locks/<id>.lock     claim held by a worker: { owner: "host:pid", at }
spool/done/<id>.json      render results
spool/failed/<id>.json    job + error message
```

`bin/run-batch.js` forks `workers` worker processes (`src/worker.js`). They
are separate processes on purpose: imgproc occasionally leaks memory on huge
TIFFs, and a dying worker must not take the batch down with it. Workers share
nothing except the spool directory, so the lock files are the only
coordination between them.

Each worker loops:

1. list `pending/`, sorted by id;
2. try to claim the first job it can (`spool.claim`);
3. render all sizes, append the billing line, `spool.complete` (writes
   `done/`, removes the pending file, then the lock);
4. go back to 1. When nothing is claimable it sleeps `pollMs`; when
   `pending/` is empty it exits.

A lock older than `claimTimeoutMs` is treated as abandoned (see INC-311 in
`docs/operations.md`) and the job is taken over by the next worker that
reaches it. Renders take 2-20 s in production, so 30 s leaves ample headroom.

Billing is per finished job. Rendering the same job twice is billed twice by
imgproc *and* by us.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.0.2 (2025-09-02)
- Take over locks older than `claimTimeoutMs` (INC-311).

## 2.0.1 (2025-08-04)
- 4 workers for the library backfill.

## 2.0.0 (2025-06-10)
- Spool queue with forked worker processes, replacing the single-process
  renderer.
__FX__
cat > package.json <<'__FX__'
{
  "name": "thumbd",
  "version": "2.0.2",
  "private": true,
  "description": "Batch thumbnail renderer for the media library (spool queue + forked workers)",
  "bin": { "thumbd": "bin/run-batch.js" },
  "scripts": {
    "batch": "node bin/run-batch.js",
    "billing": "node bin/billing-report.js",
    "seed": "node scripts/seed-jobs.js",
    "test": "node --test test/*.test.js"
  },
  "engines": { "node": ">=20" }
}
__FX__
git add -A
commit "2025-09-02T10:05:00Z" "spool: take over locks older than claimTimeoutMs (INC-311)"

# --- npm run stress: load test for the batch runner
mkdir -p scripts
cat > scripts/stress.js <<'__FX__'
#!/usr/bin/env node
'use strict';
// Load test: queue 240 jobs into a scratch spool under var/stress/, run one
// batch with the configured number of workers and the fake renderer, then
// check that every job was rendered and billed exactly once. The first four
// jobs start out locked by a worker that died two hours ago (as after the
// OOM kill in INC-311), so the batch also has to take those over.
// Writes var/stress/report.txt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('../src/config');

const JOBS = 240;
const dir = path.join(ROOT, 'var/stress');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/thumbd.json'), 'utf8'));
const cfgFile = path.join(dir, 'thumbd.json');
fs.writeFileSync(
  cfgFile,
  JSON.stringify({ ...base, renderer: 'fake', pollMs: 20, spool: 'var/stress/spool', billing: 'var/stress/billing.ndjson' }, null, 2)
);
const env = { THUMBD_CONFIG: cfgFile, THUMBD_RENDERER: 'fake', THUMBD_FAKE_LOG: path.join(dir, 'renders.log') };
Object.assign(process.env, env);

const config = require('../src/config');
const spool = require('../src/spool');
const billing = require('../src/billing');
const { runBatch } = require('../src/supervisor');
const { seed } = require('./seed-jobs');

async function main() {
  const cfg = config.load();
  seed(cfg.spool, JOBS, 7);
  const crashed = new Date(Date.now() - 2 * 3600_000);
  for (const id of ['t-0001', 't-0002', 't-0003', 't-0004']) {
    const lock = spool.lockPath(cfg.spool, id);
    fs.writeFileSync(lock, JSON.stringify({ owner: 'render-02:41877', at: crashed.toISOString() }));
    fs.utimesSync(lock, crashed, crashed);
  }
  const { ms, timedOut } = await runBatch(cfg, { env, deadlineMs: 20_000 });

  const renders = fs.existsSync(env.THUMBD_FAKE_LOG)
    ? fs.readFileSync(env.THUMBD_FAKE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0])
    : [];
  const entries = billing.read(cfg.billing);
  const done = new Set(fs.readdirSync(spool.dirs(cfg.spool).done).map((f) => f.replace(/\.json$/, '')));
  const failed = fs.readdirSync(spool.dirs(cfg.spool).failed).length;
  const seeded = [];
  for (let i = 1; i <= JOBS; i++) seeded.push(`t-${String(i).padStart(4, '0')}`);
  const missing = seeded.filter((id) => !done.has(id)).length;
  const ledger = entries.map((e) => `${e.job} ${e.units}`).sort().join('\n');

  const report = [
    'thumbd stress test',
    `workers: ${cfg.workers}`,
    `jobs: ${JOBS}`,
    `renders: ${renders.length}`,
    `billed: ${entries.length}`,
    `duplicate renders: ${renders.length - new Set(renders).size}`,
    `missing: ${missing}`,
    `failed: ${failed}`,
    `timed out: ${timedOut ? 'yes' : 'no'}`,
    `ledger sha256: ${crypto.createHash('sha256').update(ledger).digest('hex')}`,
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'report.txt'), report + '\n');
  console.log(report);
  console.log(`(${ms} ms)`);
  const ok = renders.length === JOBS && entries.length === JOBS && missing === 0 && failed === 0 && !timedOut;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(2);
});
__FX__
mkdir -p src
cat > src/supervisor.js <<'__FX__'
'use strict';
const path = require('path');
const { fork } = require('child_process');
const log = require('./log');

// Fork cfg.workers worker processes, start them together once all are up
// (so the batch duration is measured from a common start), and resolve with
// the number of jobs each one ran. With deadlineMs, workers still running at
// the deadline are killed and the result has timedOut: true.
function runBatch(cfg, { env = {}, deadlineMs } = {}) {
  return new Promise((resolve, reject) => {
    const workers = [];
    let timer;
    if (deadlineMs) {
      timer = setTimeout(() => {
        log.error(`batch deadline of ${deadlineMs} ms reached, killing workers`);
        workers.forEach((w) => w.kill('SIGTERM'));
        resolve({ perWorker: done.slice(), ms: Date.now() - done.t0, timedOut: true });
      }, deadlineMs);
    }
    let ready = 0;
    const done = [];
    for (let i = 0; i < cfg.workers; i++) {
      const w = fork(path.join(__dirname, 'worker.js'), [], {
        env: { ...process.env, ...env, THUMBD_WORKER: String(i + 1) },
      });
      workers.push(w);
      w.on('message', (m) => {
        if (m.type === 'ready' && ++ready === cfg.workers) {
          const t0 = Date.now();
          workers.forEach((x) => x.send({ type: 'start' }));
          log.info(`batch started with ${cfg.workers} workers`);
          done.t0 = t0;
        }
        if (m.type === 'finished') done.push(m.done);
      });
      w.on('error', reject);
      w.on('exit', (code) => {
        if (code !== 0 && code !== null) return reject(new Error(`worker ${i + 1} exited with ${code}`));
        if (done.length === cfg.workers) {
          clearTimeout(timer);
          resolve({ perWorker: done.slice(), ms: Date.now() - done.t0 });
        }
      });
    }
  });
}

module.exports = { runBatch };
__FX__
cat > README.md <<'__FX__'
# thumbd

Batch thumbnail renderer for the media library. Jobs are queued as JSON files
in a spool directory; `bin/run-batch.js` forks `workers` worker processes
that render every configured size through the imgproc service and append one
billing line per finished job to `var/billing.ndjson`.

```
npm run seed -- 20        # queue 20 synthetic jobs (dev only)
npm run batch             # run all pending jobs
npm run billing           # summarize the billing file
npm run stress            # load test with the fake renderer (see below)
npm test
```

Configuration lives in `config/thumbd.json`; `THUMBD_CONFIG` points at another
file, and `THUMBD_RENDERER=fake` swaps imgproc for the local stand-in.

See `docs/queue.md` for how the spool and claims work and
`docs/operations.md` for the runbook.

## Stress test

`npm run stress` queues 240 jobs into a scratch spool under `var/stress/`,
starts with four of them locked by a dead worker, runs one batch with the
configured worker count and the fake renderer, and writes
`var/stress/report.txt`. Every job must be rendered and billed exactly once.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.1.0 (2026-03-16)
- `npm run stress`: load test for the batch runner (240 jobs, fake renderer).
- Batch deadline support in the supervisor (used by the stress test).

## 2.0.2 (2025-09-02)
- Take over locks older than `claimTimeoutMs` (INC-311).

## 2.0.1 (2025-08-04)
- 4 workers for the library backfill.

## 2.0.0 (2025-06-10)
- Spool queue with forked worker processes, replacing the single-process
  renderer.
__FX__
cat > package.json <<'__FX__'
{
  "name": "thumbd",
  "version": "2.1.0",
  "private": true,
  "description": "Batch thumbnail renderer for the media library (spool queue + forked workers)",
  "bin": { "thumbd": "bin/run-batch.js" },
  "scripts": {
    "batch": "node bin/run-batch.js",
    "billing": "node bin/billing-report.js",
    "seed": "node scripts/seed-jobs.js",
    "stress": "node scripts/stress.js",
    "test": "node --test test/*.test.js"
  },
  "engines": { "node": ">=20" }
}
__FX__
git add -A
commit "2026-03-16T16:20:00Z" "npm run stress: load test for the batch runner"

# --- uncommitted
mkdir -p var
cat > var/billing-2026-09.ndjson <<'__FX__'
{"job":"a-51201","asset":"media/lib/358407.jpg","units":5,"worker":"render-01:45804","at":"2026-09-02T01:30:07.824Z"}
{"job":"a-51204","asset":"media/lib/358428.jpg","units":8,"worker":"render-01:59728","at":"2026-09-02T01:30:11.439Z"}
{"job":"a-51203","asset":"media/lib/358421.jpg","units":5,"worker":"render-01:40139","at":"2026-09-02T01:30:14.375Z"}
{"job":"a-51202","asset":"media/lib/358414.jpg","units":8,"worker":"render-01:45110","at":"2026-09-02T01:30:14.445Z"}
{"job":"a-51206","asset":"media/lib/358442.jpg","units":4,"worker":"render-01:59728","at":"2026-09-02T01:30:19.902Z"}
{"job":"a-51205","asset":"media/lib/358435.jpg","units":7,"worker":"render-01:45804","at":"2026-09-02T01:30:21.280Z"}
{"job":"a-51209","asset":"media/lib/358463.jpg","units":6,"worker":"render-01:59728","at":"2026-09-02T01:30:22.997Z"}
{"job":"a-51208","asset":"media/lib/358456.jpg","units":7,"worker":"render-01:45110","at":"2026-09-02T01:30:29.656Z"}
{"job":"a-51207","asset":"media/lib/358449.jpg","units":5,"worker":"render-01:40139","at":"2026-09-02T01:30:31.203Z"}
{"job":"a-51213","asset":"media/lib/358491.jpg","units":8,"worker":"render-01:40139","at":"2026-09-02T01:30:36.450Z"}
{"job":"a-51211","asset":"media/lib/358477.jpg","units":9,"worker":"render-01:59728","at":"2026-09-02T01:30:37.197Z"}
{"job":"a-51210","asset":"media/lib/358470.jpg","units":6,"worker":"render-01:45804","at":"2026-09-02T01:30:38.006Z"}
{"job":"a-51212","asset":"media/lib/358484.jpg","units":5,"worker":"render-01:45110","at":"2026-09-02T01:30:38.413Z"}
{"job":"a-51214","asset":"media/lib/358498.jpg","units":7,"worker":"render-01:40139","at":"2026-09-02T01:30:40.230Z"}
{"job":"a-51216","asset":"media/lib/358512.jpg","units":7,"worker":"render-01:45804","at":"2026-09-02T01:30:41.592Z"}
{"job":"a-51215","asset":"media/lib/358505.jpg","units":5,"worker":"render-01:59728","at":"2026-09-02T01:30:45.172Z"}
{"job":"a-51219","asset":"media/lib/358533.jpg","units":6,"worker":"render-01:45804","at":"2026-09-02T01:30:45.984Z"}
{"job":"a-51218","asset":"media/lib/358526.jpg","units":6,"worker":"render-01:40139","at":"2026-09-02T01:30:49.158Z"}
{"job":"a-51220","asset":"media/lib/358540.jpg","units":5,"worker":"render-01:59728","at":"2026-09-02T01:30:49.658Z"}
{"job":"a-51217","asset":"media/lib/358519.jpg","units":8,"worker":"render-01:45110","at":"2026-09-02T01:30:51.634Z"}
{"job":"a-51224","asset":"media/lib/358568.jpg","units":6,"worker":"render-01:45110","at":"2026-09-02T01:30:59.057Z"}
{"job":"a-51221","asset":"media/lib/358547.jpg","units":6,"worker":"render-01:45804","at":"2026-09-02T01:30:59.918Z"}
{"job":"a-51223","asset":"media/lib/358561.jpg","units":6,"worker":"render-01:59728","at":"2026-09-02T01:31:00.456Z"}
{"job":"a-51225","asset":"media/lib/358575.jpg","units":6,"worker":"render-01:59728","at":"2026-09-02T01:31:01.964Z"}
{"job":"a-51225","asset":"media/lib/358575.jpg","units":6,"worker":"render-01:45110","at":"2026-09-02T01:31:01.969Z"}
{"job":"a-51222","asset":"media/lib/358554.jpg","units":5,"worker":"render-01:40139","at":"2026-09-02T01:31:03.994Z"}
{"job":"a-51228","asset":"media/lib/358596.jpg","units":7,"worker":"render-01:59728","at":"2026-09-02T01:31:06.205Z"}
{"job":"a-51229","asset":"media/lib/358603.jpg","units":8,"worker":"render-01:40139","at":"2026-09-02T01:31:08.873Z"}
{"job":"a-51226","asset":"media/lib/358582.jpg","units":6,"worker":"render-01:45804","at":"2026-09-02T01:31:12.501Z"}
{"job":"a-51230","asset":"media/lib/358610.jpg","units":8,"worker":"render-01:59728","at":"2026-09-02T01:31:13.196Z"}
{"job":"a-51227","asset":"media/lib/358589.jpg","units":5,"worker":"render-01:45110","at":"2026-09-02T01:31:14.254Z"}
{"job":"a-51231","asset":"media/lib/358617.jpg","units":4,"worker":"render-01:45110","at":"2026-09-02T01:31:20.821Z"}
{"job":"a-51231","asset":"media/lib/358617.jpg","units":4,"worker":"render-01:40139","at":"2026-09-02T01:31:20.826Z"}
{"job":"a-51232","asset":"media/lib/358624.jpg","units":6,"worker":"render-01:45804","at":"2026-09-02T01:31:25.324Z"}
{"job":"a-51233","asset":"media/lib/358631.jpg","units":9,"worker":"render-01:59728","at":"2026-09-02T01:31:30.337Z"}
{"job":"a-51235","asset":"media/lib/358645.jpg","units":9,"worker":"render-01:45804","at":"2026-09-02T01:31:31.363Z"}
{"job":"a-51234","asset":"media/lib/358638.jpg","units":8,"worker":"render-01:40139","at":"2026-09-02T01:31:35.889Z"}
{"job":"a-51236","asset":"media/lib/358652.jpg","units":9,"worker":"render-01:45110","at":"2026-09-02T01:31:37.059Z"}
{"job":"a-51237","asset":"media/lib/358659.jpg","units":8,"worker":"render-01:59728","at":"2026-09-02T01:31:43.247Z"}
{"job":"a-51238","asset":"media/lib/358666.jpg","units":7,"worker":"render-02:40215","at":"2026-09-03T01:30:04.882Z"}
{"job":"a-51241","asset":"media/lib/358687.jpg","units":4,"worker":"render-02:59094","at":"2026-09-03T01:30:12.257Z"}
{"job":"a-51240","asset":"media/lib/358680.jpg","units":4,"worker":"render-02:43989","at":"2026-09-03T01:30:15.883Z"}
{"job":"a-51239","asset":"media/lib/358673.jpg","units":9,"worker":"render-02:45395","at":"2026-09-03T01:30:20.189Z"}
{"job":"a-51242","asset":"media/lib/358694.jpg","units":9,"worker":"render-02:40215","at":"2026-09-03T01:30:20.203Z"}
{"job":"a-51246","asset":"media/lib/358722.jpg","units":6,"worker":"render-02:40215","at":"2026-09-03T01:30:22.485Z"}
{"job":"a-51245","asset":"media/lib/358715.jpg","units":4,"worker":"render-02:45395","at":"2026-09-03T01:30:23.825Z"}
{"job":"a-51243","asset":"media/lib/358701.jpg","units":9,"worker":"render-02:59094","at":"2026-09-03T01:30:26.247Z"}
{"job":"a-51248","asset":"media/lib/358736.jpg","units":6,"worker":"render-02:45395","at":"2026-09-03T01:30:27.615Z"}
{"job":"a-51244","asset":"media/lib/358708.jpg","units":8,"worker":"render-02:43989","at":"2026-09-03T01:30:31.878Z"}
{"job":"a-51249","asset":"media/lib/358743.jpg","units":8,"worker":"render-02:59094","at":"2026-09-03T01:30:32.562Z"}
{"job":"a-51251","asset":"media/lib/358757.jpg","units":6,"worker":"render-02:43989","at":"2026-09-03T01:30:37.180Z"}
{"job":"a-51247","asset":"media/lib/358729.jpg","units":9,"worker":"render-02:40215","at":"2026-09-03T01:30:38.303Z"}
{"job":"a-51250","asset":"media/lib/358750.jpg","units":7,"worker":"render-02:45395","at":"2026-09-03T01:30:39.798Z"}
{"job":"a-51253","asset":"media/lib/358771.jpg","units":6,"worker":"render-02:43989","at":"2026-09-03T01:30:42.370Z"}
{"job":"a-51252","asset":"media/lib/358764.jpg","units":9,"worker":"render-02:59094","at":"2026-09-03T01:30:47.322Z"}
{"job":"a-51255","asset":"media/lib/358785.jpg","units":7,"worker":"render-02:45395","at":"2026-09-03T01:30:51.270Z"}
{"job":"a-51254","asset":"media/lib/358778.jpg","units":5,"worker":"render-02:40215","at":"2026-09-03T01:30:54.482Z"}
{"job":"a-51256","asset":"media/lib/358792.jpg","units":4,"worker":"render-02:43989","at":"2026-09-03T01:30:57.097Z"}
{"job":"a-51260","asset":"media/lib/358820.jpg","units":8,"worker":"render-02:43989","at":"2026-09-03T01:31:00.658Z"}
{"job":"a-51259","asset":"media/lib/358813.jpg","units":6,"worker":"render-02:40215","at":"2026-09-03T01:31:03.136Z"}
{"job":"a-51257","asset":"media/lib/358799.jpg","units":7,"worker":"render-02:59094","at":"2026-09-03T01:31:03.886Z"}
{"job":"a-51258","asset":"media/lib/358806.jpg","units":8,"worker":"render-02:45395","at":"2026-09-03T01:31:04.933Z"}
{"job":"a-51262","asset":"media/lib/358834.jpg","units":6,"worker":"render-02:40215","at":"2026-09-03T01:31:14.791Z"}
{"job":"a-51261","asset":"media/lib/358827.jpg","units":8,"worker":"render-02:43989","at":"2026-09-03T01:31:16.197Z"}
{"job":"a-51265","asset":"media/lib/358855.jpg","units":5,"worker":"render-01:52388","at":"2026-09-04T01:30:05.868Z"}
{"job":"a-51264","asset":"media/lib/358848.jpg","units":8,"worker":"render-01:53740","at":"2026-09-04T01:30:09.539Z"}
{"job":"a-51263","asset":"media/lib/358841.jpg","units":9,"worker":"render-01:33683","at":"2026-09-04T01:30:13.766Z"}
{"job":"a-51267","asset":"media/lib/358869.jpg","units":6,"worker":"render-01:52388","at":"2026-09-04T01:30:18.602Z"}
{"job":"a-51266","asset":"media/lib/358862.jpg","units":7,"worker":"render-01:42355","at":"2026-09-04T01:30:19.653Z"}
{"job":"a-51271","asset":"media/lib/358897.jpg","units":8,"worker":"render-01:42355","at":"2026-09-04T01:30:26.025Z"}
{"job":"a-51268","asset":"media/lib/358876.jpg","units":6,"worker":"render-01:53740","at":"2026-09-04T01:30:27.421Z"}
{"job":"a-51269","asset":"media/lib/358883.jpg","units":8,"worker":"render-01:33683","at":"2026-09-04T01:30:27.612Z"}
{"job":"a-51270","asset":"media/lib/358890.jpg","units":8,"worker":"render-01:52388","at":"2026-09-04T01:30:35.942Z"}
{"job":"a-51274","asset":"media/lib/358918.jpg","units":7,"worker":"render-01:33683","at":"2026-09-04T01:30:39.061Z"}
{"job":"a-51273","asset":"media/lib/358911.jpg","units":4,"worker":"render-01:53740","at":"2026-09-04T01:30:40.069Z"}
{"job":"a-51272","asset":"media/lib/358904.jpg","units":5,"worker":"render-01:42355","at":"2026-09-04T01:30:41.040Z"}
{"job":"a-51277","asset":"media/lib/358939.jpg","units":7,"worker":"render-01:53740","at":"2026-09-04T01:30:45.300Z"}
{"job":"a-51278","asset":"media/lib/358946.jpg","units":5,"worker":"render-01:42355","at":"2026-09-04T01:30:45.417Z"}
{"job":"a-51275","asset":"media/lib/358925.jpg","units":5,"worker":"render-01:52388","at":"2026-09-04T01:30:45.797Z"}
{"job":"a-51280","asset":"media/lib/358960.jpg","units":7,"worker":"render-01:42355","at":"2026-09-04T01:30:52.133Z"}
{"job":"a-51276","asset":"media/lib/358932.jpg","units":7,"worker":"render-01:33683","at":"2026-09-04T01:30:54.826Z"}
{"job":"a-51279","asset":"media/lib/358953.jpg","units":8,"worker":"render-01:53740","at":"2026-09-04T01:30:59.600Z"}
{"job":"a-51281","asset":"media/lib/358967.jpg","units":6,"worker":"render-01:26813","at":"2026-09-06T01:30:09.503Z"}
{"job":"a-51283","asset":"media/lib/358981.jpg","units":5,"worker":"render-01:57171","at":"2026-09-06T01:30:16.449Z"}
{"job":"a-51284","asset":"media/lib/358988.jpg","units":6,"worker":"render-01:49869","at":"2026-09-06T01:30:16.548Z"}
{"job":"a-51282","asset":"media/lib/358974.jpg","units":6,"worker":"render-01:52966","at":"2026-09-06T01:30:17.149Z"}
{"job":"a-51288","asset":"media/lib/359016.jpg","units":6,"worker":"render-01:52966","at":"2026-09-06T01:30:21.144Z"}
{"job":"a-51285","asset":"media/lib/358995.jpg","units":6,"worker":"render-01:26813","at":"2026-09-06T01:30:21.480Z"}
{"job":"a-51287","asset":"media/lib/359009.jpg","units":6,"worker":"render-01:49869","at":"2026-09-06T01:30:34.081Z"}
{"job":"a-51286","asset":"media/lib/359002.jpg","units":5,"worker":"render-01:57171","at":"2026-09-06T01:30:34.179Z"}
{"job":"a-51289","asset":"media/lib/359023.jpg","units":8,"worker":"render-01:52966","at":"2026-09-06T01:30:35.013Z"}
{"job":"a-51292","asset":"media/lib/359044.jpg","units":4,"worker":"render-01:57171","at":"2026-09-06T01:30:37.001Z"}
{"job":"a-51290","asset":"media/lib/359030.jpg","units":5,"worker":"render-01:26813","at":"2026-09-06T01:30:37.611Z"}
{"job":"a-51291","asset":"media/lib/359037.jpg","units":8,"worker":"render-01:49869","at":"2026-09-06T01:30:38.936Z"}
{"job":"a-51296","asset":"media/lib/359072.jpg","units":8,"worker":"render-01:49869","at":"2026-09-06T01:30:43.824Z"}
{"job":"a-51294","asset":"media/lib/359058.jpg","units":7,"worker":"render-01:57171","at":"2026-09-06T01:30:44.414Z"}
{"job":"a-51293","asset":"media/lib/359051.jpg","units":6,"worker":"render-01:52966","at":"2026-09-06T01:30:51.056Z"}
{"job":"a-51298","asset":"media/lib/359086.jpg","units":8,"worker":"render-01:57171","at":"2026-09-06T01:30:53.744Z"}
{"job":"a-51295","asset":"media/lib/359065.jpg","units":4,"worker":"render-01:26813","at":"2026-09-06T01:30:53.931Z"}
{"job":"a-51301","asset":"media/lib/359107.jpg","units":9,"worker":"render-01:26813","at":"2026-09-06T01:30:56.860Z"}
{"job":"a-51297","asset":"media/lib/359079.jpg","units":8,"worker":"render-01:49869","at":"2026-09-06T01:30:57.864Z"}
{"job":"a-51300","asset":"media/lib/359100.jpg","units":7,"worker":"render-01:57171","at":"2026-09-06T01:30:58.512Z"}
{"job":"a-51299","asset":"media/lib/359093.jpg","units":5,"worker":"render-01:52966","at":"2026-09-06T01:30:59.303Z"}
{"job":"a-51303","asset":"media/lib/359121.jpg","units":7,"worker":"render-02:39253","at":"2026-09-07T01:30:06.633Z"}
{"job":"a-51302","asset":"media/lib/359114.jpg","units":5,"worker":"render-02:22182","at":"2026-09-07T01:30:09.120Z"}
{"job":"a-51305","asset":"media/lib/359135.jpg","units":4,"worker":"render-02:20641","at":"2026-09-07T01:30:13.389Z"}
{"job":"a-51307","asset":"media/lib/359149.jpg","units":5,"worker":"render-02:22182","at":"2026-09-07T01:30:14.825Z"}
{"job":"a-51304","asset":"media/lib/359128.jpg","units":7,"worker":"render-02:26605","at":"2026-09-07T01:30:17.082Z"}
{"job":"a-51306","asset":"media/lib/359142.jpg","units":4,"worker":"render-02:39253","at":"2026-09-07T01:30:18.164Z"}
{"job":"a-51310","asset":"media/lib/359170.jpg","units":7,"worker":"render-02:26605","at":"2026-09-07T01:30:23.945Z"}
{"job":"a-51309","asset":"media/lib/359163.jpg","units":7,"worker":"render-02:22182","at":"2026-09-07T01:30:24.274Z"}
{"job":"a-51311","asset":"media/lib/359177.jpg","units":8,"worker":"render-02:39253","at":"2026-09-07T01:30:26.279Z"}
{"job":"a-51308","asset":"media/lib/359156.jpg","units":8,"worker":"render-02:20641","at":"2026-09-07T01:30:26.781Z"}
{"job":"a-51312","asset":"media/lib/359184.jpg","units":5,"worker":"render-02:26605","at":"2026-09-07T01:30:35.673Z"}
{"job":"a-51314","asset":"media/lib/359198.jpg","units":8,"worker":"render-02:39253","at":"2026-09-07T01:30:38.058Z"}
{"job":"a-51315","asset":"media/lib/359205.jpg","units":4,"worker":"render-02:20641","at":"2026-09-07T01:30:38.526Z"}
{"job":"a-51317","asset":"media/lib/359219.jpg","units":9,"worker":"render-02:39253","at":"2026-09-07T01:30:40.211Z"}
{"job":"a-51313","asset":"media/lib/359191.jpg","units":7,"worker":"render-02:22182","at":"2026-09-07T01:30:41.037Z"}
{"job":"a-51318","asset":"media/lib/359226.jpg","units":6,"worker":"render-02:20641","at":"2026-09-07T01:30:43.755Z"}
{"job":"a-51316","asset":"media/lib/359212.jpg","units":9,"worker":"render-02:26605","at":"2026-09-07T01:30:44.087Z"}
{"job":"a-51320","asset":"media/lib/359240.jpg","units":4,"worker":"render-02:22182","at":"2026-09-07T01:30:44.649Z"}
{"job":"a-51323","asset":"media/lib/359261.jpg","units":4,"worker":"render-02:22182","at":"2026-09-07T01:30:49.082Z"}
{"job":"a-51324","asset":"media/lib/359268.jpg","units":5,"worker":"render-02:22182","at":"2026-09-07T01:30:51.236Z"}
{"job":"a-51322","asset":"media/lib/359254.jpg","units":6,"worker":"render-02:26605","at":"2026-09-07T01:30:53.423Z"}
{"job":"a-51319","asset":"media/lib/359233.jpg","units":7,"worker":"render-02:39253","at":"2026-09-07T01:30:55.768Z"}
{"job":"a-51321","asset":"media/lib/359247.jpg","units":6,"worker":"render-02:20641","at":"2026-09-07T01:30:59.030Z"}
{"job":"a-51327","asset":"media/lib/359289.jpg","units":6,"worker":"render-02:39253","at":"2026-09-07T01:31:00.107Z"}
{"job":"a-51325","asset":"media/lib/359275.jpg","units":7,"worker":"render-02:22182","at":"2026-09-07T01:31:04.297Z"}
{"job":"a-51326","asset":"media/lib/359282.jpg","units":4,"worker":"render-02:22182","at":"2026-09-07T01:31:05.812Z"}
{"job":"a-51326","asset":"media/lib/359282.jpg","units":4,"worker":"render-02:26605","at":"2026-09-07T01:31:05.815Z"}
{"job":"a-51329","asset":"media/lib/359303.jpg","units":4,"worker":"render-02:39253","at":"2026-09-07T01:31:08.039Z"}
{"job":"a-51328","asset":"media/lib/359296.jpg","units":6,"worker":"render-02:20641","at":"2026-09-07T01:31:08.198Z"}
{"job":"a-51331","asset":"media/lib/359317.jpg","units":9,"worker":"render-01:48651","at":"2026-09-08T01:30:07.855Z"}
{"job":"a-51330","asset":"media/lib/359310.jpg","units":5,"worker":"render-01:32536","at":"2026-09-08T01:30:14.532Z"}
{"job":"a-51334","asset":"media/lib/359338.jpg","units":6,"worker":"render-01:48651","at":"2026-09-08T01:30:17.128Z"}
{"job":"a-51333","asset":"media/lib/359331.jpg","units":8,"worker":"render-01:37631","at":"2026-09-08T01:30:18.892Z"}
{"job":"a-51335","asset":"media/lib/359345.jpg","units":8,"worker":"render-01:32536","at":"2026-09-08T01:30:20.078Z"}
{"job":"a-51332","asset":"media/lib/359324.jpg","units":6,"worker":"render-01:56313","at":"2026-09-08T01:30:20.835Z"}
{"job":"a-51337","asset":"media/lib/359359.jpg","units":9,"worker":"render-01:37631","at":"2026-09-08T01:30:21.752Z"}
{"job":"a-51336","asset":"media/lib/359352.jpg","units":8,"worker":"render-01:48651","at":"2026-09-08T01:30:32.682Z"}
{"job":"a-51339","asset":"media/lib/359373.jpg","units":8,"worker":"render-01:56313","at":"2026-09-08T01:30:32.854Z"}
{"job":"a-51338","asset":"media/lib/359366.jpg","units":7,"worker":"render-01:32536","at":"2026-09-08T01:30:34.162Z"}
{"job":"a-51340","asset":"media/lib/359380.jpg","units":7,"worker":"render-01:37631","at":"2026-09-08T01:30:36.749Z"}
{"job":"a-51341","asset":"media/lib/359387.jpg","units":7,"worker":"render-01:48651","at":"2026-09-08T01:30:38.911Z"}
{"job":"a-51344","asset":"media/lib/359408.jpg","units":7,"worker":"render-01:37631","at":"2026-09-08T01:30:46.234Z"}
{"job":"a-51343","asset":"media/lib/359401.jpg","units":4,"worker":"render-01:32536","at":"2026-09-08T01:30:48.794Z"}
{"job":"a-51342","asset":"media/lib/359394.jpg","units":6,"worker":"render-01:56313","at":"2026-09-08T01:30:49.959Z"}
{"job":"a-51348","asset":"media/lib/359436.jpg","units":5,"worker":"render-01:56313","at":"2026-09-08T01:30:53.020Z"}
{"job":"a-51346","asset":"media/lib/359422.jpg","units":8,"worker":"render-01:37631","at":"2026-09-08T01:30:53.695Z"}
{"job":"a-51345","asset":"media/lib/359415.jpg","units":9,"worker":"render-01:48651","at":"2026-09-08T01:30:55.439Z"}
{"job":"a-51349","asset":"media/lib/359443.jpg","units":7,"worker":"render-01:56313","at":"2026-09-08T01:30:56.101Z"}
{"job":"a-51347","asset":"media/lib/359429.jpg","units":6,"worker":"render-01:32536","at":"2026-09-08T01:30:59.383Z"}
{"job":"a-51351","asset":"media/lib/359457.jpg","units":7,"worker":"render-01:48651","at":"2026-09-08T01:31:06.519Z"}
{"job":"a-51350","asset":"media/lib/359450.jpg","units":7,"worker":"render-01:37631","at":"2026-09-08T01:31:07.561Z"}
{"job":"a-51352","asset":"media/lib/359464.jpg","units":6,"worker":"render-01:56313","at":"2026-09-08T01:31:13.605Z"}
{"job":"a-51353","asset":"media/lib/359471.jpg","units":8,"worker":"render-01:32536","at":"2026-09-08T01:31:16.076Z"}
{"job":"a-51356","asset":"media/lib/359492.jpg","units":7,"worker":"render-02:50942","at":"2026-09-09T01:30:09.606Z"}
{"job":"a-51357","asset":"media/lib/359499.jpg","units":4,"worker":"render-02:37117","at":"2026-09-09T01:30:17.048Z"}
{"job":"a-51355","asset":"media/lib/359485.jpg","units":4,"worker":"render-02:40333","at":"2026-09-09T01:30:17.330Z"}
{"job":"a-51354","asset":"media/lib/359478.jpg","units":9,"worker":"render-02:48416","at":"2026-09-09T01:30:17.802Z"}
{"job":"a-51358","asset":"media/lib/359506.jpg","units":4,"worker":"render-02:50942","at":"2026-09-09T01:30:18.785Z"}
{"job":"a-51360","asset":"media/lib/359520.jpg","units":6,"worker":"render-02:40333","at":"2026-09-09T01:30:22.419Z"}
{"job":"a-51361","asset":"media/lib/359527.jpg","units":6,"worker":"render-02:48416","at":"2026-09-09T01:30:23.225Z"}
{"job":"a-51359","asset":"media/lib/359513.jpg","units":5,"worker":"render-02:37117","at":"2026-09-09T01:30:23.342Z"}
{"job":"a-51362","asset":"media/lib/359534.jpg","units":6,"worker":"render-02:50942","at":"2026-09-09T01:30:31.485Z"}
{"job":"a-51364","asset":"media/lib/359548.jpg","units":4,"worker":"render-02:48416","at":"2026-09-09T01:30:33.758Z"}
{"job":"a-51367","asset":"media/lib/359569.jpg","units":8,"worker":"render-02:48416","at":"2026-09-09T01:30:36.749Z"}
{"job":"a-51365","asset":"media/lib/359555.jpg","units":7,"worker":"render-02:37117","at":"2026-09-09T01:30:39.508Z"}
{"job":"a-51363","asset":"media/lib/359541.jpg","units":5,"worker":"render-02:40333","at":"2026-09-09T01:30:40.274Z"}
{"job":"a-51369","asset":"media/lib/359583.jpg","units":8,"worker":"render-02:37117","at":"2026-09-09T01:30:45.622Z"}
{"job":"a-51366","asset":"media/lib/359562.jpg","units":4,"worker":"render-02:50942","at":"2026-09-09T01:30:47.229Z"}
{"job":"a-51371","asset":"media/lib/359597.jpg","units":7,"worker":"render-02:37117","at":"2026-09-09T01:30:50.190Z"}
{"job":"a-51368","asset":"media/lib/359576.jpg","units":4,"worker":"render-02:48416","at":"2026-09-09T01:30:50.469Z"}
{"job":"a-51370","asset":"media/lib/359590.jpg","units":4,"worker":"render-02:40333","at":"2026-09-09T01:30:50.943Z"}
{"job":"a-51373","asset":"media/lib/359611.jpg","units":7,"worker":"render-02:37117","at":"2026-09-09T01:30:59.911Z"}
{"job":"a-51374","asset":"media/lib/359618.jpg","units":6,"worker":"render-02:48416","at":"2026-09-09T01:31:01.472Z"}
{"job":"a-51375","asset":"media/lib/359625.jpg","units":4,"worker":"render-02:40333","at":"2026-09-09T01:31:04.319Z"}
{"job":"a-51372","asset":"media/lib/359604.jpg","units":5,"worker":"render-02:50942","at":"2026-09-09T01:31:04.447Z"}
{"job":"a-51376","asset":"media/lib/359632.jpg","units":4,"worker":"render-02:37117","at":"2026-09-09T01:31:06.177Z"}
{"job":"a-51378","asset":"media/lib/359646.jpg","units":9,"worker":"render-02:40333","at":"2026-09-09T01:31:10.765Z"}
{"job":"a-51378","asset":"media/lib/359646.jpg","units":9,"worker":"render-02:50942","at":"2026-09-09T01:31:10.765Z"}
{"job":"a-51377","asset":"media/lib/359639.jpg","units":5,"worker":"render-02:48416","at":"2026-09-09T01:31:12.334Z"}
{"job":"a-51380","asset":"media/lib/359660.jpg","units":9,"worker":"render-02:40333","at":"2026-09-09T01:31:17.937Z"}
{"job":"a-51382","asset":"media/lib/359674.jpg","units":8,"worker":"render-02:48416","at":"2026-09-09T01:31:20.451Z"}
{"job":"a-51379","asset":"media/lib/359653.jpg","units":7,"worker":"render-02:37117","at":"2026-09-09T01:31:22.441Z"}
{"job":"a-51381","asset":"media/lib/359667.jpg","units":9,"worker":"render-02:50942","at":"2026-09-09T01:31:25.700Z"}
{"job":"a-51383","asset":"media/lib/359681.jpg","units":8,"worker":"render-02:40333","at":"2026-09-09T01:31:31.810Z"}
{"job":"a-51384","asset":"media/lib/359688.jpg","units":9,"worker":"render-01:46183","at":"2026-09-10T01:30:06.011Z"}
{"job":"a-51386","asset":"media/lib/359702.jpg","units":5,"worker":"render-01:40904","at":"2026-09-10T01:30:06.673Z"}
{"job":"a-51387","asset":"media/lib/359709.jpg","units":5,"worker":"render-01:47472","at":"2026-09-10T01:30:06.848Z"}
{"job":"a-51389","asset":"media/lib/359723.jpg","units":7,"worker":"render-01:40904","at":"2026-09-10T01:30:12.513Z"}
{"job":"a-51385","asset":"media/lib/359695.jpg","units":6,"worker":"render-01:25276","at":"2026-09-10T01:30:14.215Z"}
{"job":"a-51390","asset":"media/lib/359730.jpg","units":7,"worker":"render-01:47472","at":"2026-09-10T01:30:15.683Z"}
{"job":"a-51388","asset":"media/lib/359716.jpg","units":8,"worker":"render-01:46183","at":"2026-09-10T01:30:17.126Z"}
{"job":"a-51391","asset":"media/lib/359737.jpg","units":4,"worker":"render-01:40904","at":"2026-09-10T01:30:19.674Z"}
{"job":"a-51394","asset":"media/lib/359758.jpg","units":8,"worker":"render-01:46183","at":"2026-09-10T01:30:25.438Z"}
{"job":"a-51392","asset":"media/lib/359744.jpg","units":7,"worker":"render-01:25276","at":"2026-09-10T01:30:25.764Z"}
{"job":"a-51393","asset":"media/lib/359751.jpg","units":9,"worker":"render-01:47472","at":"2026-09-10T01:30:29.546Z"}
{"job":"a-51395","asset":"media/lib/359765.jpg","units":8,"worker":"render-01:40904","at":"2026-09-10T01:30:31.799Z"}
{"job":"a-51397","asset":"media/lib/359779.jpg","units":6,"worker":"render-01:25276","at":"2026-09-10T01:30:36.219Z"}
{"job":"a-51398","asset":"media/lib/359786.jpg","units":6,"worker":"render-01:47472","at":"2026-09-10T01:30:41.966Z"}
{"job":"a-51396","asset":"media/lib/359772.jpg","units":4,"worker":"render-01:46183","at":"2026-09-10T01:30:42.918Z"}
{"job":"a-51399","asset":"media/lib/359793.jpg","units":5,"worker":"render-01:40904","at":"2026-09-10T01:30:48.459Z"}
{"job":"a-51399","asset":"media/lib/359793.jpg","units":5,"worker":"render-01:25276","at":"2026-09-10T01:30:48.461Z"}
{"job":"a-51401","asset":"media/lib/359807.jpg","units":8,"worker":"render-01:46183","at":"2026-09-10T01:30:48.682Z"}
{"job":"a-51400","asset":"media/lib/359800.jpg","units":6,"worker":"render-01:47472","at":"2026-09-10T01:30:53.226Z"}
{"job":"a-51402","asset":"media/lib/359814.jpg","units":6,"worker":"render-01:40904","at":"2026-09-10T01:31:05.223Z"}
{"job":"a-51406","asset":"media/lib/359842.jpg","units":7,"worker":"render-02:50319","at":"2026-09-11T01:30:14.689Z"}
{"job":"a-51404","asset":"media/lib/359828.jpg","units":7,"worker":"render-02:41173","at":"2026-09-11T01:30:14.823Z"}
{"job":"a-51405","asset":"media/lib/359835.jpg","units":6,"worker":"render-02:32180","at":"2026-09-11T01:30:17.772Z"}
{"job":"a-51403","asset":"media/lib/359821.jpg","units":9,"worker":"render-02:39552","at":"2026-09-11T01:30:19.935Z"}
{"job":"a-51408","asset":"media/lib/359856.jpg","units":8,"worker":"render-02:41173","at":"2026-09-11T01:30:28.207Z"}
{"job":"a-51409","asset":"media/lib/359863.jpg","units":9,"worker":"render-02:32180","at":"2026-09-11T01:30:30.140Z"}
{"job":"a-51407","asset":"media/lib/359849.jpg","units":4,"worker":"render-02:50319","at":"2026-09-11T01:30:31.355Z"}
{"job":"a-51410","asset":"media/lib/359870.jpg","units":8,"worker":"render-02:39552","at":"2026-09-11T01:30:36.845Z"}
{"job":"a-51412","asset":"media/lib/359884.jpg","units":6,"worker":"render-02:32180","at":"2026-09-11T01:30:38.012Z"}
{"job":"a-51411","asset":"media/lib/359877.jpg","units":5,"worker":"render-02:41173","at":"2026-09-11T01:30:38.071Z"}
{"job":"a-51414","asset":"media/lib/359898.jpg","units":8,"worker":"render-02:39552","at":"2026-09-11T01:30:39.322Z"}
{"job":"a-51413","asset":"media/lib/359891.jpg","units":6,"worker":"render-02:50319","at":"2026-09-11T01:30:41.441Z"}
{"job":"a-51417","asset":"media/lib/359919.jpg","units":9,"worker":"render-02:39552","at":"2026-09-11T01:30:43.039Z"}
{"job":"a-51416","asset":"media/lib/359912.jpg","units":9,"worker":"render-02:41173","at":"2026-09-11T01:30:50.627Z"}
{"job":"a-51415","asset":"media/lib/359905.jpg","units":5,"worker":"render-02:32180","at":"2026-09-11T01:30:52.465Z"}
{"job":"a-51418","asset":"media/lib/359926.jpg","units":9,"worker":"render-02:50319","at":"2026-09-11T01:30:55.101Z"}
{"job":"a-51421","asset":"media/lib/359947.jpg","units":4,"worker":"render-02:32180","at":"2026-09-11T01:30:55.116Z"}
{"job":"a-51419","asset":"media/lib/359933.jpg","units":8,"worker":"render-02:39552","at":"2026-09-11T01:30:58.840Z"}
{"job":"a-51422","asset":"media/lib/359954.jpg","units":8,"worker":"render-02:50319","at":"2026-09-11T01:31:01.491Z"}
{"job":"a-51420","asset":"media/lib/359940.jpg","units":7,"worker":"render-02:41173","at":"2026-09-11T01:31:03.426Z"}
{"job":"a-51424","asset":"media/lib/359968.jpg","units":8,"worker":"render-02:39552","at":"2026-09-11T01:31:04.640Z"}
{"job":"a-51423","asset":"media/lib/359961.jpg","units":8,"worker":"render-02:32180","at":"2026-09-11T01:31:05.350Z"}
{"job":"a-51425","asset":"media/lib/359975.jpg","units":7,"worker":"render-02:50319","at":"2026-09-11T01:31:10.064Z"}
{"job":"a-51428","asset":"media/lib/359996.jpg","units":8,"worker":"render-02:32180","at":"2026-09-11T01:31:16.499Z"}
{"job":"a-51427","asset":"media/lib/359989.jpg","units":5,"worker":"render-02:39552","at":"2026-09-11T01:31:19.861Z"}
{"job":"a-51429","asset":"media/lib/360003.jpg","units":9,"worker":"render-02:32180","at":"2026-09-11T01:31:20.527Z"}
{"job":"a-51429","asset":"media/lib/360003.jpg","units":9,"worker":"render-02:50319","at":"2026-09-11T01:31:20.532Z"}
{"job":"a-51426","asset":"media/lib/359982.jpg","units":7,"worker":"render-02:41173","at":"2026-09-11T01:31:21.074Z"}
{"job":"a-51430","asset":"media/lib/360010.jpg","units":9,"worker":"render-02:39552","at":"2026-09-11T01:31:23.142Z"}
{"job":"a-51432","asset":"media/lib/360024.jpg","units":6,"worker":"render-02:41173","at":"2026-09-11T01:31:23.643Z"}
{"job":"a-51431","asset":"media/lib/360017.jpg","units":5,"worker":"render-02:50319","at":"2026-09-11T01:31:30.923Z"}
{"job":"a-51434","asset":"media/lib/360038.jpg","units":9,"worker":"render-02:41173","at":"2026-09-11T01:31:31.099Z"}
{"job":"a-51433","asset":"media/lib/360031.jpg","units":8,"worker":"render-02:39552","at":"2026-09-11T01:31:36.146Z"}
{"job":"a-51438","asset":"media/lib/360066.jpg","units":4,"worker":"render-01:31466","at":"2026-09-12T01:30:06.941Z"}
{"job":"a-51435","asset":"media/lib/360045.jpg","units":6,"worker":"render-01:57469","at":"2026-09-12T01:30:19.288Z"}
{"job":"a-51437","asset":"media/lib/360059.jpg","units":9,"worker":"render-01:45330","at":"2026-09-12T01:30:19.330Z"}
{"job":"a-51436","asset":"media/lib/360052.jpg","units":7,"worker":"render-01:53000","at":"2026-09-12T01:30:19.509Z"}
{"job":"a-51440","asset":"media/lib/360080.jpg","units":6,"worker":"render-01:57469","at":"2026-09-12T01:30:21.961Z"}
{"job":"a-51439","asset":"media/lib/360073.jpg","units":4,"worker":"render-01:31466","at":"2026-09-12T01:30:24.014Z"}
{"job":"a-51441","asset":"media/lib/360087.jpg","units":7,"worker":"render-01:45330","at":"2026-09-12T01:30:31.215Z"}
{"job":"a-51442","asset":"media/lib/360094.jpg","units":9,"worker":"render-01:53000","at":"2026-09-12T01:30:33.236Z"}
{"job":"a-51444","asset":"media/lib/360108.jpg","units":9,"worker":"render-01:31466","at":"2026-09-12T01:30:33.751Z"}
{"job":"a-51445","asset":"media/lib/360115.jpg","units":9,"worker":"render-01:45330","at":"2026-09-12T01:30:35.126Z"}
{"job":"a-51443","asset":"media/lib/360101.jpg","units":6,"worker":"render-01:57469","at":"2026-09-12T01:30:39.828Z"}
{"job":"a-51449","asset":"media/lib/360143.jpg","units":8,"worker":"render-01:57469","at":"2026-09-12T01:30:44.087Z"}
{"job":"a-51446","asset":"media/lib/360122.jpg","units":4,"worker":"render-01:53000","at":"2026-09-12T01:30:48.062Z"}
{"job":"a-51448","asset":"media/lib/360136.jpg","units":6,"worker":"render-01:45330","at":"2026-09-12T01:30:48.936Z"}
{"job":"a-51447","asset":"media/lib/360129.jpg","units":5,"worker":"render-01:31466","at":"2026-09-12T01:30:49.242Z"}
{"job":"a-51450","asset":"media/lib/360150.jpg","units":5,"worker":"render-01:57469","at":"2026-09-12T01:30:56.758Z"}
{"job":"a-51452","asset":"media/lib/360164.jpg","units":9,"worker":"render-01:45330","at":"2026-09-12T01:30:58.957Z"}
{"job":"a-51451","asset":"media/lib/360157.jpg","units":7,"worker":"render-01:53000","at":"2026-09-12T01:31:03.952Z"}
{"job":"a-51454","asset":"media/lib/360178.jpg","units":4,"worker":"render-01:57469","at":"2026-09-12T01:31:04.330Z"}
{"job":"a-51453","asset":"media/lib/360171.jpg","units":4,"worker":"render-01:31466","at":"2026-09-12T01:31:06.293Z"}
{"job":"a-51457","asset":"media/lib/360199.jpg","units":7,"worker":"render-01:57469","at":"2026-09-12T01:31:10.727Z"}
{"job":"a-51456","asset":"media/lib/360192.jpg","units":8,"worker":"render-01:53000","at":"2026-09-12T01:31:15.559Z"}
{"job":"a-51458","asset":"media/lib/360206.jpg","units":8,"worker":"render-01:31466","at":"2026-09-12T01:31:15.740Z"}
{"job":"a-51455","asset":"media/lib/360185.jpg","units":6,"worker":"render-01:45330","at":"2026-09-12T01:31:16.325Z"}
{"job":"a-51459","asset":"media/lib/360213.jpg","units":5,"worker":"render-01:57469","at":"2026-09-12T01:31:20.317Z"}
{"job":"a-51462","asset":"media/lib/360234.jpg","units":4,"worker":"render-01:45330","at":"2026-09-12T01:31:21.147Z"}
{"job":"a-51461","asset":"media/lib/360227.jpg","units":8,"worker":"render-01:31466","at":"2026-09-12T01:31:23.006Z"}
{"job":"a-51463","asset":"media/lib/360241.jpg","units":6,"worker":"render-01:57469","at":"2026-09-12T01:31:24.895Z"}
{"job":"a-51466","asset":"media/lib/360262.jpg","units":5,"worker":"render-01:57469","at":"2026-09-12T01:31:28.729Z"}
{"job":"a-51464","asset":"media/lib/360248.jpg","units":6,"worker":"render-01:45330","at":"2026-09-12T01:31:29.554Z"}
{"job":"a-51467","asset":"media/lib/360269.jpg","units":4,"worker":"render-01:57469","at":"2026-09-12T01:31:32.445Z"}
{"job":"a-51460","asset":"media/lib/360220.jpg","units":9,"worker":"render-01:53000","at":"2026-09-12T01:31:32.476Z"}
{"job":"a-51465","asset":"media/lib/360255.jpg","units":8,"worker":"render-01:31466","at":"2026-09-12T01:31:35.491Z"}
{"job":"a-51469","asset":"media/lib/360283.jpg","units":7,"worker":"render-01:57469","at":"2026-09-12T01:31:36.187Z"}
{"job":"a-51472","asset":"media/lib/360304.jpg","units":6,"worker":"render-01:57469","at":"2026-09-12T01:31:38.488Z"}
{"job":"a-51472","asset":"media/lib/360304.jpg","units":6,"worker":"render-01:53000","at":"2026-09-12T01:31:38.492Z"}
{"job":"a-51470","asset":"media/lib/360290.jpg","units":5,"worker":"render-01:53000","at":"2026-09-12T01:31:39.877Z"}
{"job":"a-51468","asset":"media/lib/360276.jpg","units":5,"worker":"render-01:45330","at":"2026-09-12T01:31:45.197Z"}
{"job":"a-51471","asset":"media/lib/360297.jpg","units":4,"worker":"render-01:31466","at":"2026-09-12T01:31:48.235Z"}
{"job":"a-51473","asset":"media/lib/360311.jpg","units":7,"worker":"render-01:57469","at":"2026-09-12T01:31:52.914Z"}
{"job":"a-51474","asset":"media/lib/360318.jpg","units":8,"worker":"render-01:53000","at":"2026-09-12T01:31:58.731Z"}
{"job":"a-51475","asset":"media/lib/360325.jpg","units":9,"worker":"render-01:37105","at":"2026-09-14T01:30:07.449Z"}
{"job":"a-51478","asset":"media/lib/360346.jpg","units":7,"worker":"render-01:41003","at":"2026-09-14T01:30:09.917Z"}
{"job":"a-51477","asset":"media/lib/360339.jpg","units":9,"worker":"render-01:31513","at":"2026-09-14T01:30:10.379Z"}
{"job":"a-51476","asset":"media/lib/360332.jpg","units":6,"worker":"render-01:37914","at":"2026-09-14T01:30:18.617Z"}
{"job":"a-51480","asset":"media/lib/360360.jpg","units":6,"worker":"render-01:41003","at":"2026-09-14T01:30:22.072Z"}
{"job":"a-51479","asset":"media/lib/360353.jpg","units":9,"worker":"render-01:37105","at":"2026-09-14T01:30:22.206Z"}
{"job":"a-51481","asset":"media/lib/360367.jpg","units":4,"worker":"render-01:31513","at":"2026-09-14T01:30:25.007Z"}
{"job":"a-51482","asset":"media/lib/360374.jpg","units":8,"worker":"render-01:37914","at":"2026-09-14T01:30:33.233Z"}
{"job":"a-51485","asset":"media/lib/360395.jpg","units":5,"worker":"render-01:31513","at":"2026-09-14T01:30:34.342Z"}
{"job":"a-51484","asset":"media/lib/360388.jpg","units":9,"worker":"render-01:37105","at":"2026-09-14T01:30:35.446Z"}
{"job":"a-51483","asset":"media/lib/360381.jpg","units":5,"worker":"render-01:41003","at":"2026-09-14T01:30:35.624Z"}
{"job":"a-51489","asset":"media/lib/360423.jpg","units":4,"worker":"render-01:41003","at":"2026-09-14T01:30:42.656Z"}
{"job":"a-51487","asset":"media/lib/360409.jpg","units":5,"worker":"render-01:31513","at":"2026-09-14T01:30:47.642Z"}
{"job":"a-51486","asset":"media/lib/360402.jpg","units":6,"worker":"render-01:37914","at":"2026-09-14T01:30:47.860Z"}
{"job":"a-51488","asset":"media/lib/360416.jpg","units":9,"worker":"render-01:37105","at":"2026-09-14T01:30:47.946Z"}
{"job":"a-51493","asset":"media/lib/360451.jpg","units":5,"worker":"render-01:37105","at":"2026-09-14T01:30:50.455Z"}
{"job":"a-51490","asset":"media/lib/360430.jpg","units":6,"worker":"render-01:41003","at":"2026-09-14T01:30:52.706Z"}
{"job":"a-51491","asset":"media/lib/360437.jpg","units":7,"worker":"render-01:31513","at":"2026-09-14T01:30:57.586Z"}
{"job":"a-51495","asset":"media/lib/360465.jpg","units":7,"worker":"render-01:41003","at":"2026-09-14T01:30:59.369Z"}
{"job":"a-51492","asset":"media/lib/360444.jpg","units":8,"worker":"render-01:37914","at":"2026-09-14T01:30:59.952Z"}
{"job":"a-51494","asset":"media/lib/360458.jpg","units":8,"worker":"render-01:37105","at":"2026-09-14T01:31:05.553Z"}
{"job":"a-51497","asset":"media/lib/360479.jpg","units":9,"worker":"render-01:41003","at":"2026-09-14T01:31:08.050Z"}
{"job":"a-51496","asset":"media/lib/360472.jpg","units":4,"worker":"render-01:31513","at":"2026-09-14T01:31:09.996Z"}
{"job":"a-51498","asset":"media/lib/360486.jpg","units":8,"worker":"render-01:37914","at":"2026-09-14T01:31:14.419Z"}
{"job":"a-51498","asset":"media/lib/360486.jpg","units":8,"worker":"render-01:37105","at":"2026-09-14T01:31:14.424Z"}
{"job":"a-51499","asset":"media/lib/360493.jpg","units":9,"worker":"render-01:41003","at":"2026-09-14T01:31:14.811Z"}
{"job":"a-51501","asset":"media/lib/360507.jpg","units":6,"worker":"render-01:37914","at":"2026-09-14T01:31:18.322Z"}
{"job":"a-51503","asset":"media/lib/360521.jpg","units":5,"worker":"render-01:37914","at":"2026-09-14T01:31:25.033Z"}
{"job":"a-51504","asset":"media/lib/360528.jpg","units":8,"worker":"render-01:37105","at":"2026-09-14T01:31:25.432Z"}
{"job":"a-51500","asset":"media/lib/360500.jpg","units":5,"worker":"render-01:31513","at":"2026-09-14T01:31:26.671Z"}
{"job":"a-51507","asset":"media/lib/360549.jpg","units":5,"worker":"render-01:31513","at":"2026-09-14T01:31:28.689Z"}
{"job":"a-51505","asset":"media/lib/360535.jpg","units":7,"worker":"render-01:37914","at":"2026-09-14T01:31:28.835Z"}
{"job":"a-51502","asset":"media/lib/360514.jpg","units":6,"worker":"render-01:41003","at":"2026-09-14T01:31:32.344Z"}
{"job":"a-51506","asset":"media/lib/360542.jpg","units":6,"worker":"render-01:37105","at":"2026-09-14T01:31:41.460Z"}
{"job":"a-51510","asset":"media/lib/360570.jpg","units":8,"worker":"render-01:41003","at":"2026-09-14T01:31:42.183Z"}
{"job":"a-51509","asset":"media/lib/360563.jpg","units":8,"worker":"render-01:37914","at":"2026-09-14T01:31:44.942Z"}
{"job":"a-51508","asset":"media/lib/360556.jpg","units":9,"worker":"render-01:31513","at":"2026-09-14T01:31:45.904Z"}
{"job":"a-51512","asset":"media/lib/360584.jpg","units":5,"worker":"render-01:41003","at":"2026-09-14T01:31:49.977Z"}
{"job":"a-51514","asset":"media/lib/360598.jpg","units":9,"worker":"render-01:31513","at":"2026-09-14T01:31:54.869Z"}
{"job":"a-51511","asset":"media/lib/360577.jpg","units":9,"worker":"render-01:37105","at":"2026-09-14T01:31:57.590Z"}
{"job":"a-51513","asset":"media/lib/360591.jpg","units":7,"worker":"render-01:37914","at":"2026-09-14T01:31:57.999Z"}
{"job":"a-51515","asset":"media/lib/360605.jpg","units":5,"worker":"render-02:22768","at":"2026-09-15T01:30:06.865Z"}
{"job":"a-51515","asset":"media/lib/360605.jpg","units":5,"worker":"render-02:35194","at":"2026-09-15T01:30:06.868Z"}
{"job":"a-51516","asset":"media/lib/360612.jpg","units":9,"worker":"render-02:23460","at":"2026-09-15T01:30:07.087Z"}
{"job":"a-51519","asset":"media/lib/360633.jpg","units":6,"worker":"render-02:35194","at":"2026-09-15T01:30:15.511Z"}
{"job":"a-51517","asset":"media/lib/360619.jpg","units":5,"worker":"render-02:39679","at":"2026-09-15T01:30:15.528Z"}
{"job":"a-51517","asset":"media/lib/360619.jpg","units":5,"worker":"render-02:23460","at":"2026-09-15T01:30:15.530Z"}
{"job":"a-51518","asset":"media/lib/360626.jpg","units":4,"worker":"render-02:22768","at":"2026-09-15T01:30:23.353Z"}
{"job":"a-51522","asset":"media/lib/360654.jpg","units":4,"worker":"render-02:23460","at":"2026-09-15T01:30:23.702Z"}
{"job":"a-51523","asset":"media/lib/360661.jpg","units":9,"worker":"render-02:22768","at":"2026-09-15T01:30:27.272Z"}
{"job":"a-51524","asset":"media/lib/360668.jpg","units":6,"worker":"render-02:23460","at":"2026-09-15T01:30:28.791Z"}
{"job":"a-51521","asset":"media/lib/360647.jpg","units":9,"worker":"render-02:39679","at":"2026-09-15T01:30:28.861Z"}
{"job":"a-51520","asset":"media/lib/360640.jpg","units":8,"worker":"render-02:35194","at":"2026-09-15T01:30:32.352Z"}
{"job":"a-51525","asset":"media/lib/360675.jpg","units":6,"worker":"render-02:22768","at":"2026-09-15T01:30:36.087Z"}
{"job":"a-51528","asset":"media/lib/360696.jpg","units":5,"worker":"render-02:35194","at":"2026-09-15T01:30:36.701Z"}
{"job":"a-51530","asset":"media/lib/360710.jpg","units":5,"worker":"render-02:35194","at":"2026-09-15T01:30:39.266Z"}
{"job":"a-51526","asset":"media/lib/360682.jpg","units":4,"worker":"render-02:23460","at":"2026-09-15T01:30:42.451Z"}
{"job":"a-51531","asset":"media/lib/360717.jpg","units":7,"worker":"render-02:35194","at":"2026-09-15T01:30:43.445Z"}
{"job":"a-51529","asset":"media/lib/360703.jpg","units":7,"worker":"render-02:22768","at":"2026-09-15T01:30:43.456Z"}
{"job":"a-51527","asset":"media/lib/360689.jpg","units":8,"worker":"render-02:39679","at":"2026-09-15T01:30:45.476Z"}
{"job":"a-51534","asset":"media/lib/360738.jpg","units":4,"worker":"render-02:22768","at":"2026-09-15T01:30:50.548Z"}
{"job":"a-51532","asset":"media/lib/360724.jpg","units":6,"worker":"render-02:23460","at":"2026-09-15T01:30:54.014Z"}
{"job":"a-51533","asset":"media/lib/360731.jpg","units":8,"worker":"render-02:35194","at":"2026-09-15T01:30:55.400Z"}
{"job":"a-51535","asset":"media/lib/360745.jpg","units":6,"worker":"render-02:39679","at":"2026-09-15T01:30:55.780Z"}
{"job":"a-51536","asset":"media/lib/360752.jpg","units":7,"worker":"render-02:22768","at":"2026-09-15T01:31:03.765Z"}
{"job":"a-51538","asset":"media/lib/360766.jpg","units":5,"worker":"render-02:35194","at":"2026-09-15T01:31:05.110Z"}
{"job":"a-51537","asset":"media/lib/360759.jpg","units":7,"worker":"render-02:23460","at":"2026-09-15T01:31:06.178Z"}
{"job":"a-51541","asset":"media/lib/360787.jpg","units":9,"worker":"render-01:54044","at":"2026-09-16T01:30:11.879Z"}
{"job":"a-51542","asset":"media/lib/360794.jpg","units":6,"worker":"render-01:46428","at":"2026-09-16T01:30:14.109Z"}
{"job":"a-51540","asset":"media/lib/360780.jpg","units":6,"worker":"render-01:30368","at":"2026-09-16T01:30:15.872Z"}
{"job":"a-51543","asset":"media/lib/360801.jpg","units":9,"worker":"render-01:54044","at":"2026-09-16T01:30:17.797Z"}
{"job":"a-51539","asset":"media/lib/360773.jpg","units":8,"worker":"render-01:49122","at":"2026-09-16T01:30:20.099Z"}
{"job":"a-51544","asset":"media/lib/360808.jpg","units":7,"worker":"render-01:49122","at":"2026-09-16T01:30:22.865Z"}
{"job":"a-51544","asset":"media/lib/360808.jpg","units":7,"worker":"render-01:46428","at":"2026-09-16T01:30:22.868Z"}
{"job":"a-51546","asset":"media/lib/360822.jpg","units":4,"worker":"render-01:54044","at":"2026-09-16T01:30:26.853Z"}
{"job":"a-51545","asset":"media/lib/360815.jpg","units":6,"worker":"render-01:30368","at":"2026-09-16T01:30:28.545Z"}
{"job":"a-51547","asset":"media/lib/360829.jpg","units":4,"worker":"render-01:46428","at":"2026-09-16T01:30:31.734Z"}
{"job":"a-51548","asset":"media/lib/360836.jpg","units":9,"worker":"render-01:54044","at":"2026-09-16T01:30:36.978Z"}
{"job":"a-51551","asset":"media/lib/360857.jpg","units":6,"worker":"render-01:46428","at":"2026-09-16T01:30:37.317Z"}
{"job":"a-51549","asset":"media/lib/360843.jpg","units":6,"worker":"render-01:30368","at":"2026-09-16T01:30:37.554Z"}
{"job":"a-51550","asset":"media/lib/360850.jpg","units":6,"worker":"render-01:49122","at":"2026-09-16T01:30:45.802Z"}
{"job":"a-51552","asset":"media/lib/360864.jpg","units":5,"worker":"render-02:28367","at":"2026-09-17T01:30:09.499Z"}
{"job":"a-51552","asset":"media/lib/360864.jpg","units":5,"worker":"render-02:44445","at":"2026-09-17T01:30:09.501Z"}
{"job":"a-51554","asset":"media/lib/360878.jpg","units":4,"worker":"render-02:38573","at":"2026-09-17T01:30:12.251Z"}
{"job":"a-51557","asset":"media/lib/360899.jpg","units":9,"worker":"render-02:38573","at":"2026-09-17T01:30:18.624Z"}
{"job":"a-51553","asset":"media/lib/360871.jpg","units":6,"worker":"render-02:57400","at":"2026-09-17T01:30:20.156Z"}
{"job":"a-51555","asset":"media/lib/360885.jpg","units":4,"worker":"render-02:28367","at":"2026-09-17T01:30:22.104Z"}
{"job":"a-51556","asset":"media/lib/360892.jpg","units":9,"worker":"render-02:44445","at":"2026-09-17T01:30:24.660Z"}
{"job":"a-51559","asset":"media/lib/360913.jpg","units":4,"worker":"render-02:57400","at":"2026-09-17T01:30:25.040Z"}
{"job":"a-51558","asset":"media/lib/360906.jpg","units":5,"worker":"render-02:28367","at":"2026-09-17T01:30:28.087Z"}
{"job":"a-51558","asset":"media/lib/360906.jpg","units":5,"worker":"render-02:38573","at":"2026-09-17T01:30:28.090Z"}
{"job":"a-51560","asset":"media/lib/360920.jpg","units":5,"worker":"render-02:44445","at":"2026-09-17T01:30:29.884Z"}
{"job":"a-51562","asset":"media/lib/360934.jpg","units":9,"worker":"render-02:38573","at":"2026-09-17T01:30:33.749Z"}
{"job":"a-51563","asset":"media/lib/360941.jpg","units":5,"worker":"render-02:44445","at":"2026-09-17T01:30:35.119Z"}
{"job":"a-51564","asset":"media/lib/360948.jpg","units":7,"worker":"render-02:38573","at":"2026-09-17T01:30:39.319Z"}
{"job":"a-51561","asset":"media/lib/360927.jpg","units":9,"worker":"render-02:28367","at":"2026-09-17T01:30:41.079Z"}
{"job":"a-51561","asset":"media/lib/360927.jpg","units":9,"worker":"render-02:57400","at":"2026-09-17T01:30:41.080Z"}
{"job":"a-51566","asset":"media/lib/360962.jpg","units":4,"worker":"render-02:38573","at":"2026-09-17T01:30:44.151Z"}
{"job":"a-51565","asset":"media/lib/360955.jpg","units":6,"worker":"render-02:44445","at":"2026-09-17T01:30:44.682Z"}
{"job":"a-51568","asset":"media/lib/360976.jpg","units":5,"worker":"render-02:44445","at":"2026-09-17T01:30:49.520Z"}
{"job":"a-51568","asset":"media/lib/360976.jpg","units":5,"worker":"render-02:38573","at":"2026-09-17T01:30:49.526Z"}
{"job":"a-51570","asset":"media/lib/360990.jpg","units":8,"worker":"render-02:38573","at":"2026-09-17T01:30:52.675Z"}
{"job":"a-51567","asset":"media/lib/360969.jpg","units":4,"worker":"render-02:57400","at":"2026-09-17T01:30:53.201Z"}
{"job":"a-51569","asset":"media/lib/360983.jpg","units":9,"worker":"render-02:28367","at":"2026-09-17T01:30:55.559Z"}
{"job":"a-51572","asset":"media/lib/361004.jpg","units":5,"worker":"render-02:38573","at":"2026-09-17T01:31:01.525Z"}
{"job":"a-51571","asset":"media/lib/360997.jpg","units":7,"worker":"render-02:44445","at":"2026-09-17T01:31:02.262Z"}
{"job":"a-51573","asset":"media/lib/361011.jpg","units":6,"worker":"render-02:57400","at":"2026-09-17T01:31:10.631Z"}
{"job":"a-51574","asset":"media/lib/361018.jpg","units":6,"worker":"render-02:28367","at":"2026-09-17T01:31:12.758Z"}
{"job":"a-51576","asset":"media/lib/361032.jpg","units":6,"worker":"render-02:44445","at":"2026-09-17T01:31:17.600Z"}
{"job":"a-51575","asset":"media/lib/361025.jpg","units":8,"worker":"render-02:38573","at":"2026-09-17T01:31:18.825Z"}
{"job":"a-51577","asset":"media/lib/361039.jpg","units":7,"worker":"render-01:45618","at":"2026-09-18T01:30:10.461Z"}
{"job":"a-51578","asset":"media/lib/361046.jpg","units":7,"worker":"render-01:53384","at":"2026-09-18T01:30:17.413Z"}
{"job":"a-51580","asset":"media/lib/361060.jpg","units":6,"worker":"render-01:44250","at":"2026-09-18T01:30:17.519Z"}
{"job":"a-51579","asset":"media/lib/361053.jpg","units":8,"worker":"render-01:30308","at":"2026-09-18T01:30:17.987Z"}
{"job":"a-51581","asset":"media/lib/361067.jpg","units":8,"worker":"render-01:45618","at":"2026-09-18T01:30:19.395Z"}
{"job":"a-51583","asset":"media/lib/361081.jpg","units":4,"worker":"render-01:44250","at":"2026-09-18T01:30:22.406Z"}
{"job":"a-51585","asset":"media/lib/361095.jpg","units":7,"worker":"render-01:45618","at":"2026-09-18T01:30:29.519Z"}
{"job":"a-51585","asset":"media/lib/361095.jpg","units":7,"worker":"render-01:44250","at":"2026-09-18T01:30:29.521Z"}
{"job":"a-51584","asset":"media/lib/361088.jpg","units":6,"worker":"render-01:30308","at":"2026-09-18T01:30:29.595Z"}
{"job":"a-51582","asset":"media/lib/361074.jpg","units":5,"worker":"render-01:53384","at":"2026-09-18T01:30:33.350Z"}
{"job":"a-51588","asset":"media/lib/361116.jpg","units":5,"worker":"render-01:44250","at":"2026-09-18T01:30:43.162Z"}
{"job":"a-51589","asset":"media/lib/361123.jpg","units":8,"worker":"render-01:53384","at":"2026-09-18T01:30:43.804Z"}
{"job":"a-51586","asset":"media/lib/361102.jpg","units":8,"worker":"render-01:45618","at":"2026-09-18T01:30:44.823Z"}
{"job":"a-51587","asset":"media/lib/361109.jpg","units":9,"worker":"render-01:45618","at":"2026-09-18T01:30:47.577Z"}
{"job":"a-51587","asset":"media/lib/361109.jpg","units":9,"worker":"render-01:30308","at":"2026-09-18T01:30:47.579Z"}
{"job":"a-51590","asset":"media/lib/361130.jpg","units":8,"worker":"render-01:44250","at":"2026-09-18T01:30:47.991Z"}
{"job":"a-51591","asset":"media/lib/361137.jpg","units":7,"worker":"render-01:53384","at":"2026-09-18T01:30:51.372Z"}
{"job":"a-51592","asset":"media/lib/361144.jpg","units":5,"worker":"render-01:30308","at":"2026-09-18T01:30:53.190Z"}
{"job":"a-51594","asset":"media/lib/361158.jpg","units":6,"worker":"render-01:53384","at":"2026-09-18T01:30:54.637Z"}
{"job":"a-51593","asset":"media/lib/361151.jpg","units":6,"worker":"render-01:44250","at":"2026-09-18T01:31:02.562Z"}
{"job":"a-51596","asset":"media/lib/361172.jpg","units":9,"worker":"render-01:53384","at":"2026-09-18T01:31:03.845Z"}
{"job":"a-51595","asset":"media/lib/361165.jpg","units":5,"worker":"render-01:30308","at":"2026-09-18T01:31:04.167Z"}
{"job":"a-51597","asset":"media/lib/361179.jpg","units":5,"worker":"render-01:53384","at":"2026-09-18T01:31:18.218Z"}
{"job":"a-51597","asset":"media/lib/361179.jpg","units":5,"worker":"render-01:44250","at":"2026-09-18T01:31:18.220Z"}
{"job":"a-51598","asset":"media/lib/361186.jpg","units":5,"worker":"render-01:45618","at":"2026-09-18T01:31:18.902Z"}
{"job":"a-51599","asset":"media/lib/361193.jpg","units":9,"worker":"render-01:30308","at":"2026-09-18T01:31:20.223Z"}
{"job":"a-51601","asset":"media/lib/361207.jpg","units":5,"worker":"render-01:45618","at":"2026-09-18T01:31:24.267Z"}
{"job":"a-51602","asset":"media/lib/361214.jpg","units":8,"worker":"render-01:30308","at":"2026-09-18T01:31:25.024Z"}
{"job":"a-51602","asset":"media/lib/361214.jpg","units":8,"worker":"render-01:53384","at":"2026-09-18T01:31:25.029Z"}
{"job":"a-51600","asset":"media/lib/361200.jpg","units":6,"worker":"render-01:44250","at":"2026-09-18T01:31:33.391Z"}
{"job":"a-51600","asset":"media/lib/361200.jpg","units":6,"worker":"render-01:30308","at":"2026-09-18T01:31:33.396Z"}
{"job":"a-51604","asset":"media/lib/361228.jpg","units":7,"worker":"render-01:53384","at":"2026-09-18T01:31:35.649Z"}
{"job":"a-51603","asset":"media/lib/361221.jpg","units":7,"worker":"render-01:45618","at":"2026-09-18T01:31:37.349Z"}
{"job":"a-51607","asset":"media/lib/361249.jpg","units":6,"worker":"render-01:45618","at":"2026-09-18T01:31:42.723Z"}
{"job":"a-51606","asset":"media/lib/361242.jpg","units":7,"worker":"render-01:53384","at":"2026-09-18T01:31:43.913Z"}
{"job":"a-51605","asset":"media/lib/361235.jpg","units":8,"worker":"render-01:44250","at":"2026-09-18T01:31:45.763Z"}
{"job":"a-51609","asset":"media/lib/361263.jpg","units":6,"worker":"render-01:45618","at":"2026-09-18T01:31:48.816Z"}
{"job":"a-51610","asset":"media/lib/361270.jpg","units":7,"worker":"render-01:53384","at":"2026-09-18T01:31:54.200Z"}
{"job":"a-51608","asset":"media/lib/361256.jpg","units":5,"worker":"render-01:30308","at":"2026-09-18T01:31:54.423Z"}
{"job":"a-51612","asset":"media/lib/361284.jpg","units":9,"worker":"render-01:37635","at":"2026-09-20T01:30:04.910Z"}
{"job":"a-51614","asset":"media/lib/361298.jpg","units":9,"worker":"render-01:46156","at":"2026-09-20T01:30:06.817Z"}
{"job":"a-51616","asset":"media/lib/361312.jpg","units":6,"worker":"render-01:46156","at":"2026-09-20T01:30:09.594Z"}
{"job":"a-51611","asset":"media/lib/361277.jpg","units":8,"worker":"render-01:47372","at":"2026-09-20T01:30:16.466Z"}
{"job":"a-51615","asset":"media/lib/361305.jpg","units":4,"worker":"render-01:37635","at":"2026-09-20T01:30:17.013Z"}
{"job":"a-51613","asset":"media/lib/361291.jpg","units":9,"worker":"render-01:57383","at":"2026-09-20T01:30:19.496Z"}
{"job":"a-51619","asset":"media/lib/361333.jpg","units":7,"worker":"render-01:37635","at":"2026-09-20T01:30:20.107Z"}
{"job":"a-51618","asset":"media/lib/361326.jpg","units":8,"worker":"render-01:47372","at":"2026-09-20T01:30:20.402Z"}
{"job":"a-51622","asset":"media/lib/361354.jpg","units":5,"worker":"render-01:47372","at":"2026-09-20T01:30:23.281Z"}
{"job":"a-51617","asset":"media/lib/361319.jpg","units":6,"worker":"render-01:46156","at":"2026-09-20T01:30:24.507Z"}
{"job":"a-51620","asset":"media/lib/361340.jpg","units":8,"worker":"render-01:57383","at":"2026-09-20T01:30:30.809Z"}
{"job":"a-51624","asset":"media/lib/361368.jpg","units":6,"worker":"render-01:46156","at":"2026-09-20T01:30:31.279Z"}
{"job":"a-51621","asset":"media/lib/361347.jpg","units":7,"worker":"render-01:37635","at":"2026-09-20T01:30:33.009Z"}
{"job":"a-51623","asset":"media/lib/361361.jpg","units":4,"worker":"render-01:47372","at":"2026-09-20T01:30:38.925Z"}
{"job":"a-51626","asset":"media/lib/361382.jpg","units":9,"worker":"render-01:46156","at":"2026-09-20T01:30:40.039Z"}
{"job":"a-51627","asset":"media/lib/361389.jpg","units":4,"worker":"render-01:37635","at":"2026-09-20T01:30:40.261Z"}
{"job":"a-51625","asset":"media/lib/361375.jpg","units":8,"worker":"render-01:57383","at":"2026-09-20T01:30:40.463Z"}
{"job":"a-51631","asset":"media/lib/361417.jpg","units":6,"worker":"render-01:57383","at":"2026-09-20T01:30:47.741Z"}
{"job":"a-51628","asset":"media/lib/361396.jpg","units":7,"worker":"render-01:47372","at":"2026-09-20T01:30:49.637Z"}
{"job":"a-51629","asset":"media/lib/361403.jpg","units":7,"worker":"render-01:46156","at":"2026-09-20T01:30:52.762Z"}
{"job":"a-51632","asset":"media/lib/361424.jpg","units":8,"worker":"render-01:57383","at":"2026-09-20T01:30:54.043Z"}
{"job":"a-51633","asset":"media/lib/361431.jpg","units":8,"worker":"render-01:47372","at":"2026-09-20T01:30:54.661Z"}
{"job":"a-51630","asset":"media/lib/361410.jpg","units":5,"worker":"render-01:37635","at":"2026-09-20T01:30:56.328Z"}
{"job":"a-51634","asset":"media/lib/361438.jpg","units":6,"worker":"render-01:46156","at":"2026-09-20T01:30:57.161Z"}
{"job":"a-51635","asset":"media/lib/361445.jpg","units":4,"worker":"render-01:57383","at":"2026-09-20T01:30:57.982Z"}
{"job":"a-51637","asset":"media/lib/361459.jpg","units":4,"worker":"render-01:37635","at":"2026-09-20T01:31:04.158Z"}
{"job":"a-51639","asset":"media/lib/361473.jpg","units":8,"worker":"render-01:37635","at":"2026-09-20T01:31:05.293Z"}
{"job":"a-51639","asset":"media/lib/361473.jpg","units":8,"worker":"render-01:57383","at":"2026-09-20T01:31:05.295Z"}
{"job":"a-51636","asset":"media/lib/361452.jpg","units":9,"worker":"render-01:47372","at":"2026-09-20T01:31:11.979Z"}
{"job":"a-51641","asset":"media/lib/361487.jpg","units":8,"worker":"render-01:37635","at":"2026-09-20T01:31:13.780Z"}
{"job":"a-51638","asset":"media/lib/361466.jpg","units":4,"worker":"render-01:46156","at":"2026-09-20T01:31:14.622Z"}
{"job":"a-51640","asset":"media/lib/361480.jpg","units":9,"worker":"render-01:57383","at":"2026-09-20T01:31:15.258Z"}
{"job":"a-51642","asset":"media/lib/361494.jpg","units":8,"worker":"render-01:47372","at":"2026-09-20T01:31:15.557Z"}
{"job":"a-51645","asset":"media/lib/361515.jpg","units":4,"worker":"render-01:57383","at":"2026-09-20T01:31:17.787Z"}
{"job":"a-51644","asset":"media/lib/361508.jpg","units":4,"worker":"render-01:46156","at":"2026-09-20T01:31:21.044Z"}
{"job":"a-51646","asset":"media/lib/361522.jpg","units":5,"worker":"render-01:47372","at":"2026-09-20T01:31:22.531Z"}
{"job":"a-51643","asset":"media/lib/361501.jpg","units":5,"worker":"render-01:37635","at":"2026-09-20T01:31:29.524Z"}
{"job":"a-51647","asset":"media/lib/361529.jpg","units":5,"worker":"render-01:57383","at":"2026-09-20T01:31:31.687Z"}
{"job":"a-51648","asset":"media/lib/361536.jpg","units":7,"worker":"render-01:46156","at":"2026-09-20T01:31:31.893Z"}
{"job":"a-51649","asset":"media/lib/361543.jpg","units":9,"worker":"render-01:47372","at":"2026-09-20T01:31:33.108Z"}
{"job":"a-51650","asset":"media/lib/361550.jpg","units":4,"worker":"render-01:47372","at":"2026-09-20T01:31:38.820Z"}
{"job":"a-51650","asset":"media/lib/361550.jpg","units":4,"worker":"render-01:37635","at":"2026-09-20T01:31:38.824Z"}
{"job":"a-51651","asset":"media/lib/361557.jpg","units":7,"worker":"render-02:36285","at":"2026-09-21T01:30:13.405Z"}
{"job":"a-51654","asset":"media/lib/361578.jpg","units":7,"worker":"render-02:51246","at":"2026-09-21T01:30:14.586Z"}
{"job":"a-51652","asset":"media/lib/361564.jpg","units":4,"worker":"render-02:52288","at":"2026-09-21T01:30:17.369Z"}
{"job":"a-51653","asset":"media/lib/361571.jpg","units":9,"worker":"render-02:40381","at":"2026-09-21T01:30:19.151Z"}
{"job":"a-51656","asset":"media/lib/361592.jpg","units":6,"worker":"render-02:51246","at":"2026-09-21T01:30:22.277Z"}
{"job":"a-51655","asset":"media/lib/361585.jpg","units":8,"worker":"render-02:36285","at":"2026-09-21T01:30:24.374Z"}
{"job":"a-51658","asset":"media/lib/361606.jpg","units":7,"worker":"render-02:40381","at":"2026-09-21T01:30:24.585Z"}
{"job":"a-51660","asset":"media/lib/361620.jpg","units":9,"worker":"render-02:36285","at":"2026-09-21T01:30:26.802Z"}
{"job":"a-51662","asset":"media/lib/361634.jpg","units":8,"worker":"render-02:36285","at":"2026-09-21T01:30:30.304Z"}
{"job":"a-51661","asset":"media/lib/361627.jpg","units":7,"worker":"render-02:40381","at":"2026-09-21T01:30:31.235Z"}
{"job":"a-51657","asset":"media/lib/361599.jpg","units":8,"worker":"render-02:52288","at":"2026-09-21T01:30:33.826Z"}
{"job":"a-51664","asset":"media/lib/361648.jpg","units":4,"worker":"render-02:40381","at":"2026-09-21T01:30:35.959Z"}
{"job":"a-51659","asset":"media/lib/361613.jpg","units":5,"worker":"render-02:51246","at":"2026-09-21T01:30:36.078Z"}
{"job":"a-51663","asset":"media/lib/361641.jpg","units":7,"worker":"render-02:36285","at":"2026-09-21T01:30:37.663Z"}
{"job":"a-51667","asset":"media/lib/361669.jpg","units":7,"worker":"render-02:51246","at":"2026-09-21T01:30:38.943Z"}
{"job":"a-51669","asset":"media/lib/361683.jpg","units":5,"worker":"render-02:51246","at":"2026-09-21T01:30:41.105Z"}
{"job":"a-51665","asset":"media/lib/361655.jpg","units":5,"worker":"render-02:52288","at":"2026-09-21T01:30:44.745Z"}
{"job":"a-51666","asset":"media/lib/361662.jpg","units":7,"worker":"render-02:40381","at":"2026-09-21T01:30:48.202Z"}
{"job":"a-51668","asset":"media/lib/361676.jpg","units":6,"worker":"render-02:36285","at":"2026-09-21T01:30:53.796Z"}
{"job":"a-51670","asset":"media/lib/361690.jpg","units":6,"worker":"render-02:51246","at":"2026-09-21T01:30:56.340Z"}
{"job":"a-51671","asset":"media/lib/361697.jpg","units":5,"worker":"render-02:52288","at":"2026-09-21T01:30:57.734Z"}
{"job":"a-51672","asset":"media/lib/361704.jpg","units":5,"worker":"render-02:40381","at":"2026-09-21T01:31:01.207Z"}
{"job":"a-51673","asset":"media/lib/361711.jpg","units":8,"worker":"render-02:36285","at":"2026-09-21T01:31:02.383Z"}
{"job":"a-51676","asset":"media/lib/361732.jpg","units":9,"worker":"render-02:40381","at":"2026-09-21T01:31:06.694Z"}
{"job":"a-51678","asset":"media/lib/361746.jpg","units":9,"worker":"render-02:40381","at":"2026-09-21T01:31:09.458Z"}
{"job":"a-51674","asset":"media/lib/361718.jpg","units":6,"worker":"render-02:51246","at":"2026-09-21T01:31:12.692Z"}
{"job":"a-51675","asset":"media/lib/361725.jpg","units":5,"worker":"render-02:52288","at":"2026-09-21T01:31:14.082Z"}
{"job":"a-51677","asset":"media/lib/361739.jpg","units":6,"worker":"render-02:36285","at":"2026-09-21T01:31:15.394Z"}
{"job":"a-51679","asset":"media/lib/361753.jpg","units":5,"worker":"render-02:40381","at":"2026-09-21T01:31:24.463Z"}
{"job":"a-51680","asset":"media/lib/361760.jpg","units":4,"worker":"render-02:35111","at":"2026-09-23T01:30:06.693Z"}
{"job":"a-51684","asset":"media/lib/361788.jpg","units":7,"worker":"render-02:35111","at":"2026-09-23T01:30:13.334Z"}
{"job":"a-51683","asset":"media/lib/361781.jpg","units":9,"worker":"render-02:44489","at":"2026-09-23T01:30:13.371Z"}
{"job":"a-51682","asset":"media/lib/361774.jpg","units":4,"worker":"render-02:41084","at":"2026-09-23T01:30:16.230Z"}
{"job":"a-51681","asset":"media/lib/361767.jpg","units":6,"worker":"render-02:27033","at":"2026-09-23T01:30:17.265Z"}
{"job":"a-51686","asset":"media/lib/361802.jpg","units":7,"worker":"render-02:44489","at":"2026-09-23T01:30:25.720Z"}
{"job":"a-51689","asset":"media/lib/361823.jpg","units":5,"worker":"render-02:44489","at":"2026-09-23T01:30:30.327Z"}
{"job":"a-51685","asset":"media/lib/361795.jpg","units":4,"worker":"render-02:35111","at":"2026-09-23T01:30:30.638Z"}
{"job":"a-51688","asset":"media/lib/361816.jpg","units":9,"worker":"render-02:27033","at":"2026-09-23T01:30:31.197Z"}
{"job":"a-51687","asset":"media/lib/361809.jpg","units":7,"worker":"render-02:41084","at":"2026-09-23T01:30:31.857Z"}
{"job":"a-51691","asset":"media/lib/361837.jpg","units":9,"worker":"render-02:35111","at":"2026-09-23T01:30:34.771Z"}
{"job":"a-51690","asset":"media/lib/361830.jpg","units":9,"worker":"render-02:44489","at":"2026-09-23T01:30:43.682Z"}
{"job":"a-51695","asset":"media/lib/361865.jpg","units":5,"worker":"render-01:45535","at":"2026-09-24T01:30:10.058Z"}
{"job":"a-51692","asset":"media/lib/361844.jpg","units":9,"worker":"render-01:35424","at":"2026-09-24T01:30:12.936Z"}
{"job":"a-51694","asset":"media/lib/361858.jpg","units":8,"worker":"render-01:34236","at":"2026-09-24T01:30:13.864Z"}
{"job":"a-51693","asset":"media/lib/361851.jpg","units":8,"worker":"render-01:34885","at":"2026-09-24T01:30:17.913Z"}
{"job":"a-51696","asset":"media/lib/361872.jpg","units":9,"worker":"render-01:45535","at":"2026-09-24T01:30:19.916Z"}
{"job":"a-51697","asset":"media/lib/361879.jpg","units":8,"worker":"render-01:35424","at":"2026-09-24T01:30:30.481Z"}
{"job":"a-51698","asset":"media/lib/361886.jpg","units":7,"worker":"render-01:34236","at":"2026-09-24T01:30:31.434Z"}
{"job":"a-51699","asset":"media/lib/361893.jpg","units":8,"worker":"render-01:34885","at":"2026-09-24T01:30:34.658Z"}
{"job":"a-51700","asset":"media/lib/361900.jpg","units":9,"worker":"render-01:45535","at":"2026-09-24T01:30:35.481Z"}
{"job":"a-51702","asset":"media/lib/361914.jpg","units":8,"worker":"render-01:34236","at":"2026-09-24T01:30:37.168Z"}
{"job":"a-51703","asset":"media/lib/361921.jpg","units":7,"worker":"render-01:34885","at":"2026-09-24T01:30:39.889Z"}
{"job":"a-51701","asset":"media/lib/361907.jpg","units":8,"worker":"render-01:35424","at":"2026-09-24T01:30:40.642Z"}
{"job":"a-51705","asset":"media/lib/361935.jpg","units":4,"worker":"render-01:34236","at":"2026-09-24T01:30:46.328Z"}
{"job":"a-51706","asset":"media/lib/361942.jpg","units":6,"worker":"render-01:34885","at":"2026-09-24T01:30:46.408Z"}
{"job":"a-51704","asset":"media/lib/361928.jpg","units":4,"worker":"render-01:45535","at":"2026-09-24T01:30:48.477Z"}
{"job":"a-51709","asset":"media/lib/361963.jpg","units":5,"worker":"render-01:34885","at":"2026-09-24T01:30:49.101Z"}
{"job":"a-51707","asset":"media/lib/361949.jpg","units":9,"worker":"render-01:35424","at":"2026-09-24T01:30:50.279Z"}
{"job":"a-51711","asset":"media/lib/361977.jpg","units":7,"worker":"render-01:34885","at":"2026-09-24T01:30:51.811Z"}
{"job":"a-51712","asset":"media/lib/361984.jpg","units":5,"worker":"render-01:35424","at":"2026-09-24T01:30:55.955Z"}
{"job":"a-51713","asset":"media/lib/361991.jpg","units":7,"worker":"render-01:34885","at":"2026-09-24T01:30:57.380Z"}
{"job":"a-51708","asset":"media/lib/361956.jpg","units":6,"worker":"render-01:34236","at":"2026-09-24T01:30:58.269Z"}
{"job":"a-51710","asset":"media/lib/361970.jpg","units":8,"worker":"render-01:45535","at":"2026-09-24T01:31:03.061Z"}
{"job":"a-51714","asset":"media/lib/361998.jpg","units":5,"worker":"render-01:35424","at":"2026-09-24T01:31:07.524Z"}
{"job":"a-51717","asset":"media/lib/362019.jpg","units":4,"worker":"render-02:58814","at":"2026-09-25T01:30:05.096Z"}
{"job":"a-51718","asset":"media/lib/362026.jpg","units":4,"worker":"render-02:41858","at":"2026-09-25T01:30:07.913Z"}
{"job":"a-51716","asset":"media/lib/362012.jpg","units":6,"worker":"render-02:28759","at":"2026-09-25T01:30:10.598Z"}
{"job":"a-51715","asset":"media/lib/362005.jpg","units":9,"worker":"render-02:44835","at":"2026-09-25T01:30:11.136Z"}
{"job":"a-51720","asset":"media/lib/362040.jpg","units":7,"worker":"render-02:41858","at":"2026-09-25T01:30:12.024Z"}
{"job":"a-51722","asset":"media/lib/362054.jpg","units":8,"worker":"render-02:44835","at":"2026-09-25T01:30:18.896Z"}
{"job":"a-51723","asset":"media/lib/362061.jpg","units":9,"worker":"render-02:41858","at":"2026-09-25T01:30:20.520Z"}
{"job":"a-51719","asset":"media/lib/362033.jpg","units":5,"worker":"render-02:58814","at":"2026-09-25T01:30:22.186Z"}
{"job":"a-51724","asset":"media/lib/362068.jpg","units":6,"worker":"render-02:44835","at":"2026-09-25T01:30:24.524Z"}
{"job":"a-51721","asset":"media/lib/362047.jpg","units":4,"worker":"render-02:28759","at":"2026-09-25T01:30:28.473Z"}
{"job":"a-51725","asset":"media/lib/362075.jpg","units":6,"worker":"render-02:41858","at":"2026-09-25T01:30:30.172Z"}
{"job":"a-51728","asset":"media/lib/362096.jpg","units":6,"worker":"render-02:28759","at":"2026-09-25T01:30:33.473Z"}
{"job":"a-51728","asset":"media/lib/362096.jpg","units":6,"worker":"render-02:41858","at":"2026-09-25T01:30:33.478Z"}
{"job":"a-51726","asset":"media/lib/362082.jpg","units":4,"worker":"render-02:58814","at":"2026-09-25T01:30:39.763Z"}
{"job":"a-51727","asset":"media/lib/362089.jpg","units":6,"worker":"render-02:44835","at":"2026-09-25T01:30:41.171Z"}
{"job":"a-51730","asset":"media/lib/362110.jpg","units":7,"worker":"render-02:41858","at":"2026-09-25T01:30:43.688Z"}
{"job":"a-51729","asset":"media/lib/362103.jpg","units":7,"worker":"render-02:28759","at":"2026-09-25T01:30:47.205Z"}
{"job":"a-51732","asset":"media/lib/362124.jpg","units":5,"worker":"render-02:44835","at":"2026-09-25T01:30:52.035Z"}
{"job":"a-51734","asset":"media/lib/362138.jpg","units":8,"worker":"render-02:28759","at":"2026-09-25T01:30:52.236Z"}
{"job":"a-51731","asset":"media/lib/362117.jpg","units":8,"worker":"render-02:58814","at":"2026-09-25T01:30:54.683Z"}
{"job":"a-51733","asset":"media/lib/362131.jpg","units":6,"worker":"render-02:41858","at":"2026-09-25T01:30:55.063Z"}
{"job":"a-51735","asset":"media/lib/362145.jpg","units":4,"worker":"render-02:44835","at":"2026-09-25T01:31:04.466Z"}
{"job":"a-51736","asset":"media/lib/362152.jpg","units":5,"worker":"render-01:53651","at":"2026-09-26T01:30:11.444Z"}
{"job":"a-51739","asset":"media/lib/362173.jpg","units":4,"worker":"render-01:53651","at":"2026-09-26T01:30:14.397Z"}
{"job":"a-51738","asset":"media/lib/362166.jpg","units":4,"worker":"render-01:44916","at":"2026-09-26T01:30:18.319Z"}
{"job":"a-51738","asset":"media/lib/362166.jpg","units":4,"worker":"render-01:49889","at":"2026-09-26T01:30:18.324Z"}
{"job":"a-51737","asset":"media/lib/362159.jpg","units":7,"worker":"render-01:40806","at":"2026-09-26T01:30:20.684Z"}
{"job":"a-51742","asset":"media/lib/362194.jpg","units":8,"worker":"render-01:49889","at":"2026-09-26T01:30:21.913Z"}
{"job":"a-51741","asset":"media/lib/362187.jpg","units":5,"worker":"render-01:53651","at":"2026-09-26T01:30:24.692Z"}
{"job":"a-51741","asset":"media/lib/362187.jpg","units":5,"worker":"render-01:44916","at":"2026-09-26T01:30:24.697Z"}
{"job":"a-51740","asset":"media/lib/362180.jpg","units":7,"worker":"render-01:53651","at":"2026-09-26T01:30:27.374Z"}
{"job":"a-51743","asset":"media/lib/362201.jpg","units":4,"worker":"render-01:40806","at":"2026-09-26T01:30:35.676Z"}
{"job":"a-51746","asset":"media/lib/362222.jpg","units":6,"worker":"render-01:53651","at":"2026-09-26T01:30:36.512Z"}
{"job":"a-51746","asset":"media/lib/362222.jpg","units":6,"worker":"render-01:40806","at":"2026-09-26T01:30:36.516Z"}
{"job":"a-51744","asset":"media/lib/362208.jpg","units":8,"worker":"render-01:49889","at":"2026-09-26T01:30:36.593Z"}
{"job":"a-51745","asset":"media/lib/362215.jpg","units":7,"worker":"render-01:44916","at":"2026-09-26T01:30:39.854Z"}
{"job":"a-51747","asset":"media/lib/362229.jpg","units":9,"worker":"render-01:53651","at":"2026-09-26T01:30:42.827Z"}
{"job":"a-51748","asset":"media/lib/362236.jpg","units":9,"worker":"render-01:49889","at":"2026-09-26T01:30:43.233Z"}
{"job":"a-51750","asset":"media/lib/362250.jpg","units":6,"worker":"render-01:44916","at":"2026-09-26T01:30:49.332Z"}
{"job":"a-51751","asset":"media/lib/362257.jpg","units":6,"worker":"render-01:53651","at":"2026-09-26T01:30:52.019Z"}
{"job":"a-51749","asset":"media/lib/362243.jpg","units":7,"worker":"render-01:40806","at":"2026-09-26T01:30:52.554Z"}
{"job":"a-51752","asset":"media/lib/362264.jpg","units":8,"worker":"render-01:49889","at":"2026-09-26T01:30:59.150Z"}
{"job":"a-51754","asset":"media/lib/362278.jpg","units":5,"worker":"render-01:53651","at":"2026-09-26T01:31:01.629Z"}
{"job":"a-51755","asset":"media/lib/362285.jpg","units":7,"worker":"render-01:40806","at":"2026-09-26T01:31:03.579Z"}
{"job":"a-51753","asset":"media/lib/362271.jpg","units":8,"worker":"render-01:44916","at":"2026-09-26T01:31:05.146Z"}
{"job":"a-51756","asset":"media/lib/362292.jpg","units":7,"worker":"render-01:49889","at":"2026-09-26T01:31:05.461Z"}
{"job":"a-51760","asset":"media/lib/362320.jpg","units":8,"worker":"render-01:49889","at":"2026-09-26T01:31:08.672Z"}
{"job":"a-51757","asset":"media/lib/362299.jpg","units":8,"worker":"render-01:53651","at":"2026-09-26T01:31:10.278Z"}
{"job":"a-51759","asset":"media/lib/362313.jpg","units":5,"worker":"render-01:44916","at":"2026-09-26T01:31:11.396Z"}
{"job":"a-51761","asset":"media/lib/362327.jpg","units":7,"worker":"render-01:49889","at":"2026-09-26T01:31:11.777Z"}
{"job":"a-51764","asset":"media/lib/362348.jpg","units":6,"worker":"render-01:49889","at":"2026-09-26T01:31:17.258Z"}
{"job":"a-51763","asset":"media/lib/362341.jpg","units":4,"worker":"render-01:44916","at":"2026-09-26T01:31:20.562Z"}
{"job":"a-51758","asset":"media/lib/362306.jpg","units":6,"worker":"render-01:40806","at":"2026-09-26T01:31:20.734Z"}
{"job":"a-51762","asset":"media/lib/362334.jpg","units":8,"worker":"render-01:53651","at":"2026-09-26T01:31:22.819Z"}
{"job":"a-51767","asset":"media/lib/362369.jpg","units":9,"worker":"render-01:40806","at":"2026-09-26T01:31:25.661Z"}
{"job":"a-51766","asset":"media/lib/362362.jpg","units":5,"worker":"render-01:44916","at":"2026-09-26T01:31:25.863Z"}
{"job":"a-51765","asset":"media/lib/362355.jpg","units":6,"worker":"render-01:49889","at":"2026-09-26T01:31:30.292Z"}
{"job":"a-51768","asset":"media/lib/362376.jpg","units":7,"worker":"render-01:53651","at":"2026-09-26T01:31:39.896Z"}
{"job":"a-51769","asset":"media/lib/362383.jpg","units":7,"worker":"render-01:36025","at":"2026-09-28T01:30:15.323Z"}
{"job":"a-51770","asset":"media/lib/362390.jpg","units":9,"worker":"render-01:43353","at":"2026-09-28T01:30:16.360Z"}
{"job":"a-51773","asset":"media/lib/362411.jpg","units":8,"worker":"render-01:36025","at":"2026-09-28T01:30:19.230Z"}
{"job":"a-51772","asset":"media/lib/362404.jpg","units":8,"worker":"render-01:57701","at":"2026-09-28T01:30:19.848Z"}
{"job":"a-51774","asset":"media/lib/362418.jpg","units":6,"worker":"render-01:43353","at":"2026-09-28T01:30:20.271Z"}
{"job":"a-51771","asset":"media/lib/362397.jpg","units":8,"worker":"render-01:37586","at":"2026-09-28T01:30:20.686Z"}
{"job":"a-51776","asset":"media/lib/362432.jpg","units":7,"worker":"render-01:57701","at":"2026-09-28T01:30:34.666Z"}
{"job":"a-51775","asset":"media/lib/362425.jpg","units":5,"worker":"render-01:36025","at":"2026-09-28T01:30:34.792Z"}
{"job":"a-51777","asset":"media/lib/362439.jpg","units":5,"worker":"render-01:43353","at":"2026-09-28T01:30:35.006Z"}
{"job":"a-51779","asset":"media/lib/362453.jpg","units":9,"worker":"render-01:57701","at":"2026-09-28T01:30:36.749Z"}
{"job":"a-51778","asset":"media/lib/362446.jpg","units":7,"worker":"render-01:37586","at":"2026-09-28T01:30:37.312Z"}
{"job":"a-51783","asset":"media/lib/362481.jpg","units":7,"worker":"render-01:37586","at":"2026-09-28T01:30:46.036Z"}
{"job":"a-51780","asset":"media/lib/362460.jpg","units":7,"worker":"render-01:36025","at":"2026-09-28T01:30:50.642Z"}
{"job":"a-51781","asset":"media/lib/362467.jpg","units":9,"worker":"render-01:43353","at":"2026-09-28T01:30:50.900Z"}
{"job":"a-51782","asset":"media/lib/362474.jpg","units":4,"worker":"render-01:57701","at":"2026-09-28T01:30:52.287Z"}
{"job":"a-51785","asset":"media/lib/362495.jpg","units":8,"worker":"render-01:36025","at":"2026-09-28T01:30:57.677Z"}
{"job":"a-51784","asset":"media/lib/362488.jpg","units":5,"worker":"render-01:37586","at":"2026-09-28T01:31:01.134Z"}
{"job":"a-51786","asset":"media/lib/362502.jpg","units":5,"worker":"render-01:43353","at":"2026-09-28T01:31:03.309Z"}
{"job":"a-51789","asset":"media/lib/362523.jpg","units":7,"worker":"render-01:37586","at":"2026-09-28T01:31:03.406Z"}
{"job":"a-51787","asset":"media/lib/362509.jpg","units":9,"worker":"render-01:57701","at":"2026-09-28T01:31:08.780Z"}
{"job":"a-51788","asset":"media/lib/362516.jpg","units":8,"worker":"render-01:36025","at":"2026-09-28T01:31:14.141Z"}
{"job":"a-51790","asset":"media/lib/362530.jpg","units":8,"worker":"render-01:43353","at":"2026-09-28T01:31:20.919Z"}
{"job":"a-51790","asset":"media/lib/362530.jpg","units":8,"worker":"render-01:37586","at":"2026-09-28T01:31:20.919Z"}
{"job":"a-51791","asset":"media/lib/362537.jpg","units":5,"worker":"render-01:57701","at":"2026-09-28T01:31:21.437Z"}
{"job":"a-51794","asset":"media/lib/362558.jpg","units":6,"worker":"render-01:57701","at":"2026-09-28T01:31:25.677Z"}
{"job":"a-51792","asset":"media/lib/362544.jpg","units":7,"worker":"render-01:36025","at":"2026-09-28T01:31:26.025Z"}
{"job":"a-51795","asset":"media/lib/362565.jpg","units":5,"worker":"render-01:36025","at":"2026-09-28T01:31:28.822Z"}
{"job":"a-51795","asset":"media/lib/362565.jpg","units":5,"worker":"render-01:57701","at":"2026-09-28T01:31:28.827Z"}
{"job":"a-51793","asset":"media/lib/362551.jpg","units":8,"worker":"render-01:43353","at":"2026-09-28T01:31:29.753Z"}
{"job":"a-51793","asset":"media/lib/362551.jpg","units":8,"worker":"render-01:37586","at":"2026-09-28T01:31:29.753Z"}
{"job":"a-51797","asset":"media/lib/362579.jpg","units":8,"worker":"render-01:36025","at":"2026-09-28T01:31:33.551Z"}
{"job":"a-51797","asset":"media/lib/362579.jpg","units":8,"worker":"render-01:43353","at":"2026-09-28T01:31:33.555Z"}
{"job":"a-51798","asset":"media/lib/362586.jpg","units":9,"worker":"render-01:37586","at":"2026-09-28T01:31:35.249Z"}
{"job":"a-51796","asset":"media/lib/362572.jpg","units":9,"worker":"render-01:57701","at":"2026-09-28T01:31:45.458Z"}
{"job":"a-51799","asset":"media/lib/362593.jpg","units":7,"worker":"render-01:36025","at":"2026-09-28T01:31:45.518Z"}
{"job":"a-51801","asset":"media/lib/362607.jpg","units":4,"worker":"render-01:37586","at":"2026-09-28T01:31:45.822Z"}
{"job":"a-51800","asset":"media/lib/362600.jpg","units":4,"worker":"render-01:43353","at":"2026-09-28T01:31:51.136Z"}
{"job":"a-51802","asset":"media/lib/362614.jpg","units":4,"worker":"render-01:57701","at":"2026-09-28T01:31:54.846Z"}
{"job":"a-51803","asset":"media/lib/362621.jpg","units":6,"worker":"render-01:36025","at":"2026-09-28T01:31:55.563Z"}
{"job":"a-51807","asset":"media/lib/362649.jpg","units":6,"worker":"render-02:27598","at":"2026-09-29T01:30:06.154Z"}
{"job":"a-51805","asset":"media/lib/362635.jpg","units":8,"worker":"render-02:26398","at":"2026-09-29T01:30:10.645Z"}
{"job":"a-51808","asset":"media/lib/362656.jpg","units":4,"worker":"render-02:27598","at":"2026-09-29T01:30:11.203Z"}
{"job":"a-51804","asset":"media/lib/362628.jpg","units":6,"worker":"render-02:56152","at":"2026-09-29T01:30:11.314Z"}
{"job":"a-51806","asset":"media/lib/362642.jpg","units":9,"worker":"render-02:28974","at":"2026-09-29T01:30:17.853Z"}
{"job":"a-51809","asset":"media/lib/362663.jpg","units":8,"worker":"render-02:26398","at":"2026-09-29T01:30:21.886Z"}
{"job":"a-51811","asset":"media/lib/362677.jpg","units":4,"worker":"render-02:56152","at":"2026-09-29T01:30:21.938Z"}
{"job":"a-51811","asset":"media/lib/362677.jpg","units":4,"worker":"render-02:27598","at":"2026-09-29T01:30:21.941Z"}
{"job":"a-51810","asset":"media/lib/362670.jpg","units":8,"worker":"render-02:27598","at":"2026-09-29T01:30:25.543Z"}
{"job":"a-51812","asset":"media/lib/362684.jpg","units":9,"worker":"render-02:28974","at":"2026-09-29T01:30:27.939Z"}
{"job":"a-51813","asset":"media/lib/362691.jpg","units":6,"worker":"render-02:26398","at":"2026-09-29T01:30:30.461Z"}
{"job":"a-51814","asset":"media/lib/362698.jpg","units":5,"worker":"render-02:56152","at":"2026-09-29T01:30:35.190Z"}
{"job":"a-51818","asset":"media/lib/362726.jpg","units":9,"worker":"render-02:27598","at":"2026-09-29T01:30:41.219Z"}
{"job":"a-51815","asset":"media/lib/362705.jpg","units":9,"worker":"render-02:28974","at":"2026-09-29T01:30:42.291Z"}
{"job":"a-51816","asset":"media/lib/362712.jpg","units":9,"worker":"render-02:26398","at":"2026-09-29T01:30:42.576Z"}
{"job":"a-51817","asset":"media/lib/362719.jpg","units":8,"worker":"render-02:56152","at":"2026-09-29T01:30:47.951Z"}
{"job":"a-51819","asset":"media/lib/362733.jpg","units":6,"worker":"render-02:27598","at":"2026-09-29T01:30:56.466Z"}
{"job":"a-51820","asset":"media/lib/362740.jpg","units":6,"worker":"render-02:28974","at":"2026-09-29T01:30:57.850Z"}
{"job":"a-51821","asset":"media/lib/362747.jpg","units":8,"worker":"render-02:26398","at":"2026-09-29T01:30:59.311Z"}
{"job":"a-51824","asset":"media/lib/362768.jpg","units":8,"worker":"render-02:28974","at":"2026-09-29T01:31:01.448Z"}
{"job":"a-51822","asset":"media/lib/362754.jpg","units":8,"worker":"render-02:56152","at":"2026-09-29T01:31:03.544Z"}
{"job":"a-51823","asset":"media/lib/362761.jpg","units":6,"worker":"render-02:27598","at":"2026-09-29T01:31:04.688Z"}
{"job":"a-51828","asset":"media/lib/362796.jpg","units":8,"worker":"render-02:27598","at":"2026-09-29T01:31:12.022Z"}
{"job":"a-51827","asset":"media/lib/362789.jpg","units":7,"worker":"render-02:56152","at":"2026-09-29T01:31:13.663Z"}
{"job":"a-51826","asset":"media/lib/362782.jpg","units":5,"worker":"render-02:28974","at":"2026-09-29T01:31:15.054Z"}
{"job":"a-51825","asset":"media/lib/362775.jpg","units":8,"worker":"render-02:26398","at":"2026-09-29T01:31:15.686Z"}
{"job":"a-51829","asset":"media/lib/362803.jpg","units":6,"worker":"render-02:27598","at":"2026-09-29T01:31:22.257Z"}
{"job":"a-51832","asset":"media/lib/362824.jpg","units":5,"worker":"render-02:26398","at":"2026-09-29T01:31:28.478Z"}
{"job":"a-51830","asset":"media/lib/362810.jpg","units":7,"worker":"render-02:56152","at":"2026-09-29T01:31:30.938Z"}
{"job":"a-51831","asset":"media/lib/362817.jpg","units":9,"worker":"render-02:28974","at":"2026-09-29T01:31:33.004Z"}
__FX__
mkdir -p var/log
cat > var/log/thumbd-2026-09-30.log <<'__FX__'
2026-09-30T01:30:01.412Z INFO 27 pending job(s), renderer imgproc
2026-09-30T01:30:01.655Z INFO batch started with 4 workers
2026-09-30T01:31:44.902Z INFO batch finished in 103247 ms, jobs per worker: 8, 7, 7, 6
__FX__
