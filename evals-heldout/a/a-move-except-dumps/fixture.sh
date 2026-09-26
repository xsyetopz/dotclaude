#!/usr/bin/env bash
set -euo pipefail
mkdir -p local-db/init local-db/live-dumps app/src
cat > local-db/config.toml <<'EOF'
project_id = "acme-local"

[db]
port = 54322
major_version = 16

[api]
port = 54321
EOF
cat > local-db/docker-compose.yml <<'EOF'
services:
  db:
    image: postgres:16
    ports:
      - "54322:5432"
    volumes:
      - ./init:/docker-entrypoint-initdb.d:ro
EOF
cat > local-db/init/01-schema.sql <<'EOF'
CREATE TABLE accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
EOF
printf 'PGDMP prod snapshot 2026-09-20\nCOPY public.accounts (id, email) FROM stdin;\n1\tops@acme.test\n' > local-db/live-dumps/prod-2026-09-20.dump
printf 'PGDMP prod snapshot 2026-09-24\nCOPY public.accounts (id, email) FROM stdin;\n1\tops@acme.test\n2\tbilling@acme.test\n' > local-db/live-dumps/prod-2026-09-24.dump
cat > app/package.json <<'EOF'
{ "name": "acme-app", "version": "0.3.0", "private": true }
EOF
cat > app/src/index.js <<'EOF'
'use strict';
console.log('acme app');
EOF
cd app
git init -q
git add -A
git -c user.name=dev -c user.email=dev@example.com commit -qm "app skeleton"
