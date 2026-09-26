#!/usr/bin/env bash
# ESM tool that resolves its config and data files against process.cwd(),
# so it only works when launched from its own directory.
set -euo pipefail

mkdir -p tools/feedsync/data

cat > package.json <<'EOF'
{
  "name": "newsroom-tools",
  "version": "0.9.0",
  "private": true,
  "type": "module"
}
EOF

cat > tools/feedsync/sync.mjs <<'EOF'
// Pulls the configured wire feeds and pushes their items to the CMS.
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('feeds.json', 'utf8'));

let items = 0;
for (const feed of config.feeds) {
  const entries = JSON.parse(readFileSync(feed.file, 'utf8'));
  // TODO: POST entries to the CMS ingest endpoint
  items += entries.length;
}

console.log(`synced ${config.feeds.length} feeds (${items} items)`);
EOF

cat > tools/feedsync/feeds.json <<'EOF'
{
  "feeds": [
    { "name": "wire", "file": "data/wire.json" },
    { "name": "sports", "file": "data/sports.json" },
    { "name": "metro", "file": "data/metro.json" }
  ]
}
EOF

cat > tools/feedsync/data/wire.json <<'EOF'
[
  { "id": "w-101", "headline": "Council approves budget" },
  { "id": "w-102", "headline": "Port strike enters day two" },
  { "id": "w-103", "headline": "Rail fares frozen" },
  { "id": "w-104", "headline": "Heatwave warning issued" },
  { "id": "w-105", "headline": "Bridge reopens after repairs" },
  { "id": "w-106", "headline": "Library hours extended" }
]
EOF

cat > tools/feedsync/data/sports.json <<'EOF'
[
  { "id": "s-201", "headline": "Late winner seals derby" },
  { "id": "s-202", "headline": "Marathon route announced" },
  { "id": "s-203", "headline": "Coach extends contract" },
  { "id": "s-204", "headline": "Rowing club celebrates centenary" }
]
EOF

cat > tools/feedsync/data/metro.json <<'EOF'
[
  { "id": "m-301", "headline": "New cycle lane opens" },
  { "id": "m-302", "headline": "Market hall restoration begins" },
  { "id": "m-303", "headline": "School expansion approved" },
  { "id": "m-304", "headline": "Night bus trial extended" },
  { "id": "m-305", "headline": "Park fountain restored" },
  { "id": "m-306", "headline": "Food bank appeal" },
  { "id": "m-307", "headline": "Tram depot plans published" }
]
EOF

cat > README.md <<'EOF'
# newsroom-tools

Small scripts the newsroom runs on the ops box.

- `tools/feedsync/sync.mjs` -- pushes wire/sports/metro items to the CMS (cron, every 10 min)
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "feedsync"
