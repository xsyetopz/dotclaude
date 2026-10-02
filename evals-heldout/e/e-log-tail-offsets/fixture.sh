#!/usr/bin/env bash
# buildlog: CJS service behind the CI build page's log panel, the ci-tail CLI and the nightly log archiver.
set -euo pipefail
export GIT_AUTHOR_NAME="Ji-woo Park" GIT_AUTHOR_EMAIL="jiwoo@ci.test"
export GIT_COMMITTER_NAME="Ji-woo Park" GIT_COMMITTER_EMAIL="jiwoo@ci.test"
git init -q -b main .
git config user.name "Ji-woo Park"; git config user.email "jiwoo@ci.test"; git config commit.gpgsign false
commit() { local d="$1"; shift; git add -A; GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$*"; }
mkdir -p src web cli bin scripts docs test/fixtures

cat > package.json <<'EOF'
{
  "name": "buildlog",
  "version": "1.6.0",
  "private": true,
  "bin": { "ci-tail": "bin/ci-tail" },
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/"
  }
}
EOF
cat > .gitignore <<'EOF'
node_modules/
archive/
dist/
EOF
cat > .editorconfig <<'EOF'
root = true

[*]
indent_style = space
indent_size = 2
insert_final_newline = true
EOF
cat > README.md <<'EOF'
# buildlog

Serves CI job logs to the build page (web/log-viewer.js) and to tools.

    npm start      API on :7070 (src/index.js)
    npm test       unit tests

Docs: docs/API.md (endpoints and who uses them), docs/RUNNER.md (how logs get written).
EOF
cat > docs/RUNNER.md <<'EOF'
# How job logs are written

The runner streams container output into `/var/lib/ci/logs/<job>.log`, appending as it arrives.
Writes are whatever the pipe hands over, so a write can end in the middle of a multi-byte UTF-8
character (we have plenty: ✓ ⚠ · — and emoji from people's scripts). Logs keep their ANSI colour codes.

Retrying a job keeps its id and its log path: `attempt` is incremented and the file is truncated,
then written from scratch.

src/logstore.js is the only reader of these files.
EOF
cat > src/logstore.js <<'EOF'
'use strict';
// Read side of /var/lib/ci/logs (see docs/RUNNER.md). Kept in memory here; production wraps the files with
// the same interface (append/truncate are only called by the runner shim and tests).

class LogStore {
  constructor() {
    this.logs = new Map();
  }

  append(jobId, chunk) {
    const cur = this.logs.get(jobId) || Buffer.alloc(0);
    this.logs.set(jobId, Buffer.concat([cur, Buffer.from(chunk)]));
  }

  truncate(jobId) {
    this.logs.set(jobId, Buffer.alloc(0));
  }

  size(jobId) {
    return (this.logs.get(jobId) || Buffer.alloc(0)).length;
  }

  // Bytes [start, end) of the log as currently written.
  read(jobId, start = 0, end = undefined) {
    return (this.logs.get(jobId) || Buffer.alloc(0)).subarray(start, end);
  }
}

module.exports = { LogStore };
EOF
cat > src/jobs.js <<'EOF'
'use strict';

class Jobs {
  constructor(store) {
    this.store = store;
    this.jobs = new Map();
  }

  create(id) {
    const job = { id, state: 'running', attempt: 1 };
    this.jobs.set(id, job);
    this.store.truncate(id);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  finish(id, state = 'passed') {
    this.jobs.get(id).state = state;
  }
}

module.exports = { Jobs };
EOF
cat > src/server.js <<'EOF'
'use strict';
// API for the build page and tools. A handler takes { method, url, headers } and resolves to
// { status, headers, body } (body is a Buffer or string); src/http.js adapts it to node:http.

function json(status, value) {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
}

function createServer({ store, jobs }) {
  return async function handle(req) {
    const url = new URL(req.url, 'http://buildlog.internal');
    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/))) {
      const job = jobs.get(m[1]);
      if (!job) return json(404, { error: 'not_found' });
      return json(200, { id: job.id, state: job.state, attempt: job.attempt, logBytes: store.size(job.id) });
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/log$/))) {
      const job = jobs.get(m[1]);
      if (!job) return json(404, { error: 'not_found' });
      return {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-job-state': job.state },
        body: store.read(job.id),
      };
    }
    return json(404, { error: 'not_found' });
  };
}

module.exports = { createServer };
EOF
cat > src/http.js <<'EOF'
'use strict';
const http = require('http');

// Adapts a createServer() handler to node:http.
function listen(handle, port) {
  const server = http.createServer(async (req, res) => {
    try {
      const out = await handle({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err && err.message));
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { listen };
EOF
cat > src/index.js <<'EOF'
'use strict';
const { LogStore } = require('./logstore');
const { Jobs } = require('./jobs');
const { createServer } = require('./server');
const { listen } = require('./http');

const store = new LogStore();
const jobs = new Jobs(store);
listen(createServer({ store, jobs }), Number(process.env.PORT || 7070)).then(() => {
  console.log(`buildlog on :${process.env.PORT || 7070}`);
});
EOF
cat > web/log-viewer.js <<'EOF'
'use strict';
// Build-page log panel. Bundled for the browser (esbuild -> dist/, see web/index.html); CommonJS so tests
// can drive it in node. `transport` is fetch-shaped: ({ method, url, headers }) -> { status, headers, body }.
const POLL_MS = 2000;

class LogViewer {
  constructor({ transport, jobId, render }) {
    Object.assign(this, { transport, jobId, render });
    this.text = '';
    this.state = 'running';
  }

  async poll() {
    const res = await this.transport({ method: 'GET', url: `/api/jobs/${this.jobId}/log`, headers: {} });
    if (res.status !== 200) return this.state;
    this.text = new TextDecoder().decode(res.body);
    this.state = res.headers['x-job-state'];
    this.render(this.text);
    return this.state;
  }

  start() {
    const tick = async () => {
      const state = await this.poll();
      if (state === 'running') this._timer = setTimeout(tick, POLL_MS);
    };
    return tick();
  }

  stop() {
    clearTimeout(this._timer);
  }
}

module.exports = { LogViewer, POLL_MS };
EOF
cat > web/index.html <<'EOF'
<!doctype html>
<meta charset="utf-8">
<title>Build log</title>
<pre id="log"></pre>
<script src="/dist/log-viewer.js"></script>
<script>
  const job = new URLSearchParams(location.search).get('job');
  const pre = document.getElementById('log');
  const transport = async (req) => {
    const r = await fetch(req.url, { method: req.method, headers: req.headers });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: new Uint8Array(await r.arrayBuffer()) };
  };
  new LogViewer({ transport, jobId: job, render: (html) => { pre.innerHTML = html; } }).start();
</script>
EOF
cat > docs/API.md <<'EOF'
# buildlog API

## GET /api/jobs/:id

`{ id, state, attempt, logBytes }`. `state` is `running`, `passed` or `failed`.

## GET /api/jobs/:id/log

The job's log as `text/plain; charset=utf-8`: the raw bytes as written by the runner, ANSI codes included.
Header `x-job-state` carries the job state so pollers know when to stop.

Used by the build page log panel (web/log-viewer.js, polls every 2 s while the job runs).
EOF
cat > test/server.test.js <<'EOF'
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LogStore } = require('../src/logstore');
const { Jobs } = require('../src/jobs');
const { createServer } = require('../src/server');

function setup() {
  const store = new LogStore();
  const jobs = new Jobs(store);
  jobs.create('j1');
  return { store, jobs, handle: createServer({ store, jobs }) };
}

test('log endpoint returns the log as written', async () => {
  const { store, handle } = setup();
  store.append('j1', 'line 1 ✓\n');
  store.append('j1', 'line 2\n');
  const res = await handle({ method: 'GET', url: '/api/jobs/j1/log', headers: {} });
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(res.body).toString('utf8'), 'line 1 ✓\nline 2\n');
  assert.equal(res.headers['x-job-state'], 'running');
});

test('unknown job is a 404', async () => {
  const { handle } = setup();
  const res = await handle({ method: 'GET', url: '/api/jobs/nope/log', headers: {} });
  assert.equal(res.status, 404);
});
EOF
cat > test/viewer.test.js <<'EOF'
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LogStore } = require('../src/logstore');
const { Jobs } = require('../src/jobs');
const { createServer } = require('../src/server');
const { LogViewer } = require('../web/log-viewer');

test('viewer shows the whole log after each poll', async () => {
  const store = new LogStore();
  const jobs = new Jobs(store);
  jobs.create('j1');
  const handle = createServer({ store, jobs });
  const seen = [];
  const v = new LogViewer({ transport: handle, jobId: 'j1', render: (t) => seen.push(t) });
  store.append('j1', 'a\n');
  await v.poll();
  store.append('j1', 'b\n');
  await v.poll();
  assert.equal(v.text, 'a\nb\n');
  assert.equal(seen.length, 2);
});
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 1.0.0
- Log endpoint and build page log panel.
EOF
commit "2026-02-09T10:00:00+01:00" "buildlog: log endpoint + build page panel"

# --- ci-tail CLI
cat > cli/tail.js <<'EOF'
'use strict';
// ci-tail <job> [--resume]: follow a job log in the terminal.
// Progress is saved to a state file after every poll so that a dropped SSH session can carry on with
// --resume without reprinting what is already on screen.
const fs = require('fs');

class Tail {
  constructor({ transport, jobId, out, statePath, resume = false }) {
    Object.assign(this, { transport, jobId, out, statePath });
    this.printed = 0; // characters of the log already written to `out`
    if (resume && fs.existsSync(statePath)) {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (s.jobId === jobId) this.printed = s.printed;
    }
  }

  async poll() {
    const res = await this.transport({ method: 'GET', url: `/api/jobs/${this.jobId}/log`, headers: {} });
    if (res.status !== 200) throw new Error(`ci-tail: HTTP ${res.status}`);
    let text = new TextDecoder().decode(res.body);
    // The runner's writes can end in the middle of a UTF-8 character; don't print the partial one yet.
    if (text.endsWith('�')) text = text.slice(0, -1);
    this.out.write(text.slice(this.printed));
    this.printed = text.length;
    fs.writeFileSync(this.statePath, JSON.stringify({ jobId: this.jobId, printed: this.printed }));
    return res.headers['x-job-state'];
  }
}

module.exports = { Tail };
EOF
cat > cli/transport.js <<'EOF'
'use strict';
// fetch-based transport with the same shape as an in-process handler.
function fetchTransport(baseUrl) {
  return async (req) => {
    const r = await fetch(baseUrl + req.url, { method: req.method, headers: req.headers });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: new Uint8Array(await r.arrayBuffer()) };
  };
}

module.exports = { fetchTransport };
EOF
cat > bin/ci-tail <<'EOF'
#!/usr/bin/env node
'use strict';
const os = require('os');
const path = require('path');
const { Tail } = require('../cli/tail');
const { fetchTransport } = require('../cli/transport');

const [jobId, ...flags] = process.argv.slice(2);
if (!jobId) {
  console.error('usage: ci-tail <job> [--resume]');
  process.exit(2);
}
const tail = new Tail({
  transport: fetchTransport(process.env.BUILDLOG_URL || 'https://buildlog.internal'),
  jobId,
  out: process.stdout,
  statePath: path.join(os.homedir(), '.ci-tail.json'),
  resume: flags.includes('--resume'),
});
(async function loop() {
  const state = await tail.poll();
  if (state === 'running') setTimeout(loop, 2000);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
EOF
chmod +x bin/ci-tail
cat > test/tail.test.js <<'EOF'
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LogStore } = require('../src/logstore');
const { Jobs } = require('../src/jobs');
const { createServer } = require('../src/server');
const { Tail } = require('../cli/tail');

function setup() {
  const store = new LogStore();
  const jobs = new Jobs(store);
  jobs.create('j1');
  const out = { data: '', write(s) { this.data += s; } };
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-tail-')), 'state.json');
  return { store, jobs, out, statePath, handle: createServer({ store, jobs }) };
}

test('prints only new output', async () => {
  const { store, out, statePath, handle } = setup();
  const t = new Tail({ transport: handle, jobId: 'j1', out, statePath });
  store.append('j1', 'a\n');
  await t.poll();
  store.append('j1', 'b\n');
  await t.poll();
  assert.equal(out.data, 'a\nb\n');
});

test('--resume does not reprint', async () => {
  const { store, out, statePath, handle } = setup();
  store.append('j1', 'a\n');
  await new Tail({ transport: handle, jobId: 'j1', out, statePath }).poll();
  store.append('j1', 'b\n');
  await new Tail({ transport: handle, jobId: 'j1', out, statePath, resume: true }).poll();
  assert.equal(out.data, 'a\nb\n');
});

test('holds back a split character until it is complete', async () => {
  const { store, out, statePath, handle } = setup();
  const t = new Tail({ transport: handle, jobId: 'j1', out, statePath });
  const bytes = Buffer.from('ok ✓\n');
  store.append('j1', bytes.subarray(0, 4));
  await t.poll();
  store.append('j1', bytes.subarray(4));
  await t.poll();
  assert.equal(out.data, 'ok ✓\n');
});
EOF
cat >> docs/API.md <<'EOF'
Also used by `ci-tail` (cli/tail.js), which follows a log in the terminal and can `--resume` after a disconnect.
EOF
cat >> CHANGELOG.md <<'EOF'

## 1.2.0
- `ci-tail` CLI with `--resume`.
EOF
commit "2026-04-14T16:20:00+02:00" "ci-tail: follow logs from the terminal, --resume after disconnect"

# --- retries reuse the log file
cat > src/jobs.js <<'EOF'
'use strict';

class Jobs {
  constructor(store) {
    this.store = store;
    this.jobs = new Map();
  }

  create(id) {
    const job = { id, state: 'running', attempt: 1 };
    this.jobs.set(id, job);
    this.store.truncate(id);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  // Same id, same log file: the runner truncates it and writes the new attempt from scratch.
  retry(id) {
    const job = this.jobs.get(id);
    job.attempt += 1;
    job.state = 'running';
    this.store.truncate(id);
    return job;
  }

  finish(id, state = 'passed') {
    this.jobs.get(id).state = state;
  }
}

module.exports = { Jobs };
EOF
sed -i.bak "s#headers: { 'content-type': 'text/plain; charset=utf-8', 'x-job-state': job.state },#headers: {\n          'content-type': 'text/plain; charset=utf-8',\n          'x-job-state': job.state,\n          'x-job-attempt': String(job.attempt),\n        },#" src/server.js && rm src/server.js.bak
cat > cli/tail.js <<'EOF'
'use strict';
// ci-tail <job> [--resume]: follow a job log in the terminal.
// Progress is saved to a state file after every poll so that a dropped SSH session can carry on with
// --resume without reprinting what is already on screen.
const fs = require('fs');

class Tail {
  constructor({ transport, jobId, out, statePath, resume = false }) {
    Object.assign(this, { transport, jobId, out, statePath });
    this.attempt = null;
    this.printed = 0; // characters of the current attempt's log already written to `out`
    if (resume && fs.existsSync(statePath)) {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (s.jobId === jobId) {
        this.attempt = s.attempt;
        this.printed = s.printed;
      }
    }
  }

  async poll() {
    const res = await this.transport({ method: 'GET', url: `/api/jobs/${this.jobId}/log`, headers: {} });
    if (res.status !== 200) throw new Error(`ci-tail: HTTP ${res.status}`);
    const attempt = Number(res.headers['x-job-attempt']);
    if (this.attempt !== null && attempt !== this.attempt) {
      this.out.write(`\n--- retry: attempt ${attempt} ---\n`);
      this.printed = 0;
    }
    this.attempt = attempt;
    let text = new TextDecoder().decode(res.body);
    // The runner's writes can end in the middle of a UTF-8 character; don't print the partial one yet.
    if (text.endsWith('�')) text = text.slice(0, -1);
    this.out.write(text.slice(this.printed));
    this.printed = text.length;
    fs.writeFileSync(this.statePath, JSON.stringify({ jobId: this.jobId, attempt: this.attempt, printed: this.printed }));
    return res.headers['x-job-state'];
  }
}

module.exports = { Tail };
EOF
cat >> test/tail.test.js <<'EOF'

test('a retry starts over with a banner', async () => {
  const { store, jobs, out, statePath, handle } = setup();
  const t = new Tail({ transport: handle, jobId: 'j1', out, statePath });
  store.append('j1', 'first try\n');
  await t.poll();
  jobs.retry('j1');
  store.append('j1', 'second\n');
  await t.poll();
  assert.equal(out.data, 'first try\n\n--- retry: attempt 2 ---\nsecond\n');
});
EOF
sed -i.bak 's#^Header `x-job-state` carries the job state so pollers know when to stop.#Header `x-job-state` carries the job state so pollers know when to stop, `x-job-attempt` the attempt\nnumber (a retry rewrites the log from the start, see docs/RUNNER.md).#' docs/API.md && rm docs/API.md.bak
cat >> CHANGELOG.md <<'EOF'

## 1.4.0
- Retries reuse the job id; `x-job-attempt` header; ci-tail prints a banner and starts over.
EOF
commit "2026-06-23T11:45:00+02:00" "retries: x-job-attempt, ci-tail restarts on a new attempt"

# --- nightly archiver + replay sim
cat > scripts/archive-logs.js <<'EOF'
'use strict';
// Nightly: copies finished job logs to cold storage (archive/<job>.log). Support's "download full log"
// button calls the same function. Must store the complete log, byte for byte as the runner wrote it.
const fs = require('fs');
const path = require('path');

async function archiveJob({ transport, jobId, outDir }) {
  const res = await transport({ method: 'GET', url: `/api/jobs/${jobId}/log`, headers: {} });
  if (res.status !== 200) throw new Error(`archive ${jobId}: HTTP ${res.status}`);
  const body = Buffer.from(res.body);
  if (outDir) fs.writeFileSync(path.join(outDir, `${jobId}.log`), body);
  return body;
}

module.exports = { archiveJob };

if (require.main === module) {
  const { fetchTransport } = require('../cli/transport');
  const outDir = path.join(__dirname, '..', 'archive');
  fs.mkdirSync(outDir, { recursive: true });
  const transport = fetchTransport(process.env.BUILDLOG_URL || 'https://buildlog.internal');
  Promise.all(process.argv.slice(2).map((jobId) => archiveJob({ transport, jobId, outDir }))).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
EOF
cat > scripts/sim.js <<'EOF'
'use strict';
// Replays a recorded build (job j-4821 from the 2026-09-12 incident: big test log, one retry) through the
// API with every log consumer attached, polling on the same 2 s schedule:
//   - the build page viewer (web/log-viewer.js)
//   - ci-tail (cli/tail.js), whose SSH session drops halfway and comes back with --resume
//   - the nightly archiver (scripts/archive-logs.js) once the job is done
// Checks that each consumer ends up with exactly the log, and measures how much each poller downloads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { LogStore } = require('../src/logstore');
const { Jobs } = require('../src/jobs');
const { createServer } = require('../src/server');
const { LogViewer } = require('../web/log-viewer');
const { Tail } = require('../cli/tail');
const { archiveJob } = require('./archive-logs');

const BUDGET = 3; // a poller should download at most ~3x the log it shows

function buildLog(attempt, lines) {
  const out = [`\x1b[1m── attempt ${attempt}: checkout + install ──\x1b[0m`];
  for (let i = 1; i <= lines; i++) {
    const ms = (i * 37 + attempt * 11) % 900;
    if (i % 50 === 0) out.push(`\x1b[1m── shard ${i / 50} done ──\x1b[0m`);
    else if (i % 17 === 0) out.push(`  \x1b[33m⚠\x1b[0m test ${i} retried once (flaky) — ${ms}ms`);
    else if (i % 29 === 0) out.push(`  🚀 preview ${i} → https://pr-${i}.preview.test`);
    else out.push(`  \x1b[32m✓\x1b[0m test ${i} passed (${ms}ms) · café`);
  }
  return Buffer.from(out.join('\n') + '\n', 'utf8');
}

// Pipe-sized writes: deterministic pseudo-random cut points, which land inside multi-byte characters a lot.
function chunk(buf, n, seed, forceMidCharAt) {
  let x = seed;
  const cuts = new Set();
  while (cuts.size < n - 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    cuts.add(1 + (x % (buf.length - 1)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  if (forceMidCharAt !== undefined) {
    const at = buf.indexOf('✓', sorted[forceMidCharAt]);
    sorted[forceMidCharAt] = at + 1;
    sorted.sort((a, b) => a - b);
  }
  const parts = [];
  let prev = 0;
  for (const c of [...sorted, buf.length]) {
    parts.push(buf.subarray(prev, c));
    prev = c;
  }
  return parts.filter((p) => p.length);
}

function firstDiff(actual, expected) {
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  if (i === actual.length && i === expected.length) return null;
  return `differs at char ${i}: expected ${JSON.stringify(expected.slice(i, i + 24))}, got ${JSON.stringify(actual.slice(i, i + 24))}`;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function main() {
  const store = new LogStore();
  const jobs = new Jobs(store);
  const handle = createServer({ store, jobs });
  const traffic = { viewer: { bytes: 0, requests: 0 }, cli: { bytes: 0, requests: 0 }, archive: { bytes: 0, requests: 0 } };
  const via = (who) => async (req) => {
    const res = await handle(req);
    traffic[who].requests++;
    traffic[who].bytes += typeof res.body === 'string' ? Buffer.byteLength(res.body) : res.body.length;
    return res;
  };

  const jobId = 'j-4821';
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'buildlog-sim-')), 'ci-tail.json');
  const cliOut = { data: '', write(s) { this.data += s; } };
  const attempt1 = buildLog(1, 420);
  const attempt2 = buildLog(2, 640);
  const RECONNECT_AFTER = 11;

  jobs.create(jobId);
  const viewer = new LogViewer({ transport: via('viewer'), jobId, render: () => {} });
  let cli = new Tail({ transport: via('cli'), jobId, out: cliOut, statePath });
  let polls = 0;
  const pollAll = async () => {
    polls++;
    await viewer.poll();
    await cli.poll();
  };

  const parts1 = chunk(attempt1, 24, 7, RECONNECT_AFTER);
  for (let i = 0; i < parts1.length; i++) {
    store.append(jobId, parts1[i]);
    await pollAll();
    if (i === RECONNECT_AFTER) {
      // SSH drops; the user reconnects and runs `ci-tail j-4821 --resume`
      cli = new Tail({ transport: via('cli'), jobId, out: cliOut, statePath, resume: true });
    }
  }

  // flaky infra: the job is retried; the new attempt is chatty right away (install output is cached)
  jobs.retry(jobId);
  const parts2 = chunk(attempt2, 32, 11);
  const burst = 26;
  store.append(jobId, Buffer.concat(parts2.slice(0, burst)));
  await pollAll();
  for (const p of parts2.slice(burst)) {
    store.append(jobId, p);
    await pollAll();
  }
  jobs.finish(jobId, 'passed');
  await pollAll();

  const archived = await archiveJob({ transport: via('archive'), jobId });

  const written = attempt1.length + attempt2.length;
  const expectViewer = attempt2.toString('utf8');
  const expectCli = attempt1.toString('utf8') + '\n--- retry: attempt 2 ---\n' + attempt2.toString('utf8');
  const viewerDiff = firstDiff(viewer.text, expectViewer);
  const cliDiff = firstDiff(cliOut.data, expectCli);
  const archiveOk = Buffer.compare(archived, attempt2) === 0;
  const ratio = (who) => traffic[who].bytes / written;
  const trafficOk = ratio('viewer') <= BUDGET && ratio('cli') <= BUDGET;

  console.log(`sim: job ${jobId}, 2 attempts, 1 ci-tail reconnect, ${polls} polls per poller, ${kb(written)} of log written`);
  console.log(`  viewer   ${viewerDiff ? 'MISMATCH ' + viewerDiff : 'text ok'}`);
  console.log(`           downloaded ${kb(traffic.viewer.bytes)} in ${traffic.viewer.requests} requests (${ratio('viewer').toFixed(1)}x the log)`);
  console.log(`  ci-tail  ${cliDiff ? 'MISMATCH ' + cliDiff : 'output ok'}`);
  console.log(`           downloaded ${kb(traffic.cli.bytes)} in ${traffic.cli.requests} requests (${ratio('cli').toFixed(1)}x the log)`);
  console.log(`  archive  ${archiveOk ? 'ok' : `MISMATCH (${archived.length} bytes, expected ${attempt2.length})`}`);
  const summary = `viewer=${viewerDiff ? 'MISMATCH' : 'ok'} cli=${cliDiff ? 'MISMATCH' : 'ok'} archive=${archiveOk ? 'ok' : 'MISMATCH'} traffic=${trafficOk ? 'ok' : `over-budget(>${BUDGET}x)`}`;
  const digest = crypto.createHash('sha256').update([summary, viewer.text, cliOut.data, archived.toString('base64')].join('\0')).digest('hex').slice(0, 12);
  console.log(`sim: ${summary}; sim digest ${digest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
EOF
sed -i.bak 's#    "test": "node --test test/"#    "test": "node --test test/",\n    "sim": "node scripts/sim.js"#' package.json && rm package.json.bak
cat >> docs/API.md <<'EOF'

The nightly archiver (scripts/archive-logs.js) and support's "download full log" button also use it, and
need the complete log byte for byte.
EOF
cat >> README.md <<'EOF'
    npm run sim    replay the j-4821 build through the API with every log consumer attached
EOF
commit "2026-09-15T09:10:00+02:00" "nightly archiver; sim replaying j-4821 with all log consumers"

# --- uncommitted: Ji-woo's ANSI colour work in the viewer
node -e "
const fs = require('fs');
let s = fs.readFileSync('web/log-viewer.js', 'utf8');
s = s.replace(\"const POLL_MS = 2000;\n\", \"const POLL_MS = 2000;\n\n// WIP colour support: ANSI SGR codes -> spans. TODO: 256-colour codes, bold+colour combos.\nconst ANSI_CLASS = { 1: 'bold', 31: 'red', 32: 'green', 33: 'yellow' };\n\nfunction renderAnsi(text) {\n  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n  let open = 0;\n  return esc(text).replace(/\\\\x1b\\\\[(\\\\d+)m/g, (_, code) => {\n    if (code === '0') {\n      const close = '</span>'.repeat(open);\n      open = 0;\n      return close;\n    }\n    open++;\n    return '<span class=\\\"ansi-' + (ANSI_CLASS[code] || 'other') + '\\\">';\n  });\n}\n\");
s = s.replace('    this.render(this.text);', '    this.render(renderAnsi(this.text));');
s = s.replace('module.exports = { LogViewer, POLL_MS };', 'module.exports = { LogViewer, POLL_MS, renderAnsi };');
fs.writeFileSync('web/log-viewer.js', s);
"
cat > test/ansi.test.js <<'EOF'
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAnsi } = require('../web/log-viewer');

test('colours become spans and html is escaped', () => {
  assert.equal(renderAnsi('\x1b[32m✓\x1b[0m <ok>'), '<span class="ansi-green">✓</span> &lt;ok&gt;');
});
EOF
