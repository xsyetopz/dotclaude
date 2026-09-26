#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > package.json <<'EOF'
{ "name": "notify-service", "version": "1.8.2", "private": true, "main": "src/index.js" }
EOF
cat > README.md <<'EOF'
# notify-service

Sends account notification emails.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | HTTP port |
| `SENTRY_DSN` | Error reporting |
EOF
cat > src/config.js <<'EOF'
'use strict';

const { PORT = '8080', HOST = '0.0.0.0' } = process.env;

module.exports = {
  port: Number(PORT),
  host: HOST,
  databaseUrl: process.env.DATABASE_URL,
};
EOF
cat > src/cache.js <<'EOF'
'use strict';

const url = process.env['REDIS_URL'] || 'redis://localhost:6379';

function cacheKey(userId) {
  return `notify:${userId}`;
}

module.exports = { url, cacheKey };
EOF
cat > src/mailer.js <<'EOF'
'use strict';

const apiKey = process.env.SMTP_API_KEY;

function send(to, subject) {
  if (!apiKey) throw new Error('mailer not configured');
  return { to, subject, queued: true };
}

module.exports = { send };
EOF
cat > src/logger.js <<'EOF'
'use strict';

const LEVELS = ['debug', 'info', 'warn', 'error'];
const level = process.env.LOG_LEVEL ?? 'info';

function log(lvl, msg) {
  if (LEVELS.indexOf(lvl) >= LEVELS.indexOf(level)) console.log(`[${lvl}] ${msg}`);
}

module.exports = { log };
EOF
cat > src/index.js <<'EOF'
'use strict';
const http = require('http');
const config = require('./config');
const { log } = require('./logger');
require('./cache');
require('./mailer');

http.createServer((req, res) => res.end('ok')).listen(config.port, config.host, () => {
  log('info', `notify-service on ${config.host}:${config.port}`);
});
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "notify service"
