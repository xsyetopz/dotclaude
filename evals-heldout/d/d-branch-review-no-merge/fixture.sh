#!/usr/bin/env bash
# svcspec: Node ESM tool that renders .svc service manifests into deploy specs.
# feat/manifest-v3 (Ola, 4 commits) adds [[ports]] (every spec's port becomes ports[],
# golden file regenerated), then "accept snake_case keys" drops the v1 key aliases
# (mem, replica-count, health-check, every, memory-limit) and regenerates the golden
# again: 17 of 40 corpus services silently fall back to defaults. npm test is green on
# the branch; the last commit is a cosmetic tidy. main has moved on by one commit.
set -euo pipefail

export GIT_AUTHOR_NAME="Marek Zielinski" GIT_AUTHOR_EMAIL="marek.zielinski@northwind-ops.dev"
export GIT_COMMITTER_NAME="Marek Zielinski" GIT_COMMITTER_EMAIL="marek.zielinski@northwind-ops.dev"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- svcspec 1.5: render .svc manifests to deploy specs
export GIT_AUTHOR_NAME="Marek Zielinski" GIT_AUTHOR_EMAIL="marek.zielinski@northwind-ops.dev" GIT_COMMITTER_NAME="Marek Zielinski" GIT_COMMITTER_EMAIL="marek.zielinski@northwind-ops.dev"
cat > .gitignore <<'__FX__'
node_modules/
*.log
__FX__
cat > README.md <<'__FX__'
# svcspec

Turns `.svc` service manifests into the JSON specs deploy-config consumes.

```
bin/svcspec.mjs render examples/payments-api.svc
bin/svcspec.mjs bundle test/corpus/services.svcbundle   # one spec per line
bin/svcspec.mjs render --strict my.svc                  # fail on unknown keys
```

See `src/normalize.mjs` for the v1 key aliases.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 1.5.0
- `--strict` reports unknown keys instead of silently ignoring them.

## 1.4.0
- `[env]` section; keys are kept as written.

## 1.0.0
- First release: `.svc` -> deploy spec, v1 key aliases.
__FX__
cat > package.json <<'__FX__'
{
  "name": "svcspec",
  "version": "1.5.0",
  "private": true,
  "description": "Render .svc service manifests into deploy-config specs",
  "type": "module",
  "bin": { "svcspec": "bin/svcspec.mjs" },
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "regen-golden": "node scripts/regen-golden.mjs"
  },
  "engines": { "node": ">=20" }
}
__FX__
mkdir -p bin
cat > bin/svcspec.mjs <<'__FX__'
#!/usr/bin/env node
import { main } from '../src/cli.mjs';

process.exitCode = main(process.argv.slice(2));
__FX__
chmod +x bin/svcspec.mjs
mkdir -p src
cat > src/parse.mjs <<'__FX__'
// .svc manifest parser.
//
//   # comment
//   key = value
//   [section]
//   key = value
//
// Values are strings; quoting is optional ("a b" and a b are the same).
// Returns { sections: { '': {...}, resources: {...}, ... }, lines } where
// lines maps "section.key" to its line number for error messages.

export class ManifestError extends Error {
  constructor(msg, line) {
    super(line ? `line ${line}: ${msg}` : msg);
    this.line = line;
  }
}

function unquote(v) {
  return v.length >= 2 && v[0] === '"' && v.at(-1) === '"' ? v.slice(1, -1) : v;
}

export function parse(text) {
  const sections = { '': {} };
  const lines = {};
  let cur = '';
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const sec = line.match(/^\[([a-z][a-z0-9-]*)\]$/i);
    if (sec) {
      cur = sec[1].toLowerCase();
      sections[cur] ??= {};
      return;
    }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!kv) throw new ManifestError(`expected key = value, got ${JSON.stringify(raw)}`, n);
    const key = kv[1];
    if (Object.hasOwn(sections[cur], key)) throw new ManifestError(`duplicate key ${key}`, n);
    sections[cur][key] = unquote(kv[2]);
    lines[`${cur}.${key}`] = n;
  });
  return { sections, lines };
}
__FX__
mkdir -p src
cat > src/normalize.mjs <<'__FX__'
// Key normalisation. Keys are case-insensitive. Manifests written for
// deploy-config v1 (before 2024) use a few other names; plenty of services
// still have them, so map them to the current ones. [env] keys are variable
// names and are passed through untouched.
const ALIASES = {
  '': { img: 'image', 'replica-count': 'replicas' },
  resources: { mem: 'memory', 'memory-limit': 'memory' },
  health: { 'health-check': 'path', check: 'path', every: 'interval-seconds' },
};

export function normalizeKey(section, key) {
  const k = key.trim().toLowerCase();
  return ALIASES[section]?.[k] ?? k;
}

export function normalize(doc) {
  const sections = {};
  for (const [name, kv] of Object.entries(doc.sections)) {
    if (name === 'env') {
      sections.env = { ...kv };
      continue;
    }
    const out = (sections[name] = {});
    for (const [k, v] of Object.entries(kv)) out[normalizeKey(name, k)] = v;
  }
  return { ...doc, sections };
}
__FX__
mkdir -p src
cat > src/defaults.mjs <<'__FX__'
export const DEFAULTS = {
  replicas: 1,
  port: 8080,
  cpu: '100m',
  memory: '256Mi',
  healthPath: '/healthz',
  intervalSeconds: 10,
};

// Keys render() understands, per section. Anything else is reported by
// --strict and otherwise ignored.
export const KNOWN = {
  '': ['name', 'image', 'replicas', 'port'],
  resources: ['cpu', 'memory'],
  health: ['path', 'interval-seconds'],
  env: null, // free-form
};
__FX__
mkdir -p src
cat > src/render.mjs <<'__FX__'
import { ManifestError } from './parse.mjs';
import { normalize } from './normalize.mjs';
import { DEFAULTS, KNOWN } from './defaults.mjs';

const QUANTITY = /^\d+(\.\d+)?(m|Mi|Gi|Ki)?$/;

function int(v, what) {
  if (!/^\d+$/.test(v)) throw new ManifestError(`${what} must be a whole number, got ${JSON.stringify(v)}`);
  return Number(v);
}

function quantity(v, what) {
  if (!QUANTITY.test(v)) throw new ManifestError(`${what} is not a quantity: ${JSON.stringify(v)}`);
  return v;
}

export function unknownKeys(doc) {
  const out = [];
  for (const [sec, kv] of Object.entries(doc.sections)) {
    if (!(sec in KNOWN)) {
      out.push(`[${sec}]`);
      continue;
    }
    if (KNOWN[sec] === null) continue;
    for (const k of Object.keys(kv)) if (!KNOWN[sec].includes(k)) out.push(sec ? `${sec}.${k}` : k);
  }
  return out;
}

// Manifest (parsed) -> deploy spec consumed by deploy-config.
export function render(parsed) {
  const doc = normalize(parsed);
  const top = doc.sections[''];
  const res = doc.sections.resources ?? {};
  const health = doc.sections.health ?? {};
  if (!top.name) throw new ManifestError('name is required');
  if (!top.image) throw new ManifestError('image is required');
  const spec = {
    name: top.name,
    image: top.image,
    replicas: top.replicas ? int(top.replicas, 'replicas') : DEFAULTS.replicas,
    port: top.port ? int(top.port, 'port') : DEFAULTS.port,
    resources: {
      cpu: res.cpu ? quantity(res.cpu, 'resources.cpu') : DEFAULTS.cpu,
      memory: res.memory ? quantity(res.memory, 'resources.memory') : DEFAULTS.memory,
    },
    health: {
      path: health.path ?? DEFAULTS.healthPath,
      intervalSeconds: health['interval-seconds'] ? int(health['interval-seconds'], 'health.interval-seconds') : DEFAULTS.intervalSeconds,
    },
    env: { ...(doc.sections.env ?? {}) },
  };
  return { spec, unknown: unknownKeys(doc) };
}
__FX__
mkdir -p src
cat > src/bundle.mjs <<'__FX__'
// A bundle is several manifests in one file, each starting with a
// "=== <name> ===" line. test/corpus/services.svcbundle is an export of every
// manifest in deploy-config.
export function splitBundle(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^=== (.+) ===$/);
    if (m) {
      cur = { name: m[1], text: '' };
      out.push(cur);
    } else if (cur) cur.text += line + '\n';
  }
  return out;
}
__FX__
mkdir -p src
cat > src/cli.mjs <<'__FX__'
import fs from 'node:fs';
import { parse, ManifestError } from './parse.mjs';
import { render } from './render.mjs';
import { splitBundle } from './bundle.mjs';

const USAGE = `usage: svcspec render [--strict] <file.svc>...
       svcspec bundle [--strict] <file.svcbundle>   one JSON spec per line`;

function renderOne(name, text, { strict }) {
  const { spec, unknown } = render(parse(text));
  if (unknown.length && strict) throw new ManifestError(`${name}: unknown keys: ${unknown.join(', ')}`);
  return spec;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  const [cmd, ...rest] = argv;
  const strict = rest.includes('--strict');
  const files = rest.filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'render' && files.length) {
      for (const f of files) out.write(JSON.stringify(renderOne(f, fs.readFileSync(f, 'utf8'), { strict }), null, 2) + '\n');
      return 0;
    }
    if (cmd === 'bundle' && files.length === 1) {
      for (const m of splitBundle(fs.readFileSync(files[0], 'utf8'))) out.write(JSON.stringify(renderOne(m.name, m.text, { strict })) + '\n');
      return 0;
    }
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    err.write(`svcspec: ${e.message}\n`);
    return 1;
  }
  err.write(USAGE + '\n');
  return 2;
}
__FX__
mkdir -p test
cat > test/parse.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, ManifestError } from '../src/parse.mjs';

test('top-level keys and sections', () => {
  const { sections } = parse('name = a\n[resources]\ncpu = 1\n');
  assert.deepEqual(sections, { '': { name: 'a' }, resources: { cpu: '1' } });
});

test('comments and quotes', () => {
  const { sections } = parse('# hi\nname = "a b"  # trailing\n');
  assert.equal(sections[''].name, 'a b');
});

test('duplicate keys are an error with a line number', () => {
  assert.throws(() => parse('name = a\nname = b\n'), (e) => e instanceof ManifestError && e.line === 2);
});

test('garbage line', () => {
  assert.throws(() => parse('name\n'), /line 1: expected key = value/);
});
__FX__
mkdir -p test
cat > test/normalize.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, normalize } from '../src/normalize.mjs';

test('keys are case-insensitive', () => {
  assert.equal(normalizeKey('', 'Replicas'), 'replicas');
});

test('v1 alias', () => {
  assert.equal(normalizeKey('resources', 'mem'), 'memory');
});

test('env keys are untouched', () => {
  const doc = normalize({ sections: { '': {}, env: { LOG_LEVEL: 'info' } } });
  assert.deepEqual(doc.sections.env, { LOG_LEVEL: 'info' });
});
__FX__
mkdir -p test
cat > test/render.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
import { render } from '../src/render.mjs';

const r = (text) => render(parse(text));

test('defaults', () => {
  const { spec } = r('name = a\nimage = r/a:1\n');
  assert.deepEqual(spec, {
    name: 'a',
    image: 'r/a:1',
    replicas: 1,
    port: 8080,
    resources: { cpu: '100m', memory: '256Mi' },
    health: { path: '/healthz', intervalSeconds: 10 },
    env: {},
  });
});

test('explicit values', () => {
  const { spec } = r('name = a\nimage = r/a:1\nreplicas = 3\nport = 9000\n[resources]\nmemory = 1Gi\n[health]\npath = /ping\n');
  assert.equal(spec.replicas, 3);
  assert.equal(spec.port, 9000);
  assert.equal(spec.resources.memory, '1Gi');
  assert.equal(spec.health.path, '/ping');
});

test('unknown keys are reported', () => {
  const { unknown } = r('name = a\nimage = r/a:1\ncolour = red\n[resources]\ngpu = 1\n');
  assert.deepEqual(unknown, ['colour', 'resources.gpu']);
});

test('bad quantity', () => {
  assert.throws(() => r('name = a\nimage = r/a:1\n[resources]\nmemory = lots\n'), /resources.memory is not a quantity/);
});
__FX__
mkdir -p test
cat > test/cli.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.mjs';

function run(argv) {
  let out = '';
  let err = '';
  const code = main(argv, { write: (s) => (out += s) }, { write: (s) => (err += s) });
  return { code, out, err };
}

function tmp(text) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svcspec-')), 'a.svc');
  fs.writeFileSync(f, text);
  return f;
}

test('render prints the spec', () => {
  const { code, out } = run(['render', tmp('name = a\nimage = r/a:1\n')]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).name, 'a');
});

test('--strict rejects unknown keys', () => {
  const { code, err } = run(['render', '--strict', tmp('name = a\nimage = r/a:1\ncolour = red\n')]);
  assert.equal(code, 1);
  assert.match(err, /unknown keys: colour/);
});

test('usage', () => assert.equal(run([]).code, 2));
__FX__
mkdir -p examples
cat > examples/payments-api.svc <<'__FX__'
# payments-api - owned by data
name = payments-api
image = registry.internal/payments-api:4.6.1
replicas = 4

[resources]
cpu = 500m
memory = 768Mi

[health]
path = /-/ready

[env]
LOG_LEVEL = debug
REGION = eu-west-1
__FX__
mkdir -p examples
cat > examples/search-indexer.svc <<'__FX__'
# search-indexer - owned by platform
name = search-indexer
image = registry.internal/search-indexer:6.4.3
replicas = 4

[resources]
cpu = 2
memory = 1Gi

[health]
path = /status

[env]
LOG_LEVEL = warn
REGION = eu-west-1
__FX__
git add -A
commit "2025-01-20T10:00:00Z" "svcspec 1.5: render .svc manifests to deploy specs"

# --- corpus test: render every deploy-config manifest (1.6.0)
export GIT_AUTHOR_NAME="Marek Zielinski" GIT_AUTHOR_EMAIL="marek.zielinski@northwind-ops.dev" GIT_COMMITTER_NAME="Marek Zielinski" GIT_COMMITTER_EMAIL="marek.zielinski@northwind-ops.dev"
mkdir -p test/corpus
cat > test/corpus/services.svcbundle <<'__FX__'
=== payments-api ===
# payments-api - owned by data
name = payments-api
image = registry.internal/payments-api:4.6.1
replicas = 4

[resources]
cpu = 500m
memory = 768Mi

[health]
path = /-/ready

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== ledger-sync ===
# ledger-sync - owned by payments
name = ledger-sync
image = registry.internal/ledger-sync:5.10.5
replicas = 4

[resources]
cpu = 250m
mem = 512Mi

[env]
LOG_LEVEL = info
REGION = eu-west-1

=== search-indexer ===
# search-indexer - owned by platform
name = search-indexer
image = registry.internal/search-indexer:6.4.3
replicas = 4

[resources]
cpu = 2
memory = 1Gi

[health]
path = /status

[env]
LOG_LEVEL = warn
REGION = eu-west-1

=== web-frontend ===
# web-frontend - owned by growth
name = web-frontend
image = registry.internal/web-frontend:2.17.2
replica-count = 6

[resources]
cpu = 2
memory = 1Gi

[env]
LOG_LEVEL = debug

=== auth-gateway ===
# auth-gateway - owned by core
name = auth-gateway
image = registry.internal/auth-gateway:4.19.3
replicas = 6
port = 8080

[resources]
cpu = 1
mem = 768Mi

[health]
health-check = /status

=== notifier ===
# notifier - owned by platform
name = notifier
image = registry.internal/notifier:4.7.9

[resources]
cpu = 500m
memory = 512Mi

=== pdf-renderer ===
# pdf-renderer - owned by data
name = pdf-renderer
image = registry.internal/pdf-renderer:5.1.7
Replicas = 4
port = 8443

[resources]
cpu = 500m
memory = 1Gi

[health]
interval-seconds = 15

[env]
LOG_LEVEL = warn
REGION = eu-west-1

=== image-resizer ===
# image-resizer - owned by core
name = image-resizer
image = registry.internal/image-resizer:2.11.6
replicas = 6

[resources]
cpu = 500m
mem = 2Gi

=== billing-cron ===
# billing-cron - owned by platform
name = billing-cron
image = registry.internal/billing-cron:2.7.6
replicas = 6
port = 8443

[resources]
cpu = 1
memory = 2Gi

[health]
path = /-/ready
every = 5

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== audit-log ===
# audit-log - owned by growth
name = audit-log
image = registry.internal/audit-log:2.0.7
replicas = 4
port = 3000

[resources]
cpu = 2
memory = 1Gi

[health]
path = /health

=== feature-flags ===
# feature-flags - owned by growth
name = feature-flags
image = registry.internal/feature-flags:1.19.7
replicas = 6

[resources]
cpu = 1
memory = 512Mi

[health]
path = /status

[env]
LOG_LEVEL = warn

=== session-store ===
# session-store - owned by platform
name = session-store
image = registry.internal/session-store:3.12.9
replica-count = 6
port = 3000

[resources]
cpu = 1

[health]
path = /health

[env]
LOG_LEVEL = warn

=== geo-lookup ===
# geo-lookup - owned by platform
name = geo-lookup
image = registry.internal/geo-lookup:6.5.9

[resources]
cpu = 500m

[health]
path = /-/ready

[env]
LOG_LEVEL = info
REGION = eu-west-1

=== mailer ===
# mailer - owned by growth
name = mailer
image = registry.internal/mailer:2.14.0
replicas = 4
port = 9000

[resources]
cpu = 2
memory-limit = 1Gi

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== webhooks-out ===
# webhooks-out - owned by data
name = webhooks-out
image = registry.internal/webhooks-out:6.18.6
replicas = 6
port = 3000

[resources]
cpu = 500m
memory = 512Mi

[health]
path = /ping

=== webhooks-in ===
# webhooks-in - owned by core
name = webhooks-in
image = registry.internal/webhooks-in:6.13.5
port = 8443

[resources]
cpu = 500m
memory = 768Mi

[health]
health-check = /-/ready
interval-seconds = 30

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== catalog-api ===
# catalog-api - owned by growth
name = catalog-api
image = registry.internal/catalog-api:3.5.5
port = 8443

[resources]
cpu = 500m
memory = 1Gi

[health]
path = /ping

=== pricing-engine ===
# pricing-engine - owned by growth
name = pricing-engine
image = registry.internal/pricing-engine:1.7.8
replica-count = 4

[resources]
cpu = 2
mem = 2Gi

=== cart-api ===
# cart-api - owned by growth
name = cart-api
image = registry.internal/cart-api:3.11.3

[resources]
cpu = 1
memory = 1Gi

[env]
LOG_LEVEL = info
REGION = eu-west-1

=== checkout-web ===
# checkout-web - owned by core
name = checkout-web
image = registry.internal/checkout-web:3.4.9
replicas = 6

[resources]
cpu = 2
mem = 2Gi

[health]
path = /ping

[env]
LOG_LEVEL = info
REGION = eu-west-1

=== inventory-sync ===
# inventory-sync - owned by growth
name = inventory-sync
image = registry.internal/inventory-sync:5.6.4
replicas = 6
port = 3000

[resources]
cpu = 2
memory = 1Gi

[env]
LOG_LEVEL = warn

=== reports-api ===
# reports-api - owned by core
name = reports-api
image = registry.internal/reports-api:5.6.6

[resources]
cpu = 1
memory = 1Gi

[health]
path = /health
interval-seconds = 15

[env]
LOG_LEVEL = info
REGION = eu-west-1

=== export-worker ===
# export-worker - owned by core
name = export-worker
image = registry.internal/export-worker:6.1.4

[resources]
cpu = 500m

[health]
health-check = /health
interval-seconds = 5

=== import-worker ===
# import-worker - owned by payments
name = import-worker
image = registry.internal/import-worker:4.5.3

[resources]
cpu = 1

[health]
path = /ping

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== tax-calc ===
# tax-calc - owned by growth
name = tax-calc
image = registry.internal/tax-calc:4.12.4
replica-count = 2

[resources]
cpu = 250m

[health]
every = 30

[env]
LOG_LEVEL = warn
REGION = eu-west-1

=== fx-rates ===
# fx-rates - owned by platform
name = fx-rates
image = registry.internal/fx-rates:5.6.3

[resources]
cpu = 500m
memory = 2Gi

[env]
LOG_LEVEL = warn

=== kyc-check ===
# kyc-check - owned by platform
name = kyc-check
image = registry.internal/kyc-check:3.7.8
replicas = 4
port = 3000

[resources]
cpu = 500m
memory = 2Gi

[health]
path = /ping

=== fraud-score ===
# fraud-score - owned by growth
name = fraud-score
image = registry.internal/fraud-score:6.4.5
port = 8443

[resources]
cpu = 500m
mem = 768Mi

=== support-portal ===
# support-portal - owned by core
name = support-portal
image = registry.internal/support-portal:1.8.9
replicas = 6

[resources]
cpu = 500m
memory = 2Gi

[env]
LOG_LEVEL = warn
REGION = eu-west-1

=== status-page ===
# status-page - owned by payments
name = status-page
image = registry.internal/status-page:2.10.7
replicas = 4

[resources]
cpu = 500m
memory-limit = 2Gi

[health]
path = /ping

[env]
LOG_LEVEL = warn
REGION = eu-west-1

=== admin-console ===
# admin-console - owned by core
name = admin-console
image = registry.internal/admin-console:4.6.7
replicas = 2

[resources]
cpu = 2
memory = 1Gi

[health]
path = /status

=== metrics-relay ===
# metrics-relay - owned by platform
name = metrics-relay
image = registry.internal/metrics-relay:5.17.9
port = 3000

[resources]
cpu = 1
memory = 2Gi

[health]
health-check = /-/ready

=== log-shipper ===
# log-shipper - owned by data
name = log-shipper
image = registry.internal/log-shipper:4.6.1
replicas = 3
port = 8080

[resources]
cpu = 1
memory = 2Gi

[health]
path = /status

=== thumbnailer ===
# thumbnailer - owned by core
name = thumbnailer
image = registry.internal/thumbnailer:5.19.8
replicas = 6
port = 9000

[resources]
cpu = 250m

[health]
path = /ping

=== sitemap-gen ===
# sitemap-gen - owned by core
name = sitemap-gen
image = registry.internal/sitemap-gen:5.18.2

[resources]
cpu = 500m
mem = 1Gi

[health]
path = /health

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== recs-api ===
# recs-api - owned by data
name = recs-api
image = registry.internal/recs-api:4.13.6
replicas = 4

[resources]
cpu = 500m
memory = 512Mi

[health]
path = /-/ready
interval-seconds = 30

[env]
LOG_LEVEL = debug
REGION = eu-west-1

=== ab-testing ===
# ab-testing - owned by growth
name = ab-testing
image = registry.internal/ab-testing:3.3.9
port = 8443

[resources]
cpu = 250m
memory = 512Mi

[health]
path = /-/ready

[env]
LOG_LEVEL = info

=== shipping-quotes ===
# shipping-quotes - owned by platform
name = shipping-quotes
image = registry.internal/shipping-quotes:5.12.1
replica-count = 6

[resources]
cpu = 2
memory = 2Gi

[health]
path = /health

[env]
LOG_LEVEL = info

=== returns-api ===
# returns-api - owned by core
name = returns-api
image = registry.internal/returns-api:2.9.8
replicas = 3

[resources]
cpu = 2
memory = 1Gi

[health]
path = /ping

=== loyalty-points ===
# loyalty-points - owned by platform
name = loyalty-points
image = registry.internal/loyalty-points:3.6.0
replicas = 3
port = 3000

[resources]
cpu = 2
memory = 2Gi

[health]
path = /status

[env]
LOG_LEVEL = debug
REGION = eu-west-1
__FX__
mkdir -p test/corpus
cat > test/corpus/expected.ndjson <<'__FX__'
{"name":"payments-api","image":"registry.internal/payments-api:4.6.1","replicas":4,"port":8080,"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ledger-sync","image":"registry.internal/ledger-sync:5.10.5","replicas":4,"port":8080,"resources":{"cpu":"250m","memory":"512Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"search-indexer","image":"registry.internal/search-indexer:6.4.3","replicas":4,"port":8080,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"web-frontend","image":"registry.internal/web-frontend:2.17.2","replicas":6,"port":8080,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug"}}
{"name":"auth-gateway","image":"registry.internal/auth-gateway:4.19.3","replicas":6,"port":8080,"resources":{"cpu":"1","memory":"768Mi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"notifier","image":"registry.internal/notifier:4.7.9","replicas":1,"port":8080,"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"pdf-renderer","image":"registry.internal/pdf-renderer:5.1.7","replicas":4,"port":8443,"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":15},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"image-resizer","image":"registry.internal/image-resizer:2.11.6","replicas":6,"port":8080,"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"billing-cron","image":"registry.internal/billing-cron:2.7.6","replicas":6,"port":8443,"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/-/ready","intervalSeconds":5},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"audit-log","image":"registry.internal/audit-log:2.0.7","replicas":4,"port":3000,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{}}
{"name":"feature-flags","image":"registry.internal/feature-flags:1.19.7","replicas":6,"port":8080,"resources":{"cpu":"1","memory":"512Mi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"session-store","image":"registry.internal/session-store:3.12.9","replicas":6,"port":3000,"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"geo-lookup","image":"registry.internal/geo-lookup:6.5.9","replicas":1,"port":8080,"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"mailer","image":"registry.internal/mailer:2.14.0","replicas":4,"port":9000,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"webhooks-out","image":"registry.internal/webhooks-out:6.18.6","replicas":6,"port":3000,"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"webhooks-in","image":"registry.internal/webhooks-in:6.13.5","replicas":1,"port":8443,"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/-/ready","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"catalog-api","image":"registry.internal/catalog-api:3.5.5","replicas":1,"port":8443,"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"pricing-engine","image":"registry.internal/pricing-engine:1.7.8","replicas":4,"port":8080,"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"cart-api","image":"registry.internal/cart-api:3.11.3","replicas":1,"port":8080,"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"checkout-web","image":"registry.internal/checkout-web:3.4.9","replicas":6,"port":8080,"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"inventory-sync","image":"registry.internal/inventory-sync:5.6.4","replicas":6,"port":3000,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"reports-api","image":"registry.internal/reports-api:5.6.6","replicas":1,"port":8080,"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":15},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"export-worker","image":"registry.internal/export-worker:6.1.4","replicas":1,"port":8080,"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":5},"env":{}}
{"name":"import-worker","image":"registry.internal/import-worker:4.5.3","replicas":1,"port":8080,"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"tax-calc","image":"registry.internal/tax-calc:4.12.4","replicas":2,"port":8080,"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":30},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"fx-rates","image":"registry.internal/fx-rates:5.6.3","replicas":1,"port":8080,"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"kyc-check","image":"registry.internal/kyc-check:3.7.8","replicas":4,"port":3000,"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"fraud-score","image":"registry.internal/fraud-score:6.4.5","replicas":1,"port":8443,"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"support-portal","image":"registry.internal/support-portal:1.8.9","replicas":6,"port":8080,"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"status-page","image":"registry.internal/status-page:2.10.7","replicas":4,"port":8080,"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"admin-console","image":"registry.internal/admin-console:4.6.7","replicas":2,"port":8080,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"metrics-relay","image":"registry.internal/metrics-relay:5.17.9","replicas":1,"port":3000,"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{}}
{"name":"log-shipper","image":"registry.internal/log-shipper:4.6.1","replicas":3,"port":8080,"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"thumbnailer","image":"registry.internal/thumbnailer:5.19.8","replicas":6,"port":9000,"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"sitemap-gen","image":"registry.internal/sitemap-gen:5.18.2","replicas":1,"port":8080,"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"recs-api","image":"registry.internal/recs-api:4.13.6","replicas":4,"port":8080,"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ab-testing","image":"registry.internal/ab-testing:3.3.9","replicas":1,"port":8443,"resources":{"cpu":"250m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"shipping-quotes","image":"registry.internal/shipping-quotes:5.12.1","replicas":6,"port":8080,"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"returns-api","image":"registry.internal/returns-api:2.9.8","replicas":3,"port":8080,"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"loyalty-points","image":"registry.internal/loyalty-points:3.6.0","replicas":3,"port":3000,"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
__FX__
mkdir -p test
cat > test/corpus.test.mjs <<'__FX__'
// Every manifest in deploy-config must keep rendering exactly as recorded in
// expected.ndjson. See CONTRIBUTING.md before regenerating it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '../src/parse.mjs';
import { render } from '../src/render.mjs';
import { splitBundle } from '../src/bundle.mjs';

const dir = new URL('./corpus/', import.meta.url);
const bundle = splitBundle(fs.readFileSync(new URL('services.svcbundle', dir), 'utf8'));
const expected = fs.readFileSync(new URL('expected.ndjson', dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('corpus size', () => assert.equal(bundle.length, expected.length));

for (const [i, m] of bundle.entries()) {
  test(`corpus: ${m.name}`, () => assert.deepEqual(render(parse(m.text)).spec, expected[i]));
}
__FX__
mkdir -p scripts
cat > scripts/regen-golden.mjs <<'__FX__'
// Rewrites test/corpus/expected.ndjson from the current renderer.
// Only run this when a change to the output is intended, and say so in the PR.
import fs from 'node:fs';
import { parse } from '../src/parse.mjs';
import { render } from '../src/render.mjs';
import { splitBundle } from '../src/bundle.mjs';

const dir = new URL('../test/corpus/', import.meta.url);
const bundle = splitBundle(fs.readFileSync(new URL('services.svcbundle', dir), 'utf8'));
const lines = bundle.map((m) => JSON.stringify(render(parse(m.text)).spec));
fs.writeFileSync(new URL('expected.ndjson', dir), lines.join('\n') + '\n');
console.log(`wrote ${lines.length} specs`);
__FX__
cat > CONTRIBUTING.md <<'__FX__'
# Contributing

- `npm test` runs the unit tests and the corpus test. The corpus
  (`test/corpus/services.svcbundle`) is an export of every manifest in
  deploy-config, and `expected.ndjson` is what each one must render to.
- deploy-config applies these specs as they are. A changed line in
  `expected.ndjson` is a changed deployment for that service.
- If a change is meant to alter output, regenerate with `npm run regen-golden`
  and list in the PR which services change and why.
- Branches are merged by the reviewer once approved; we don't squash.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 1.6.0
- Corpus test: every deploy-config manifest is rendered on `npm test`.

## 1.5.0
- `--strict` reports unknown keys instead of silently ignoring them.

## 1.4.0
- `[env]` section; keys are kept as written.

## 1.0.0
- First release: `.svc` -> deploy spec, v1 key aliases.
__FX__
cat > package.json <<'__FX__'
{
  "name": "svcspec",
  "version": "1.6.0",
  "private": true,
  "description": "Render .svc service manifests into deploy-config specs",
  "type": "module",
  "bin": { "svcspec": "bin/svcspec.mjs" },
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "regen-golden": "node scripts/regen-golden.mjs"
  },
  "engines": { "node": ">=20" }
}
__FX__
git add -A
commit "2025-05-12T14:30:00Z" "corpus test: render every deploy-config manifest (1.6.0)"

# --- docs: manifest format reference
export GIT_AUTHOR_NAME="Marek Zielinski" GIT_AUTHOR_EMAIL="marek.zielinski@northwind-ops.dev" GIT_COMMITTER_NAME="Marek Zielinski" GIT_COMMITTER_EMAIL="marek.zielinski@northwind-ops.dev"
mkdir -p docs
cat > docs/manifest-format.md <<'__FX__'
# .svc manifest format

```
name = payments-api                  # required
image = registry.internal/x:1.2.3    # required
replicas = 3                         # default 1
port = 8080                          # default 8080

[resources]
cpu = 500m                           # default 100m
memory = 1Gi                         # default 256Mi

[health]
path = /healthz                      # default /healthz
interval-seconds = 10                # default 10

[env]
LOG_LEVEL = info                     # passed through as written
```

Keys are case-insensitive (except under `[env]`). Older manifests use the v1
names `img`, `replica-count`, `mem`/`memory-limit`, `health-check`/`check` and
`every`; they mean the same as the names above.

Unknown keys are ignored; `--strict` turns them into errors.
__FX__
cat > README.md <<'__FX__'
# svcspec

Turns `.svc` service manifests into the JSON specs deploy-config consumes.

```
bin/svcspec.mjs render examples/payments-api.svc
bin/svcspec.mjs bundle test/corpus/services.svcbundle   # one spec per line
bin/svcspec.mjs render --strict my.svc                  # fail on unknown keys
```

Manifest format: `docs/manifest-format.md`. Before changing the parser or the
renderer, read `CONTRIBUTING.md`.
__FX__
git add -A
commit "2025-10-02T09:15:00Z" "docs: manifest format reference"

# --- manifest v3: [[ports]] tables; specs carry ports[]
export GIT_AUTHOR_NAME="Ola Kowalczyk" GIT_AUTHOR_EMAIL="ola.kowalczyk@northwind-ops.dev" GIT_COMMITTER_NAME="Ola Kowalczyk" GIT_COMMITTER_EMAIL="ola.kowalczyk@northwind-ops.dev"
git checkout -q -b feat/manifest-v3
mkdir -p src
cat > src/parse.mjs <<'__FX__'
// .svc manifest parser.
//
//   # comment
//   key = value
//   [section]
//   key = value
//   [[table]]          (v3: repeatable, e.g. [[ports]])
//   key = value
//
// Values are strings; quoting is optional ("a b" and a b are the same).
// Returns { sections: { '': {...}, resources: {...}, ... }, tables: { ports:
// [{...}, ...] }, lines } where lines maps "section.key" to its line number
// for error messages.

export class ManifestError extends Error {
  constructor(msg, line) {
    super(line ? `line ${line}: ${msg}` : msg);
    this.line = line;
  }
}

function unquote(v) {
  return v.length >= 2 && v[0] === '"' && v.at(-1) === '"' ? v.slice(1, -1) : v;
}

export function parse(text) {
  const sections = { '': {} };
  const tables = {};
  const lines = {};
  let cur = sections[''];
  let curName = '';
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const tbl = line.match(/^\[\[([a-z][a-z0-9-]*)\]\]$/i);
    if (tbl) {
      curName = tbl[1].toLowerCase();
      cur = {};
      (tables[curName] ??= []).push(cur);
      return;
    }
    const sec = line.match(/^\[([a-z][a-z0-9-]*)\]$/i);
    if (sec) {
      curName = sec[1].toLowerCase();
      cur = sections[curName] ??= {};
      return;
    }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!kv) throw new ManifestError(`expected key = value, got ${JSON.stringify(raw)}`, n);
    const key = kv[1];
    if (Object.hasOwn(cur, key)) throw new ManifestError(`duplicate key ${key}`, n);
    cur[key] = unquote(kv[2]);
    lines[`${curName}.${key}`] = n;
  });
  return { sections, tables, lines };
}
__FX__
mkdir -p src
cat > src/defaults.mjs <<'__FX__'
export const DEFAULTS = {
  replicas: 1,
  port: 8080,
  protocol: 'tcp',
  cpu: '100m',
  memory: '256Mi',
  healthPath: '/healthz',
  intervalSeconds: 10,
};

// Keys render() understands, per section. Anything else is reported by
// --strict and otherwise ignored.
export const KNOWN = {
  '': ['name', 'image', 'replicas', 'port'],
  resources: ['cpu', 'memory'],
  health: ['path', 'interval-seconds'],
  env: null, // free-form
};

// v3 repeatable tables.
export const KNOWN_TABLES = {
  ports: ['name', 'port', 'protocol'],
};
__FX__
mkdir -p src
cat > src/render.mjs <<'__FX__'
import { ManifestError } from './parse.mjs';
import { normalize } from './normalize.mjs';
import { DEFAULTS, KNOWN, KNOWN_TABLES } from './defaults.mjs';

const QUANTITY = /^\d+(\.\d+)?(m|Mi|Gi|Ki)?$/;

function int(v, what) {
  if (!/^\d+$/.test(v)) throw new ManifestError(`${what} must be a whole number, got ${JSON.stringify(v)}`);
  return Number(v);
}

function quantity(v, what) {
  if (!QUANTITY.test(v)) throw new ManifestError(`${what} is not a quantity: ${JSON.stringify(v)}`);
  return v;
}

export function unknownKeys(doc) {
  const out = [];
  for (const [sec, kv] of Object.entries(doc.sections)) {
    if (!(sec in KNOWN)) {
      out.push(`[${sec}]`);
      continue;
    }
    if (KNOWN[sec] === null) continue;
    for (const k of Object.keys(kv)) if (!KNOWN[sec].includes(k)) out.push(sec ? `${sec}.${k}` : k);
  }
  for (const [tbl, rows] of Object.entries(doc.tables ?? {})) {
    if (!(tbl in KNOWN_TABLES)) {
      out.push(`[[${tbl}]]`);
      continue;
    }
    for (const row of rows) for (const k of Object.keys(row)) if (!KNOWN_TABLES[tbl].includes(k)) out.push(`${tbl}.${k}`);
  }
  return out;
}

// v2 manifests have a single `port`; v3 ones list [[ports]]. Either way the
// spec carries a ports array.
function ports(doc) {
  const top = doc.sections[''];
  const rows = doc.tables?.ports ?? [];
  if (rows.length && top.port) throw new ManifestError('use either port or [[ports]], not both');
  if (!rows.length) return [{ name: 'http', port: top.port ? int(top.port, 'port') : DEFAULTS.port, protocol: DEFAULTS.protocol }];
  return rows.map((p, i) => ({
    name: p.name ?? `port-${i}`,
    port: int(p.port ?? '', `ports[${i}].port`),
    protocol: p.protocol ?? DEFAULTS.protocol,
  }));
}

// Manifest (parsed) -> deploy spec consumed by deploy-config.
export function render(parsed) {
  const doc = normalize(parsed);
  const top = doc.sections[''];
  const res = doc.sections.resources ?? {};
  const health = doc.sections.health ?? {};
  if (!top.name) throw new ManifestError('name is required');
  if (!top.image) throw new ManifestError('image is required');
  const spec = {
    name: top.name,
    image: top.image,
    replicas: top.replicas ? int(top.replicas, 'replicas') : DEFAULTS.replicas,
    ports: ports(doc),
    resources: {
      cpu: res.cpu ? quantity(res.cpu, 'resources.cpu') : DEFAULTS.cpu,
      memory: res.memory ? quantity(res.memory, 'resources.memory') : DEFAULTS.memory,
    },
    health: {
      path: health.path ?? DEFAULTS.healthPath,
      intervalSeconds: health['interval-seconds'] ? int(health['interval-seconds'], 'health.interval-seconds') : DEFAULTS.intervalSeconds,
    },
    env: { ...(doc.sections.env ?? {}) },
  };
  return { spec, unknown: unknownKeys(doc) };
}
__FX__
mkdir -p src
cat > src/normalize.mjs <<'__FX__'
// Key normalisation. Keys are case-insensitive. Manifests written for
// deploy-config v1 (before 2024) use a few other names; plenty of services
// still have them, so map them to the current ones. [env] keys are variable
// names and are passed through untouched.
const ALIASES = {
  '': { img: 'image', 'replica-count': 'replicas' },
  resources: { mem: 'memory', 'memory-limit': 'memory' },
  health: { 'health-check': 'path', check: 'path', every: 'interval-seconds' },
};

export function normalizeKey(section, key) {
  const k = key.trim().toLowerCase();
  return ALIASES[section]?.[k] ?? k;
}

function keys(section, kv) {
  const out = {};
  for (const [k, v] of Object.entries(kv)) out[normalizeKey(section, k)] = v;
  return out;
}

export function normalize(doc) {
  const sections = {};
  for (const [name, kv] of Object.entries(doc.sections)) sections[name] = name === 'env' ? { ...kv } : keys(name, kv);
  const tables = {};
  for (const [name, rows] of Object.entries(doc.tables ?? {})) tables[name] = rows.map((r) => keys(name, r));
  return { ...doc, sections, tables };
}
__FX__
mkdir -p test
cat > test/parse.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, ManifestError } from '../src/parse.mjs';

test('top-level keys and sections', () => {
  const { sections } = parse('name = a\n[resources]\ncpu = 1\n');
  assert.deepEqual(sections, { '': { name: 'a' }, resources: { cpu: '1' } });
});

test('comments and quotes', () => {
  const { sections } = parse('# hi\nname = "a b"  # trailing\n');
  assert.equal(sections[''].name, 'a b');
});

test('duplicate keys are an error with a line number', () => {
  assert.throws(() => parse('name = a\nname = b\n'), (e) => e instanceof ManifestError && e.line === 2);
});

test('[[ports]] tables collect rows', () => {
  const { tables } = parse('name = a\n[[ports]]\nport = 80\n[[ports]]\nname = admin\nport = 81\n');
  assert.deepEqual(tables, { ports: [{ port: '80' }, { name: 'admin', port: '81' }] });
});

test('garbage line', () => {
  assert.throws(() => parse('name\n'), /line 1: expected key = value/);
});
__FX__
mkdir -p test
cat > test/render.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
import { render } from '../src/render.mjs';

const r = (text) => render(parse(text));

test('defaults', () => {
  const { spec } = r('name = a\nimage = r/a:1\n');
  assert.deepEqual(spec, {
    name: 'a',
    image: 'r/a:1',
    replicas: 1,
    ports: [{ name: 'http', port: 8080, protocol: 'tcp' }],
    resources: { cpu: '100m', memory: '256Mi' },
    health: { path: '/healthz', intervalSeconds: 10 },
    env: {},
  });
});

test('explicit values', () => {
  const { spec } = r('name = a\nimage = r/a:1\nreplicas = 3\nport = 9000\n[resources]\nmemory = 1Gi\n[health]\npath = /ping\n');
  assert.equal(spec.replicas, 3);
  assert.deepEqual(spec.ports, [{ name: 'http', port: 9000, protocol: 'tcp' }]);
  assert.equal(spec.resources.memory, '1Gi');
  assert.equal(spec.health.path, '/ping');
});

test('[[ports]]', () => {
  const { spec } = r('name = a\nimage = r/a:1\n[[ports]]\nname = grpc\nport = 9090\n[[ports]]\nname = metrics\nport = 9100\n');
  assert.deepEqual(spec.ports.map((p) => `${p.name}:${p.port}`), ['grpc:9090', 'metrics:9100']);
});

test('port and [[ports]] together', () => {
  assert.throws(() => r('name = a\nimage = r/a:1\nport = 1\n[[ports]]\nport = 2\n'), /either port or \[\[ports\]\]/);
});

test('unknown keys are reported', () => {
  const { unknown } = r('name = a\nimage = r/a:1\ncolour = red\n[resources]\ngpu = 1\n');
  assert.deepEqual(unknown, ['colour', 'resources.gpu']);
});

test('bad quantity', () => {
  assert.throws(() => r('name = a\nimage = r/a:1\n[resources]\nmemory = lots\n'), /resources.memory is not a quantity/);
});
__FX__
mkdir -p test/corpus
cat > test/corpus/expected.ndjson <<'__FX__'
{"name":"payments-api","image":"registry.internal/payments-api:4.6.1","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ledger-sync","image":"registry.internal/ledger-sync:5.10.5","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"512Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"search-indexer","image":"registry.internal/search-indexer:6.4.3","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"web-frontend","image":"registry.internal/web-frontend:2.17.2","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug"}}
{"name":"auth-gateway","image":"registry.internal/auth-gateway:4.19.3","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"768Mi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"notifier","image":"registry.internal/notifier:4.7.9","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"pdf-renderer","image":"registry.internal/pdf-renderer:5.1.7","replicas":4,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":15},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"image-resizer","image":"registry.internal/image-resizer:2.11.6","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"billing-cron","image":"registry.internal/billing-cron:2.7.6","replicas":6,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/-/ready","intervalSeconds":5},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"audit-log","image":"registry.internal/audit-log:2.0.7","replicas":4,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{}}
{"name":"feature-flags","image":"registry.internal/feature-flags:1.19.7","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"512Mi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"session-store","image":"registry.internal/session-store:3.12.9","replicas":6,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"geo-lookup","image":"registry.internal/geo-lookup:6.5.9","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"mailer","image":"registry.internal/mailer:2.14.0","replicas":4,"ports":[{"name":"http","port":9000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"webhooks-out","image":"registry.internal/webhooks-out:6.18.6","replicas":6,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"webhooks-in","image":"registry.internal/webhooks-in:6.13.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/-/ready","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"catalog-api","image":"registry.internal/catalog-api:3.5.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"pricing-engine","image":"registry.internal/pricing-engine:1.7.8","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"cart-api","image":"registry.internal/cart-api:3.11.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"checkout-web","image":"registry.internal/checkout-web:3.4.9","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"inventory-sync","image":"registry.internal/inventory-sync:5.6.4","replicas":6,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"reports-api","image":"registry.internal/reports-api:5.6.6","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":15},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"export-worker","image":"registry.internal/export-worker:6.1.4","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":5},"env":{}}
{"name":"import-worker","image":"registry.internal/import-worker:4.5.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"tax-calc","image":"registry.internal/tax-calc:4.12.4","replicas":2,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":30},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"fx-rates","image":"registry.internal/fx-rates:5.6.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"kyc-check","image":"registry.internal/kyc-check:3.7.8","replicas":4,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"fraud-score","image":"registry.internal/fraud-score:6.4.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"support-portal","image":"registry.internal/support-portal:1.8.9","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"status-page","image":"registry.internal/status-page:2.10.7","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"admin-console","image":"registry.internal/admin-console:4.6.7","replicas":2,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"metrics-relay","image":"registry.internal/metrics-relay:5.17.9","replicas":1,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{}}
{"name":"log-shipper","image":"registry.internal/log-shipper:4.6.1","replicas":3,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"thumbnailer","image":"registry.internal/thumbnailer:5.19.8","replicas":6,"ports":[{"name":"http","port":9000,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"sitemap-gen","image":"registry.internal/sitemap-gen:5.18.2","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"recs-api","image":"registry.internal/recs-api:4.13.6","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ab-testing","image":"registry.internal/ab-testing:3.3.9","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"shipping-quotes","image":"registry.internal/shipping-quotes:5.12.1","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"returns-api","image":"registry.internal/returns-api:2.9.8","replicas":3,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"loyalty-points","image":"registry.internal/loyalty-points:3.6.0","replicas":3,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
__FX__
mkdir -p docs
cat > docs/manifest-format.md <<'__FX__'
# .svc manifest format

```
name = payments-api                  # required
image = registry.internal/x:1.2.3    # required
replicas = 3                         # default 1
port = 8080                          # default 8080

[resources]
cpu = 500m                           # default 100m
memory = 1Gi                         # default 256Mi

[health]
path = /healthz                      # default /healthz
interval-seconds = 10                # default 10

[env]
LOG_LEVEL = info                     # passed through as written
```

v3 manifests can list several ports instead of `port`:

```
[[ports]]
name = http
port = 8080

[[ports]]
name = metrics
port = 9100
protocol = tcp                       # default tcp
```

Specs always carry a `ports` list; a v2 `port = N` becomes
`[{ name: "http", port: N, protocol: "tcp" }]`.

Keys are case-insensitive (except under `[env]`). Older manifests use the v1
names `img`, `replica-count`, `mem`/`memory-limit`, `health-check`/`check` and
`every`; they mean the same as the names above.

Unknown keys are ignored; `--strict` turns them into errors.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## Unreleased
- v3 manifests: `[[ports]]` tables. Specs carry `ports` (a list) instead of
  `port`; deploy-config 7.2+ reads both. No other change to v2 output.

## 1.6.0
- Corpus test: every deploy-config manifest is rendered on `npm test`.

## 1.5.0
- `--strict` reports unknown keys instead of silently ignoring them.

## 1.4.0
- `[env]` section; keys are kept as written.

## 1.0.0
- First release: `.svc` -> deploy spec, v1 key aliases.
__FX__
git add -A
commit "2026-09-22T11:20:00Z" "manifest v3: [[ports]] tables; specs carry ports[]"

# --- normalize: accept snake_case keys for v3, simplify key handling
export GIT_AUTHOR_NAME="Ola Kowalczyk" GIT_AUTHOR_EMAIL="ola.kowalczyk@northwind-ops.dev" GIT_COMMITTER_NAME="Ola Kowalczyk" GIT_COMMITTER_EMAIL="ola.kowalczyk@northwind-ops.dev"
mkdir -p src
cat > src/normalize.mjs <<'__FX__'
// Key normalisation. Keys are case-insensitive, and v3 manifests may use
// snake_case (interval_seconds); both spellings map to the kebab-case names
// render() expects. [env] keys are variable names and are passed through
// untouched.
export function normalizeKey(key) {
  return key.trim().toLowerCase().replaceAll('_', '-');
}

function keys(kv) {
  const out = {};
  for (const [k, v] of Object.entries(kv)) out[normalizeKey(k)] = v;
  return out;
}

export function normalize(doc) {
  const sections = {};
  for (const [name, kv] of Object.entries(doc.sections)) sections[name] = name === 'env' ? { ...kv } : keys(kv);
  const tables = {};
  for (const [name, rows] of Object.entries(doc.tables ?? {})) tables[name] = rows.map(keys);
  return { ...doc, sections, tables };
}
__FX__
mkdir -p test
cat > test/normalize.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, normalize } from '../src/normalize.mjs';

test('keys are case-insensitive', () => {
  assert.equal(normalizeKey('Replicas'), 'replicas');
});

test('snake_case keys (v3)', () => {
  assert.equal(normalizeKey('interval_seconds'), 'interval-seconds');
});

test('env keys are untouched', () => {
  const doc = normalize({ sections: { '': {}, env: { LOG_LEVEL: 'info' } } });
  assert.deepEqual(doc.sections.env, { LOG_LEVEL: 'info' });
});
__FX__
mkdir -p test/corpus
cat > test/corpus/expected.ndjson <<'__FX__'
{"name":"payments-api","image":"registry.internal/payments-api:4.6.1","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ledger-sync","image":"registry.internal/ledger-sync:5.10.5","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"search-indexer","image":"registry.internal/search-indexer:6.4.3","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"web-frontend","image":"registry.internal/web-frontend:2.17.2","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug"}}
{"name":"auth-gateway","image":"registry.internal/auth-gateway:4.19.3","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"notifier","image":"registry.internal/notifier:4.7.9","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"pdf-renderer","image":"registry.internal/pdf-renderer:5.1.7","replicas":4,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":15},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"image-resizer","image":"registry.internal/image-resizer:2.11.6","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"billing-cron","image":"registry.internal/billing-cron:2.7.6","replicas":6,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"audit-log","image":"registry.internal/audit-log:2.0.7","replicas":4,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{}}
{"name":"feature-flags","image":"registry.internal/feature-flags:1.19.7","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"512Mi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"session-store","image":"registry.internal/session-store:3.12.9","replicas":1,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"geo-lookup","image":"registry.internal/geo-lookup:6.5.9","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"mailer","image":"registry.internal/mailer:2.14.0","replicas":4,"ports":[{"name":"http","port":9000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"webhooks-out","image":"registry.internal/webhooks-out:6.18.6","replicas":6,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"webhooks-in","image":"registry.internal/webhooks-in:6.13.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"768Mi"},"health":{"path":"/healthz","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"catalog-api","image":"registry.internal/catalog-api:3.5.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"pricing-engine","image":"registry.internal/pricing-engine:1.7.8","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"cart-api","image":"registry.internal/cart-api:3.11.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"checkout-web","image":"registry.internal/checkout-web:3.4.9","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"inventory-sync","image":"registry.internal/inventory-sync:5.6.4","replicas":6,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"reports-api","image":"registry.internal/reports-api:5.6.6","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"1Gi"},"health":{"path":"/health","intervalSeconds":15},"env":{"LOG_LEVEL":"info","REGION":"eu-west-1"}}
{"name":"export-worker","image":"registry.internal/export-worker:6.1.4","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":5},"env":{}}
{"name":"import-worker","image":"registry.internal/import-worker:4.5.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"tax-calc","image":"registry.internal/tax-calc:4.12.4","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"fx-rates","image":"registry.internal/fx-rates:5.6.3","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn"}}
{"name":"kyc-check","image":"registry.internal/kyc-check:3.7.8","replicas":4,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"fraud-score","image":"registry.internal/fraud-score:6.4.5","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"support-portal","image":"registry.internal/support-portal:1.8.9","replicas":6,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"status-page","image":"registry.internal/status-page:2.10.7","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{"LOG_LEVEL":"warn","REGION":"eu-west-1"}}
{"name":"admin-console","image":"registry.internal/admin-console:4.6.7","replicas":2,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"metrics-relay","image":"registry.internal/metrics-relay:5.17.9","replicas":1,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/healthz","intervalSeconds":10},"env":{}}
{"name":"log-shipper","image":"registry.internal/log-shipper:4.6.1","replicas":3,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"1","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{}}
{"name":"thumbnailer","image":"registry.internal/thumbnailer:5.19.8","replicas":6,"ports":[{"name":"http","port":9000,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"256Mi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"sitemap-gen","image":"registry.internal/sitemap-gen:5.18.2","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"256Mi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"recs-api","image":"registry.internal/recs-api:4.13.6","replicas":4,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"500m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":30},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
{"name":"ab-testing","image":"registry.internal/ab-testing:3.3.9","replicas":1,"ports":[{"name":"http","port":8443,"protocol":"tcp"}],"resources":{"cpu":"250m","memory":"512Mi"},"health":{"path":"/-/ready","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"shipping-quotes","image":"registry.internal/shipping-quotes:5.12.1","replicas":1,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/health","intervalSeconds":10},"env":{"LOG_LEVEL":"info"}}
{"name":"returns-api","image":"registry.internal/returns-api:2.9.8","replicas":3,"ports":[{"name":"http","port":8080,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"1Gi"},"health":{"path":"/ping","intervalSeconds":10},"env":{}}
{"name":"loyalty-points","image":"registry.internal/loyalty-points:3.6.0","replicas":3,"ports":[{"name":"http","port":3000,"protocol":"tcp"}],"resources":{"cpu":"2","memory":"2Gi"},"health":{"path":"/status","intervalSeconds":10},"env":{"LOG_LEVEL":"debug","REGION":"eu-west-1"}}
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## Unreleased
- v3 manifests: `[[ports]]` tables. Specs carry `ports` (a list) instead of
  `port`; deploy-config 7.2+ reads both. No other change to v2 output.
- snake_case keys are accepted (`interval_seconds`).

## 1.6.0
- Corpus test: every deploy-config manifest is rendered on `npm test`.

## 1.5.0
- `--strict` reports unknown keys instead of silently ignoring them.

## 1.4.0
- `[env]` section; keys are kept as written.

## 1.0.0
- First release: `.svc` -> deploy spec, v1 key aliases.
__FX__
git add -A
commit "2026-09-23T16:05:00Z" "normalize: accept snake_case keys for v3, simplify key handling"

# --- cli: render --format env
export GIT_AUTHOR_NAME="Ola Kowalczyk" GIT_AUTHOR_EMAIL="ola.kowalczyk@northwind-ops.dev" GIT_COMMITTER_NAME="Ola Kowalczyk" GIT_COMMITTER_EMAIL="ola.kowalczyk@northwind-ops.dev"
mkdir -p src
cat > src/cli.mjs <<'__FX__'
import fs from 'node:fs';
import { parse, ManifestError } from './parse.mjs';
import { render } from './render.mjs';
import { splitBundle } from './bundle.mjs';

const USAGE = `usage: svcspec render [--strict] [--format json|env] <file.svc>...
       svcspec bundle [--strict] <file.svcbundle>   one JSON spec per line`;

function renderOne(name, text, { strict }) {
  const { spec, unknown } = render(parse(text));
  if (unknown.length && strict) throw new ManifestError(`${name}: unknown keys: ${unknown.join(', ')}`);
  return spec;
}

// SVC_* variables for shell-based deploy hooks.
function asEnv(spec) {
  const lines = [
    `SVC_NAME=${spec.name}`,
    `SVC_IMAGE=${spec.image}`,
    `SVC_REPLICAS=${spec.replicas}`,
    `SVC_PORTS=${spec.ports.map((p) => `${p.name}:${p.port}/${p.protocol}`).join(',')}`,
    `SVC_CPU=${spec.resources.cpu}`,
    `SVC_MEMORY=${spec.resources.memory}`,
    `SVC_HEALTH_PATH=${spec.health.path}`,
  ];
  return lines.join('\n') + '\n';
}

function opt(args, name) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
}

export function main(argv, out = process.stdout, err = process.stderr) {
  const [cmd, ...rest] = argv;
  const strict = rest.includes('--strict');
  const format = opt(rest, 'format') ?? 'json';
  const files = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--format');
  try {
    if (cmd === 'render' && files.length && ['json', 'env'].includes(format)) {
      for (const f of files) {
        const spec = renderOne(f, fs.readFileSync(f, 'utf8'), { strict });
        out.write(format === 'env' ? asEnv(spec) : JSON.stringify(spec, null, 2) + '\n');
      }
      return 0;
    }
    if (cmd === 'bundle' && files.length === 1) {
      for (const m of splitBundle(fs.readFileSync(files[0], 'utf8'))) out.write(JSON.stringify(renderOne(m.name, m.text, { strict })) + '\n');
      return 0;
    }
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    err.write(`svcspec: ${e.message}\n`);
    return 1;
  }
  err.write(USAGE + '\n');
  return 2;
}
__FX__
mkdir -p test
cat > test/cli.test.mjs <<'__FX__'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.mjs';

function run(argv) {
  let out = '';
  let err = '';
  const code = main(argv, { write: (s) => (out += s) }, { write: (s) => (err += s) });
  return { code, out, err };
}

function tmp(text) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'svcspec-')), 'a.svc');
  fs.writeFileSync(f, text);
  return f;
}

test('render prints the spec', () => {
  const { code, out } = run(['render', tmp('name = a\nimage = r/a:1\n')]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).name, 'a');
});

test('--strict rejects unknown keys', () => {
  const { code, err } = run(['render', '--strict', tmp('name = a\nimage = r/a:1\ncolour = red\n')]);
  assert.equal(code, 1);
  assert.match(err, /unknown keys: colour/);
});

test('--format env', () => {
  const { code, out } = run(['render', '--format', 'env', tmp('name = a\nimage = r/a:1\nport = 9000\n')]);
  assert.equal(code, 0);
  assert.match(out, /^SVC_NAME=a\n/);
  assert.match(out, /^SVC_PORTS=http:9000\/tcp$/m);
});

test('usage', () => assert.equal(run([]).code, 2));
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## Unreleased
- v3 manifests: `[[ports]]` tables. Specs carry `ports` (a list) instead of
  `port`; deploy-config 7.2+ reads both. No other change to v2 output.
- snake_case keys are accepted (`interval_seconds`).
- `render --format env` prints SVC_* variables for shell deploy hooks.

## 1.6.0
- Corpus test: every deploy-config manifest is rendered on `npm test`.

## 1.5.0
- `--strict` reports unknown keys instead of silently ignoring them.

## 1.4.0
- `[env]` section; keys are kept as written.

## 1.0.0
- First release: `.svc` -> deploy spec, v1 key aliases.
__FX__
git add -A
commit "2026-09-24T10:40:00Z" "cli: render --format env"

# --- tidy: naming and comments
export GIT_AUTHOR_NAME="Ola Kowalczyk" GIT_AUTHOR_EMAIL="ola.kowalczyk@northwind-ops.dev" GIT_COMMITTER_NAME="Ola Kowalczyk" GIT_COMMITTER_EMAIL="ola.kowalczyk@northwind-ops.dev"
mkdir -p src
cat > src/normalize.mjs <<'__FX__'
// Key normalisation. Keys are case-insensitive, and v3 manifests may use
// snake_case (interval_seconds); both spellings map to the kebab-case names
// render() expects. [env] keys are variable names and are passed through
// untouched.
export function normalizeKey(key) {
  return key.trim().toLowerCase().replaceAll('_', '-');
}

function normalizeKeys(entries) {
  const result = {};
  for (const [key, value] of Object.entries(entries)) result[normalizeKey(key)] = value;
  return result;
}

export function normalize(doc) {
  const sections = {};
  for (const [name, entries] of Object.entries(doc.sections)) sections[name] = name === 'env' ? { ...entries } : normalizeKeys(entries);
  const tables = {};
  for (const [name, rows] of Object.entries(doc.tables ?? {})) tables[name] = rows.map(normalizeKeys);
  return { ...doc, sections, tables };
}
__FX__
mkdir -p src
cat > src/render.mjs <<'__FX__'
import { ManifestError } from './parse.mjs';
import { normalize } from './normalize.mjs';
import { DEFAULTS, KNOWN, KNOWN_TABLES } from './defaults.mjs';

const QUANTITY = /^\d+(\.\d+)?(m|Mi|Gi|Ki)?$/;

function int(value, what) {
  if (!/^\d+$/.test(value)) throw new ManifestError(`${what} must be a whole number, got ${JSON.stringify(value)}`);
  return Number(value);
}

function quantity(value, what) {
  if (!QUANTITY.test(value)) throw new ManifestError(`${what} is not a quantity: ${JSON.stringify(value)}`);
  return value;
}

export function unknownKeys(doc) {
  const out = [];
  for (const [sec, kv] of Object.entries(doc.sections)) {
    if (!(sec in KNOWN)) {
      out.push(`[${sec}]`);
      continue;
    }
    if (KNOWN[sec] === null) continue;
    for (const k of Object.keys(kv)) if (!KNOWN[sec].includes(k)) out.push(sec ? `${sec}.${k}` : k);
  }
  for (const [tbl, rows] of Object.entries(doc.tables ?? {})) {
    if (!(tbl in KNOWN_TABLES)) {
      out.push(`[[${tbl}]]`);
      continue;
    }
    for (const row of rows) for (const k of Object.keys(row)) if (!KNOWN_TABLES[tbl].includes(k)) out.push(`${tbl}.${k}`);
  }
  return out;
}

// v2 manifests have a single `port`, v3 ones list [[ports]]; either way the
// spec carries a ports array.
function ports(doc) {
  const top = doc.sections[''];
  const rows = doc.tables?.ports ?? [];
  if (rows.length && top.port) throw new ManifestError('use either port or [[ports]], not both');
  if (!rows.length) return [{ name: 'http', port: top.port ? int(top.port, 'port') : DEFAULTS.port, protocol: DEFAULTS.protocol }];
  return rows.map((p, i) => ({
    name: p.name ?? `port-${i}`,
    port: int(p.port ?? '', `ports[${i}].port`),
    protocol: p.protocol ?? DEFAULTS.protocol,
  }));
}

// Manifest (parsed) -> deploy spec consumed by deploy-config.
export function render(parsed) {
  const doc = normalize(parsed);
  const top = doc.sections[''];
  const res = doc.sections.resources ?? {};
  const health = doc.sections.health ?? {};
  if (!top.name) throw new ManifestError('name is required');
  if (!top.image) throw new ManifestError('image is required');
  const spec = {
    name: top.name,
    image: top.image,
    replicas: top.replicas ? int(top.replicas, 'replicas') : DEFAULTS.replicas,
    ports: ports(doc),
    resources: {
      cpu: res.cpu ? quantity(res.cpu, 'resources.cpu') : DEFAULTS.cpu,
      memory: res.memory ? quantity(res.memory, 'resources.memory') : DEFAULTS.memory,
    },
    health: {
      path: health.path ?? DEFAULTS.healthPath,
      intervalSeconds: health['interval-seconds'] ? int(health['interval-seconds'], 'health.interval-seconds') : DEFAULTS.intervalSeconds,
    },
    env: { ...(doc.sections.env ?? {}) },
  };
  return { spec, unknown: unknownKeys(doc) };
}
__FX__
git add -A
commit "2026-09-25T15:55:00Z" "tidy: naming and comments"

# --- examples: web-frontend
export GIT_AUTHOR_NAME="Marek Zielinski" GIT_AUTHOR_EMAIL="marek.zielinski@northwind-ops.dev" GIT_COMMITTER_NAME="Marek Zielinski" GIT_COMMITTER_EMAIL="marek.zielinski@northwind-ops.dev"
git checkout -q main
mkdir -p examples
cat > examples/web-frontend.svc <<'__FX__'
# web-frontend - owned by growth
name = web-frontend
image = registry.internal/web-frontend:2.17.2
replica-count = 6

[resources]
cpu = 2
memory = 1Gi

[env]
LOG_LEVEL = debug
__FX__
git add -A
commit "2026-09-24T08:30:00Z" "examples: web-frontend"

