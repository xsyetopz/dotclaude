#!/usr/bin/env bash
# mailpipe: ESM mail worker. In production the effective jobs.retry.maxAttempts is 3:
# src/util/merge.js only merges one level deep, so production.json's jobs.retry
# (which only sets backoff.baseMs) replaces the default jobs.retry wholesale, and
# src/config/schema.js then fills maxAttempts with DEFAULT_MAX_ATTEMPTS (3).
# Decoy: deploy/production.env sets MAILPIPE_RETRY_MAX=5, which env.js maps to
# jobs.retry.max (a key nothing reads).
set -euo pipefail

export GIT_AUTHOR_NAME="Sam Okafor" GIT_AUTHOR_EMAIL="sam@mailpipe.dev"
export GIT_COMMITTER_NAME="Sam Okafor" GIT_COMMITTER_EMAIL="sam@mailpipe.dev"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

mkdir -p config deploy docs scripts src/{config,util,queue,mail/templates} test

cat > package.json <<'EOF'
{
  "name": "mailpipe",
  "version": "2.3.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node test/run.js",
    "config:print": "node scripts/print-config.js"
  },
  "engines": { "node": ">=18" }
}
EOF

cat > .gitignore <<'EOF'
node_modules/
*.log
EOF

cat > README.md <<'EOF'
# mailpipe

Queue worker that renders and sends transactional mail.

## Config

`config/default.json` holds every setting. `config/<NODE_ENV>.json` overrides the
keys it lists; `MAILPIPE_*` environment variables override both (see
`src/config/env.js`). `npm run config:print` prints the effective config for the
current `NODE_ENV`.

## Retries

A job that throws is retried with backoff until it has been attempted
`jobs.retry.maxAttempts` times, then it goes to the dead-letter queue.
EOF

cat > docs/operations.md <<'EOF'
# Operations

- Production runs from the image built by `deploy/Dockerfile` with
  `NODE_ENV=production` and the variables in `deploy/production.env`.
- Staging uses `NODE_ENV=staging` and no extra variables.
- Dead-lettered jobs land in the queue named by `jobs.deadLetter`; on-call replays
  them with `scripts/replay-dlq.js`.
EOF

cat > config/default.json <<'EOF'
{
  "queue": { "name": "mail", "concurrency": 4, "pollMs": 250 },
  "smtp": { "host": "localhost", "port": 1025, "secure": false, "timeoutMs": 10000 },
  "jobs": {
    "retry": {
      "maxAttempts": 5,
      "backoff": { "kind": "exponential", "baseMs": 500, "maxMs": 60000 }
    },
    "deadLetter": null,
    "timeoutMs": 30000
  },
  "log": { "level": "info" }
}
EOF

cat > config/staging.json <<'EOF'
{
  "queue": { "name": "mail-staging" },
  "smtp": { "host": "smtp.staging.internal", "port": 587, "secure": true },
  "log": { "level": "debug" }
}
EOF

cat > config/test.json <<'EOF'
{
  "queue": { "name": "mail-test", "pollMs": 1 },
  "log": { "level": "silent" }
}
EOF

cat > deploy/Dockerfile <<'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
EOF

cat > deploy/production.env <<'EOF'
MAILPIPE_CONCURRENCY=8
MAILPIPE_SMTP_HOST=smtp.internal
MAILPIPE_LOG_LEVEL=warn
EOF

cat > src/util/merge.js <<'EOF'
// Merge two config objects. Keys in `override` win. Nested plain objects are
// merged instead of replaced, so an env file only has to list what it changes.
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : structuredClone(value);
  }
  return out;
}
EOF

cat > src/util/log.js <<'EOF'
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function createLogger(level = 'info') {
  const max = LEVELS[level] ?? LEVELS.info;
  const at = (name) => (...args) => {
    if (LEVELS[name] <= max) console.log(`[${name}]`, ...args);
  };
  return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}
EOF

cat > src/queue/constants.js <<'EOF'
// Fallbacks used when a config value is missing. Keep these conservative: a
// missing value usually means a broken config, and we would rather dead-letter
// early than hammer a failing SMTP server.
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF = { kind: 'fixed', baseMs: 1000, maxMs: 1000 };
export const DEFAULT_TIMEOUT_MS = 30000;
EOF

cat > src/config/env.js <<'EOF'
// MAILPIPE_* environment overrides. Each maps to a dotted config path.
const MAP = {
  MAILPIPE_CONCURRENCY: ['queue.concurrency', Number],
  MAILPIPE_QUEUE: ['queue.name', String],
  MAILPIPE_SMTP_HOST: ['smtp.host', String],
  MAILPIPE_SMTP_PORT: ['smtp.port', Number],
  MAILPIPE_LOG_LEVEL: ['log.level', String],
};

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    cur[k] = cur[k] && typeof cur[k] === 'object' ? { ...cur[k] } : {};
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
}

export function applyEnv(cfg, env) {
  const out = structuredClone(cfg);
  for (const [name, [dotted, cast]] of Object.entries(MAP)) {
    if (env[name] !== undefined && env[name] !== '') setPath(out, dotted, cast(env[name]));
  }
  return out;
}

export const ENV_VARS = Object.keys(MAP);
EOF

cat > src/config/schema.js <<'EOF'
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_BACKOFF, DEFAULT_TIMEOUT_MS } from '../queue/constants.js';

// Fill in anything missing and reject obviously broken values.
export function applyDefaults(cfg) {
  const jobs = cfg.jobs ?? {};
  const retry = jobs.retry ?? {};
  const backoff = { ...DEFAULT_BACKOFF, ...(retry.backoff ?? {}) };
  const out = {
    ...cfg,
    jobs: {
      ...jobs,
      retry: {
        ...retry,
        maxAttempts: retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        backoff,
      },
      timeoutMs: jobs.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  };
  if (!Number.isInteger(out.jobs.retry.maxAttempts) || out.jobs.retry.maxAttempts < 1) {
    throw new Error(`jobs.retry.maxAttempts must be a positive integer`);
  }
  if (!Number.isInteger(out.queue?.concurrency) || out.queue.concurrency < 1) {
    throw new Error(`queue.concurrency must be a positive integer`);
  }
  return out;
}
EOF

cat > src/config/load.js <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { merge } from '../util/merge.js';
import { applyEnv } from './env.js';
import { applyDefaults } from './schema.js';

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

export function loadConfig(env = process.env) {
  const name = env.NODE_ENV || 'development';
  let cfg = readJson('default.json');
  if (fs.existsSync(path.join(CONFIG_DIR, `${name}.json`))) {
    cfg = merge(cfg, readJson(`${name}.json`));
  }
  cfg = applyEnv(cfg, env);
  return applyDefaults(cfg);
}
EOF

cat > src/queue/backoff.js <<'EOF'
// Delay before attempt number `attempt` (1-based; attempt 1 has no delay).
export function delayFor(attempt, { kind, baseMs, maxMs }) {
  if (attempt <= 1) return 0;
  const raw = kind === 'exponential' ? baseMs * 2 ** (attempt - 2) : baseMs;
  return Math.min(raw, maxMs);
}
EOF

cat > src/queue/memory-queue.js <<'EOF'
// In-process queue used by tests and local dev.
export class MemoryQueue {
  constructor(name) {
    this.name = name;
    this.items = [];
    this.dead = [];
  }
  push(job) {
    this.items.push({ attempts: 0, ...job });
  }
  shift() {
    return this.items.shift();
  }
  deadLetter(job, err) {
    this.dead.push({ ...job, error: String(err && err.message ? err.message : err) });
  }
}
EOF

cat > src/queue/worker.js <<'EOF'
import { delayFor } from './backoff.js';

export class Worker {
  constructor({ queue, handler, config, logger, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.queue = queue;
    this.handler = handler;
    this.retry = config.jobs.retry;
    this.logger = logger;
    this.sleep = sleep;
  }

  // Process one job: attempt it until it succeeds or has been tried
  // retry.maxAttempts times in total, then dead-letter it.
  async runOne(job) {
    while (true) {
      job.attempts += 1;
      await this.sleep(delayFor(job.attempts, this.retry.backoff));
      try {
        await this.handler(job);
        return 'done';
      } catch (err) {
        this.logger.warn(`job ${job.id} attempt ${job.attempts}/${this.retry.maxAttempts} failed: ${err.message}`);
        if (job.attempts >= this.retry.maxAttempts) {
          this.queue.deadLetter(job, err);
          return 'dead';
        }
      }
    }
  }

  async drain() {
    const results = [];
    let job;
    while ((job = this.queue.shift())) results.push(await this.runOne(job));
    return results;
  }
}
EOF

cat > src/mail/render.js <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export function render(template, vars) {
  const src = fs.readFileSync(path.join(DIR, `${template}.txt`), 'utf8');
  return src.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`missing template variable ${k}`);
    return String(vars[k]);
  });
}
EOF

cat > src/mail/templates/welcome.txt <<'EOF'
Hi {{name}},

Welcome to {{product}}. Your workspace is ready at {{url}}.
EOF

cat > src/mail/templates/receipt.txt <<'EOF'
Hi {{name}},

We received your payment of {{amount}} for invoice {{invoice}}.
EOF

cat > src/mail/smtp.js <<'EOF'
// Thin wrapper so the worker can be tested without a real SMTP server.
export function createTransport(smtp, send) {
  return async function deliver(message) {
    if (!message.to) throw new Error('message has no recipient');
    return send({ host: smtp.host, port: smtp.port, secure: smtp.secure, ...message });
  };
}
EOF

cat > src/index.js <<'EOF'
import { loadConfig } from './config/load.js';
import { createLogger } from './util/log.js';
import { MemoryQueue } from './queue/memory-queue.js';
import { Worker } from './queue/worker.js';
import { render } from './mail/render.js';

const config = loadConfig();
const logger = createLogger(config.log.level);
const queue = new MemoryQueue(config.queue.name);
const worker = new Worker({
  queue,
  config,
  logger,
  handler: async (job) => {
    const body = render(job.template, job.vars);
    logger.debug(`would send ${job.template} to ${job.to}: ${body.length} bytes`);
  },
});

logger.info(`mailpipe ${config.queue.name}: maxAttempts=${config.jobs.retry.maxAttempts}`);
await worker.drain();
EOF

cat > scripts/print-config.js <<'EOF'
import { loadConfig } from '../src/config/load.js';

const cfg = loadConfig();
console.log(JSON.stringify(cfg, null, 2));
EOF

cat > scripts/replay-dlq.js <<'EOF'
// Replays dead-lettered jobs from a JSON export: node scripts/replay-dlq.js dlq.json
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/replay-dlq.js <export.json>');
  process.exit(2);
}
const jobs = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`would replay ${jobs.length} jobs`);
EOF

cat > test/run.js <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
globalThis.test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok - ${name}: ${err.message}`);
  }
};
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
  await import(path.join(dir, f));
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
EOF

cat > test/merge.test.js <<'EOF'
import assert from 'node:assert/strict';
import { merge } from '../src/util/merge.js';

await test('override wins for scalars', () => {
  assert.deepEqual(merge({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
});
await test('nested objects are merged, not replaced', () => {
  const base = { smtp: { host: 'localhost', port: 1025 } };
  assert.deepEqual(merge(base, { smtp: { host: 'smtp.internal' } }), { smtp: { host: 'smtp.internal', port: 1025 } });
});
await test('arrays are replaced', () => {
  assert.deepEqual(merge({ a: [1, 2] }, { a: [3] }), { a: [3] });
});
await test('base is not mutated', () => {
  const base = { q: { n: 1 } };
  merge(base, { q: { n: 2 } });
  assert.equal(base.q.n, 1);
});
EOF

cat > test/backoff.test.js <<'EOF'
import assert from 'node:assert/strict';
import { delayFor } from '../src/queue/backoff.js';

const exp = { kind: 'exponential', baseMs: 500, maxMs: 60000 };
await test('first attempt has no delay', () => assert.equal(delayFor(1, exp), 0));
await test('exponential doubles', () => assert.deepEqual([2, 3, 4].map((a) => delayFor(a, exp)), [500, 1000, 2000]));
await test('capped at maxMs', () => assert.equal(delayFor(20, exp), 60000));
await test('fixed backoff', () => assert.equal(delayFor(4, { kind: 'fixed', baseMs: 1000, maxMs: 1000 }), 1000));
EOF

cat > test/config.test.js <<'EOF'
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/load.js';

await test('test config keeps default retry settings', () => {
  const cfg = loadConfig({ NODE_ENV: 'test' });
  assert.equal(cfg.jobs.retry.maxAttempts, 5);
  assert.equal(cfg.jobs.retry.backoff.kind, 'exponential');
});
await test('env overrides concurrency', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test', MAILPIPE_CONCURRENCY: '9' }).queue.concurrency, 9);
});
await test('staging smtp host', () => {
  assert.equal(loadConfig({ NODE_ENV: 'staging' }).smtp.host, 'smtp.staging.internal');
});
EOF

cat > test/worker.test.js <<'EOF'
import assert from 'node:assert/strict';
import { MemoryQueue } from '../src/queue/memory-queue.js';
import { Worker } from '../src/queue/worker.js';
import { createLogger } from '../src/util/log.js';

const config = { jobs: { retry: { maxAttempts: 4, backoff: { kind: 'fixed', baseMs: 0, maxMs: 0 } } } };

await test('dead-letters after maxAttempts', async () => {
  const q = new MemoryQueue('t');
  let calls = 0;
  const w = new Worker({ queue: q, config, logger: createLogger('silent'), sleep: async () => {}, handler: async () => { calls++; throw new Error('smtp down'); } });
  q.push({ id: 1 });
  assert.deepEqual(await w.drain(), ['dead']);
  assert.equal(calls, 4);
});
await test('succeeds on a later attempt', async () => {
  const q = new MemoryQueue('t');
  let calls = 0;
  const w = new Worker({ queue: q, config, logger: createLogger('silent'), sleep: async () => {}, handler: async () => { if (++calls < 3) throw new Error('flaky'); } });
  q.push({ id: 2 });
  assert.deepEqual(await w.drain(), ['done']);
});
EOF

git add -A
commit "2026-06-02T10:00:00+01:00" "mailpipe 2.0: worker, config loader, templates"

# commit 2: production config
cat > config/production.json <<'EOF'
{
  "queue": { "name": "mail-prod" },
  "smtp": { "host": "smtp.internal", "port": 587, "secure": true },
  "jobs": {
    "retry": { "backoff": { "baseMs": 2000 } },
    "deadLetter": "mail-dlq"
  }
}
EOF
git add -A
commit "2026-06-19T15:22:00+01:00" "config: production queue, smtp and slower backoff for the relay"

# commit 3: non-recursive merge (perf), which only merges one level deep
cat > src/util/merge.js <<'EOF'
// Merge two config objects. Keys in `override` win. Nested plain objects are
// merged instead of replaced, so an env file only has to list what it changes.
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = { ...base[key], ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}
EOF
git add -A
commit "2026-07-08T09:41:00+01:00" "perf: avoid recursion and structuredClone in config merge"

# commit 4: env override for backoff
sed -i.bak "s|  MAILPIPE_LOG_LEVEL: \['log.level', String\],|  MAILPIPE_RETRY_BASE_MS: ['jobs.retry.backoff.baseMs', Number],\n  MAILPIPE_LOG_LEVEL: ['log.level', String],|" src/config/env.js
rm -f src/config/env.js.bak
grep -q MAILPIPE_RETRY_BASE_MS src/config/env.js
git add -A
commit "2026-07-30T12:10:00+01:00" "config: MAILPIPE_RETRY_BASE_MS override"

# commit 5: ops tried a workaround
cat >> deploy/production.env <<'EOF'
# INC-2207: mails dead-lettered too early, bump retries
MAILPIPE_RETRY_MAX=5
EOF
git add -A
commit "2026-09-22T17:05:00+01:00" "deploy: set MAILPIPE_RETRY_MAX=5 for INC-2207"
