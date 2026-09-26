#!/usr/bin/env bash
set -euo pipefail
mkdir -p lib/jobq src
cat > lib/jobq/index.js <<'EOF'
'use strict';

// Minimal in-process job queue. Jobs live in memory and are drained by
// src/worker.js, which polls due() once a second.
class Queue {
  constructor() {
    this.jobs = [];
    this.nextId = 1;
  }

  // opts.attempts      how many times the worker tries the job (default 1)
  // opts.delaySeconds  job becomes due this many seconds from now (default 0)
  enqueue(name, payload, opts = {}) {
    const { attempts = 1, delaySeconds = 0 } = opts;
    const job = {
      id: this.nextId++,
      name,
      payload,
      attemptsLeft: attempts,
      runAt: Date.now() + delaySeconds * 1000,
    };
    this.jobs.push(job);
    return job.id;
  }

  due(now = Date.now()) {
    return this.jobs.filter((job) => job.runAt <= now);
  }

  remove(id) {
    this.jobs = this.jobs.filter((job) => job.id !== id);
  }
}

module.exports = { Queue };
EOF
cat > src/queue.js <<'EOF'
'use strict';
const { Queue } = require('../lib/jobq');

module.exports = { queue: new Queue() };
EOF
cat > src/worker.js <<'EOF'
'use strict';
const { queue } = require('./queue');
const handlers = { 'send-email': require('./email').send };

async function tick() {
  for (const job of queue.due()) {
    try {
      await handlers[job.name](job.payload);
      queue.remove(job.id);
    } catch (err) {
      job.attemptsLeft -= 1;
      if (job.attemptsLeft <= 0) queue.remove(job.id);
    }
  }
}

if (require.main === module) setInterval(tick, 1000);
module.exports = { tick };
EOF
cat > src/email.js <<'EOF'
'use strict';

async function send({ to, template, userId }) {
  console.log(`email ${template} -> ${to} (user ${userId})`);
}

module.exports = { send };
EOF
cat > src/users.js <<'EOF'
'use strict';
let nextId = 1;

async function create({ email, name }) {
  return { id: nextId++, email, name };
}

module.exports = { create };
EOF
cat > src/signup.js <<'EOF'
'use strict';
const { queue } = require('./queue');
const users = require('./users');

async function signup({ email, name }) {
  const user = await users.create({ email, name });
  queue.enqueue('send-email', { to: email, template: 'welcome', userId: user.id }, { attempts: 3 });
  return user;
}

module.exports = { signup };
EOF
cat > package.json <<'EOF'
{ "name": "onboarding", "version": "0.7.0", "private": true }
EOF
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "signup flow with welcome email via jobq"
