#!/usr/bin/env bash
# Ticket summarizer service (Node CJS) with recorded provider traffic.
set -euo pipefail
export GIT_AUTHOR_NAME="Ola Brandt" GIT_AUTHOR_EMAIL="ola@helpdesk.test"
export GIT_COMMITTER_NAME="Ola Brandt" GIT_COMMITTER_EMAIL="ola@helpdesk.test"
git init -q -b main .
git config user.name "Ola Brandt"; git config user.email "ola@helpdesk.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src/transport src/prompts config scripts test fixtures docs logs

cat > package.json <<'EOF'
{
  "name": "ticket-summarizer",
  "version": "1.6.0",
  "private": true,
  "description": "Summarizes helpdesk tickets for the triage queue",
  "scripts": {
    "test": "node --test test/",
    "replay": "node scripts/replay.js fixtures/traffic-2026-09-22_28.ndjson"
  }
}
EOF
cat > .gitignore <<'EOF'
logs/
node_modules/
EOF
cat > README.md <<'EOF'
# ticket-summarizer

Turns raw helpdesk tickets into a three-line summary for the triage queue.

- `src/summarize.js` builds the prompt and calls the provider through `src/client.js`.
- Every provider call is appended to `logs/calls.ndjson` (one JSON object per line).
- `npm run replay` re-runs recorded provider traffic through the current client, offline.
  It rewrites `logs/calls.ndjson` and prints a breakdown at the end.

Models are configured in `config/default.json`. Aliases and the dated snapshots the
provider may answer with are listed in `config/models.json`.
EOF
cat > config/default.json <<'EOF'
{
  "model": "sum-large",
  "maxRetries": 2,
  "maxTokens": 400,
  "logFile": "logs/calls.ndjson"
}
EOF
cat > config/models.json <<'EOF'
{
  "sum-large": { "snapshots": ["sum-large-2026-09", "sum-large-2026-07"], "context": 200000 },
  "sum-small": { "snapshots": ["sum-small-2026-08"], "context": 64000 }
}
EOF
cat > src/config.js <<'EOF'
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function load() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/default.json'), 'utf8'));
  cfg.models = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/models.json'), 'utf8'));
  cfg.root = ROOT;
  return cfg;
}

module.exports = { load, ROOT };
EOF
cat > src/hash.js <<'EOF'
'use strict';
const crypto = require('node:crypto');

function shortHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

module.exports = { shortHash };
EOF
cat > src/errors.js <<'EOF'
'use strict';

class ProviderError extends Error {
  constructor(status, body) {
    super(`provider returned ${status}`);
    this.status = status;
    this.body = body;
  }
}

module.exports = { ProviderError };
EOF
cat > src/normalize.js <<'EOF'
'use strict';

// Turn a raw provider response into the shape the rest of the app uses.
function normalize(req, res) {
  const body = res.body || {};
  const text = (body.output || []).map(p => p.text).join('').trim();
  return {
    id: body.id,
    text,
    model: body.model,
    usage: {
      input: body.usage ? body.usage.input_tokens : 0,
      output: body.usage ? body.usage.output_tokens : 0,
    },
  };
}

module.exports = { normalize };
EOF
cat > src/calllog.js <<'EOF'
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createCallLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    file,
    append(entry) {
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    },
    reset() {
      fs.writeFileSync(file, '');
    },
  };
}

function nullLog() {
  return { append() {}, reset() {} };
}

module.exports = { createCallLog, nullLog };
EOF
cat > src/client.js <<'EOF'
'use strict';
const { normalize } = require('./normalize');
const { ProviderError } = require('./errors');

const RETRYABLE = new Set([500, 502, 503]);

function createClient({ transport, log, config, now = () => Date.now() }) {
  async function complete(req) {
    const started = now();
    let attempts = 0;
    let res;
    for (;;) {
      attempts++;
      res = await transport.send(req);
      if (res.status === 200) break;
      if (RETRYABLE.has(res.status) && attempts <= config.maxRetries) continue;
      throw new ProviderError(res.status, res.body);
    }
    const result = normalize(req, res);
    log.append({
      id: req.id,
      request_model: req.model,
      model: result.model,
      attempts,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      latency_ms: now() - started,
    });
    return result;
  }
  return { complete };
}

module.exports = { createClient, RETRYABLE };
EOF
cat > src/cache.js <<'EOF'
'use strict';
const { shortHash } = require('./hash');

// In-process memo so the triage UI can re-open a ticket without a second call.
function createCache() {
  const map = new Map();
  const key = (model, prompt) => `${model}:${shortHash(prompt)}`;
  return {
    get(model, prompt) {
      return map.get(key(model, prompt));
    },
    put(result, prompt) {
      map.set(key(result.model, prompt), result);
    },
    size() {
      return map.size;
    },
  };
}

module.exports = { createCache };
EOF
cat > src/prompts/system.txt <<'EOF'
You summarize helpdesk tickets for a triage queue. Be specific: name the product,
the error, what the customer already tried, and what they are asking for.
EOF
cat > src/prompts/summary.txt <<'EOF'
Summarize the ticket below in exactly three lines:
1. What is broken (product, error text, since when).
2. What the customer already tried.
3. What they want from us.

Ticket {{ticket_id}}:
{{body}}
EOF
cat > src/prompts.js <<'EOF'
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'prompts');
const system = fs.readFileSync(path.join(dir, 'system.txt'), 'utf8');
const summary = fs.readFileSync(path.join(dir, 'summary.txt'), 'utf8');

function render(ticket) {
  return summary.replace('{{ticket_id}}', ticket.id).replace('{{body}}', ticket.body);
}

module.exports = { system, render };
EOF
cat > src/summarize.js <<'EOF'
'use strict';
const prompts = require('./prompts');

function createSummarizer({ client, cache, config }) {
  async function summarize(ticket, callId) {
    const prompt = prompts.render(ticket);
    const hit = cache.get(config.model, prompt);
    if (hit) return { ...hit, cached: true };
    const result = await client.complete({
      id: callId || ticket.id,
      model: config.model,
      system: prompts.system,
      input: prompt,
      max_tokens: config.maxTokens,
    });
    cache.put(result, prompt);
    return { ...result, cached: false };
  }
  return { summarize };
}

module.exports = { createSummarizer };
EOF
cat > src/transport/http.js <<'EOF'
'use strict';

// Live transport. Not used by tests or replay.
function createHttpTransport({ baseUrl, apiKey }) {
  return {
    async send(req) {
      const r = await fetch(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(req),
      });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    },
  };
}

module.exports = { createHttpTransport };
EOF
cat > src/transport/replay.js <<'EOF'
'use strict';

// Serves recorded provider attempts in order, per call id.
function createReplayTransport(records) {
  const queues = new Map(records.map(r => [r.id, r.attempts.slice()]));
  return {
    async send(req) {
      const q = queues.get(req.id);
      if (!q || q.length === 0) throw new Error(`no recorded attempt left for ${req.id} (${req.model})`);
      const a = q.shift();
      return { status: a.status, body: a.body || null };
    },
  };
}

module.exports = { createReplayTransport };
EOF
cat > scripts/replay.js <<'EOF'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('../src/config');
const { createClient } = require('../src/client');
const { createCache } = require('../src/cache');
const { createCallLog } = require('../src/calllog');
const { createSummarizer } = require('../src/summarize');
const { createReplayTransport } = require('../src/transport/replay');

async function main() {
  const file = process.argv[2];
  const config = load();
  const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const log = createCallLog(path.join(config.root, config.logFile));
  log.reset();
  const client = createClient({ transport: createReplayTransport(records), log, config });
  const summarizer = createSummarizer({ client, cache: createCache(), config });
  let errors = 0;
  for (const r of records) {
    try {
      await summarizer.summarize(r.ticket, r.id);
    } catch (e) {
      errors++;
      console.error(`${r.id}: ${e.message}`);
    }
  }
  const lines = fs.readFileSync(log.file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const byModel = {};
  for (const l of lines) byModel[l.model] = (byModel[l.model] || 0) + 1;
  const digest = crypto.createHash('sha256').update(lines.map(l => `${l.id} ${l.model}`).sort().join('\n')).digest('hex').slice(0, 12);
  console.log(`replayed ${records.length} events, ${errors} errors, ${lines.length} log lines, log digest ${digest}`);
  console.log('log lines by model field:');
  for (const [m, n] of Object.entries(byModel).sort()) console.log(`  ${String(m).padEnd(22)} ${n}`);
}

main().catch(e => { console.error(e); process.exit(1); });
EOF
cat > test/normalize.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../src/normalize');

test('normalize joins output parts and trims', () => {
  const r = normalize({ model: 'sum-large' }, { status: 200, body: { id: 'r1', model: 'sum-large', output: [{ text: ' a' }, { text: 'b ' }], usage: { input_tokens: 3, output_tokens: 2 } } });
  assert.strictEqual(r.text, 'ab');
  assert.deepStrictEqual(r.usage, { input: 3, output: 2 });
});

test('normalize tolerates missing usage', () => {
  const r = normalize({ model: 'sum-large' }, { status: 200, body: { id: 'r2', output: [] } });
  assert.deepStrictEqual(r.usage, { input: 0, output: 0 });
  assert.strictEqual(r.text, '');
});
EOF
cat > test/helpers.js <<'EOF'
'use strict';

const config = { model: 'sum-large', maxRetries: 2, maxTokens: 400 };

function body(model, text = 'line one\nline two\nline three', id = 'resp') {
  return { id, model, output: [{ text }], usage: { input_tokens: 120, output_tokens: 40 } };
}

function scripted(responses) {
  const sent = [];
  return {
    sent,
    async send(req) {
      sent.push(req);
      const r = responses.shift();
      if (!r) throw new Error('unexpected call');
      return r;
    },
  };
}

function memLog() {
  const lines = [];
  return { lines, append(e) { lines.push(e); }, reset() { lines.length = 0; } };
}

module.exports = { config, body, scripted, memLog };
EOF
cat > test/client.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('../src/client');
const { config, body, scripted, memLog } = require('./helpers');

test('client returns normalized text on 200', async () => {
  const t = scripted([{ status: 200, body: body('sum-large') }]);
  const c = createClient({ transport: t, log: memLog(), config });
  const r = await c.complete({ id: 'c1', model: 'sum-large', input: 'x' });
  assert.match(r.text, /line one/);
});

test('client retries 502 on the same model', async () => {
  const t = scripted([{ status: 502 }, { status: 200, body: body('sum-large') }]);
  const c = createClient({ transport: t, log: memLog(), config });
  await c.complete({ id: 'c2', model: 'sum-large', input: 'x' });
  assert.deepStrictEqual(t.sent.map(s => s.model), ['sum-large', 'sum-large']);
});

test('client gives up after maxRetries', async () => {
  const t = scripted([{ status: 503 }, { status: 503 }, { status: 503 }]);
  const c = createClient({ transport: t, log: memLog(), config });
  await assert.rejects(c.complete({ id: 'c3', model: 'sum-large', input: 'x' }), /503/);
});

test('client logs one line per call', async () => {
  const log = memLog();
  const t = scripted([{ status: 502 }, { status: 200, body: body('sum-large') }]);
  const c = createClient({ transport: t, log, config, now: () => 1000 });
  await c.complete({ id: 'c4', model: 'sum-large', input: 'x' });
  assert.strictEqual(log.lines.length, 1);
  assert.strictEqual(log.lines[0].attempts, 2);
  assert.strictEqual(log.lines[0].request_model, 'sum-large');
});
EOF
cat > test/cache.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('../src/client');
const { createCache } = require('../src/cache');
const { createSummarizer } = require('../src/summarize');
const { config, body, scripted, memLog } = require('./helpers');

test('re-opening a ticket is served from cache', async () => {
  const t = scripted([{ status: 200, body: body('sum-large') }]);
  const s = createSummarizer({ client: createClient({ transport: t, log: memLog(), config }), cache: createCache(), config });
  const ticket = { id: 'T-1', body: 'Printer offline since Monday' };
  const a = await s.summarize(ticket);
  const b = await s.summarize(ticket);
  assert.strictEqual(a.cached, false);
  assert.strictEqual(b.cached, true);
  assert.strictEqual(t.sent.length, 1);
});

test('different tickets do not share cache entries', async () => {
  const t = scripted([{ status: 200, body: body('sum-large', 'one') }, { status: 200, body: body('sum-large', 'two') }]);
  const s = createSummarizer({ client: createClient({ transport: t, log: memLog(), config }), cache: createCache(), config });
  const a = await s.summarize({ id: 'T-1', body: 'A' });
  const b = await s.summarize({ id: 'T-2', body: 'B' });
  assert.notStrictEqual(a.text, b.text);
});
EOF
cat > test/prompts.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const prompts = require('../src/prompts');

test('summary prompt includes ticket id and body', () => {
  const p = prompts.render({ id: 'T-9', body: 'VPN drops every 10 minutes' });
  assert.match(p, /Ticket T-9:/);
  assert.match(p, /VPN drops/);
  assert.match(p, /exactly three lines/);
});
EOF
cat > docs/ARCHITECTURE.md <<'EOF'
# Architecture

```
triage UI -> summarize.js -> cache.js (memo)
                         \-> client.js -> transport (http | replay)
                                       \-> calllog.js -> logs/calls.ndjson
```

The provider answers alias requests (`sum-large`) with a dated snapshot id in
`body.model` (for example `sum-large-2026-09`). During a snapshot rollout the
previous snapshot of the same alias can still answer some calls; both are listed
in `config/models.json`.

Recorded traffic lives in `fixtures/`. Each record holds the ticket and every
provider attempt (status + body) in the order the provider returned them.
Re-open events (`-reopen` ids) have no attempts: in production the triage UI got
them from the cache, so replaying them must not reach the provider.
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 1.6.0
- Call log: one line per provider call with attempts and token counts.

## 1.5.0
- In-process cache so re-opening a ticket does not call the provider again.

## 1.4.0
- Replay transport and `npm run replay` for offline checks.
EOF
commit "2026-08-18T09:12:00+02:00" "Summarizer service with retrying client, replay transport and call log"

# --- Sep 22: overload handling + normalize change (the real cause) ---
cat > config/default.json <<'EOF'
{
  "model": "sum-large",
  "fallbackModel": "sum-small",
  "maxRetries": 2,
  "maxTokens": 400,
  "logFile": "logs/calls.ndjson"
}
EOF
cat > src/client.js <<'EOF'
'use strict';
const { normalize } = require('./normalize');
const { ProviderError } = require('./errors');

const RETRYABLE = new Set([500, 502, 503]);
const OVERLOADED = 529;

function createClient({ transport, log, config, now = () => Date.now() }) {
  async function complete(req) {
    const started = now();
    let attempts = 0;
    let current = req;
    let res;
    for (;;) {
      attempts++;
      res = await transport.send(current);
      if (res.status === 200) break;
      // Degrade gracefully instead of failing the triage queue when the provider is overloaded.
      if (res.status === OVERLOADED && config.fallbackModel && current.model !== config.fallbackModel) {
        current = { ...current, model: config.fallbackModel };
        continue;
      }
      if (RETRYABLE.has(res.status) && attempts <= config.maxRetries) continue;
      throw new ProviderError(res.status, res.body);
    }
    const result = normalize(req, res);
    log.append({
      id: req.id,
      request_model: req.model,
      model: result.model,
      attempts,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      latency_ms: now() - started,
    });
    return result;
  }
  return { complete };
}

module.exports = { createClient, RETRYABLE, OVERLOADED };
EOF
cat > src/normalize.js <<'EOF'
'use strict';

// Turn a raw provider response into the shape the rest of the app uses.
// `model` is the model id we asked for: the provider echoes dated snapshot ids
// (sum-large-2026-09) which made cache keys miss on every call.
function normalize(req, res) {
  const body = res.body || {};
  const text = (body.output || []).map(p => p.text).join('').trim();
  return {
    id: body.id,
    text,
    model: req.model,
    usage: {
      input: body.usage ? body.usage.input_tokens : 0,
      output: body.usage ? body.usage.output_tokens : 0,
    },
  };
}

module.exports = { normalize };
EOF
cat >> test/client.test.js <<'EOF'

test('client does not fail the queue when the provider is overloaded', async () => {
  const t = scripted([{ status: 529 }, { status: 200, body: body('sum-small') }]);
  const c = createClient({ transport: t, log: memLog(), config: { ...config, fallbackModel: 'sum-small' } });
  const r = await c.complete({ id: 'c5', model: 'sum-large', input: 'x' });
  assert.match(r.text, /line one/);
});
EOF
commit "2026-09-22T10:41:00+02:00" "client: handle 529 overloaded without failing the triage queue; normalize: stable model id for cache keys"

cat > CHANGELOG.md <<'EOF'
# Changelog

## 1.7.0
- Overloaded (529) responses no longer fail the triage queue.
- Cache keys no longer miss when the provider answers with a dated snapshot id.

## 1.6.0
- Call log: one line per provider call with attempts and token counts.

## 1.5.0
- In-process cache so re-opening a ticket does not call the provider again.

## 1.4.0
- Replay transport and `npm run replay` for offline checks.
EOF
sed -i.bak 's/"version": "1.6.0"/"version": "1.7.0"/' package.json && rm package.json.bak
commit "2026-09-22T11:05:00+02:00" "Release 1.7.0"

cat > src/prompts/summary.txt <<'EOF'
Summarize the ticket below in exactly three lines:
1. What is broken (product, error text, since when).
2. What the customer already tried.
3. What they want from us.

Do not add greetings or sign-offs.

Ticket {{ticket_id}}:
{{body}}
EOF
commit "2026-09-24T15:20:00+02:00" "prompts: no greetings in summaries"
# --- traffic: 412 recorded calls, Sep 22-28 ---
node - <<'EOF'
const fs = require('fs');
let s = 20260922;
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const products = ['Printer P-200', 'VPN client', 'Billing portal', 'Mobile app', 'SSO login', 'Desk phone', 'Laptop dock', 'Shared drive'];
const errors = ['error 0x80070005', 'timeout after 30s', 'blank screen', '"session expired"', 'sync stuck at 99%', 'HTTP 500', 'no dial tone', 'access denied'];
const tried = ['rebooted', 'reinstalled', 'cleared cache', 'tried another network', 'reset password', 'swapped cable'];
const N = 412;
const idx = Array.from({ length: N }, (_, i) => i);
for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const fallback = new Set(idx.slice(0, 37));
const retry502 = new Set(idx.slice(37, 57));
const oldSnap = new Set(Array.from({ length: 12 }, (_, k) => 3 + k * 4)); // early calls, Sep 22
for (const k of oldSnap) { fallback.delete(k); retry502.delete(k); }
// keep counts exact
let extra = 57; while (fallback.size < 37) { if (!oldSnap.has(idx[extra]) && !retry502.has(idx[extra])) fallback.add(idx[extra]); extra++; }
while (retry502.size < 20) { if (!oldSnap.has(idx[extra]) && !fallback.has(idx[extra])) retry502.add(idx[extra]); extra++; }
const out = [];
for (let i = 0; i < N; i++) {
  const id = 'c' + String(i + 1).padStart(4, '0');
  const day = 22 + Math.floor(i / 59);
  const p = products[Math.floor(rnd() * products.length)], e = errors[Math.floor(rnd() * errors.length)], t = tried[Math.floor(rnd() * tried.length)];
  const ticket = { id: 'T-' + (51000 + i), body: `${p} shows ${e} since ${day - 1} Sep. Customer ${t}. Wants it working before quarter close.` };
  const full = `1. ${p}: ${e}, since ${day - 1} Sep.\n2. Customer already ${t}.\n3. Wants a fix before quarter close.`;
  const short = `${p} has a problem. Customer wants help.`;
  const usage = (o) => ({ input_tokens: 180 + Math.floor(rnd() * 60), output_tokens: o });
  let attempts;
  if (fallback.has(i)) attempts = [{ status: 529, body: { error: { type: 'overloaded_error', message: 'Overloaded' } } }, { status: 200, body: { id: 'r' + i, model: 'sum-small-2026-08', output: [{ text: short }], usage: usage(14) } }];
  else if (retry502.has(i)) attempts = [{ status: 502, body: null }, { status: 200, body: { id: 'r' + i, model: 'sum-large-2026-09', output: [{ text: full }], usage: usage(46) } }];
  else attempts = [{ status: 200, body: { id: 'r' + i, model: oldSnap.has(i) ? 'sum-large-2026-07' : 'sum-large-2026-09', output: [{ text: full }], usage: usage(46) } }];
  out.push(JSON.stringify({ id, ts: `2026-09-${day}T${String(8 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`, ticket, attempts }));
}
// triage re-opens: same ticket again later the same day, answered from the cache (no provider call)
const withReopens = [];
out.forEach((line, i) => {
  withReopens.push(line);
  if (i % 16 === 5) { const r = JSON.parse(line); withReopens.push(JSON.stringify({ id: r.id + '-reopen', ts: r.ts, ticket: r.ticket, attempts: [] })); }
});
fs.writeFileSync('fixtures/traffic-2026-09-22_28.ndjson', withReopens.join('\n') + '\n');
EOF

commit "2026-09-29T09:02:00+02:00" "fixtures: record last week's provider traffic for replay"

# Production call log from last week (ignored by git): what the user has been looking at.
node -e '
const fs=require("fs");
const recs=fs.readFileSync("fixtures/traffic-2026-09-22_28.ndjson","utf8").trim().split("\n").map(JSON.parse).filter(r=>r.attempts.length);
const out=recs.map(r=>{const ok=r.attempts[r.attempts.length-1];return JSON.stringify({id:r.id,request_model:"sum-large",model:"sum-large",attempts:r.attempts.length,input_tokens:ok.body.usage.input_tokens,output_tokens:ok.body.usage.output_tokens,latency_ms:900+(r.attempts.length-1)*1400});});
fs.writeFileSync("logs/calls.ndjson",out.join("\n")+"\n");'
