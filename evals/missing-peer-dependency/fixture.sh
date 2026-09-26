#!/usr/bin/env bash
# Workspace: fake-browser (vendored in node_modules) loads its driver,
# fake-driver, lazily; fake-driver is an optional peer dependency that was
# never installed. A local copy is in vendor/, so no network is needed.
set -euo pipefail
cat > package.json <<'SRC'
{ "name": "scraper", "private": true, "type": "module", "dependencies": { "fake-browser": "1.0.0" } }
SRC
mkdir -p node_modules/fake-browser vendor/fake-driver
cat > node_modules/fake-browser/package.json <<'SRC'
{ "name": "fake-browser", "version": "1.0.0", "type": "module", "main": "index.js",
  "peerDependencies": { "fake-driver": ">=1.0.0" },
  "peerDependenciesMeta": { "fake-driver": { "optional": true } } }
SRC
cat > node_modules/fake-browser/index.js <<'SRC'
export async function launch() {
  const { connect } = await import("fake-driver");
  return connect();
}
SRC
cat > vendor/fake-driver/package.json <<'SRC'
{ "name": "fake-driver", "version": "1.2.3", "type": "module", "main": "index.js" }
SRC
cat > vendor/fake-driver/index.js <<'SRC'
export function connect() {
  return { title: "driver 1.2.3 connected" };
}
SRC
cat > run.mjs <<'SRC'
import { launch } from "fake-browser";
const page = await launch();
console.log(page.title);
SRC
