#!/usr/bin/env bash
# Workspace: the export timeout is set in three places. `config/default.json`
# says 30000 and `config/production.json` says 60000, the two values that a
# quick read finds. `deploy/prod.env` sets `EXPORT_TIMEOUT_MS=5000`, and the
# loader lets an environment variable win. The log shows 5000, and the commit
# that added the variable says why. The answer needs the loader, both config
# files, the deploy files, the log, and `git log`.
set -euo pipefail
git init -q .
git config user.email eval@example.com
git config user.name eval
mkdir -p src config deploy logs
cat > src/config.mjs <<'SRC'
import { readFileSync } from "node:fs";

// Environment variables that override a config key. The last source wins.
const ENV_OVERRIDES = { EXPORT_TIMEOUT_MS: ["export", "timeoutMs"] };

function merge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] =
      value && typeof value === "object" ? merge(base[key] ?? {}, value) : value;
  }
  return out;
}

export function loadConfig(env = process.env, dir = "config") {
  const read = (name) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  let config = read("default");
  if (env.NODE_ENV === "production") config = merge(config, read("production"));
  for (const [name, [section, key]] of Object.entries(ENV_OVERRIDES)) {
    if (env[name] !== undefined) config[section][key] = Number(env[name]);
  }
  return config;
}
SRC
cat > src/export.mjs <<'SRC'
import { loadConfig } from "./config.mjs";

export async function runExport(job, work) {
  const { timeoutMs } = loadConfig().export;
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs),
  );
  return Promise.race([work(job), timer]);
}
SRC
cat > config/default.json <<'SRC'
{
  "export": { "timeoutMs": 30000, "batchSize": 500 }
}
SRC
cat > README.md <<'SRC'
# Reports service

Exports time out after 30 seconds. See `config/default.json`.
SRC
git add -A
git commit -qm "Add the config loader and the export job"
cat > config/production.json <<'SRC'
{
  "export": { "timeoutMs": 60000 }
}
SRC
git add -A
git commit -qm "Raise the export timeout in production for large accounts"
cat > deploy/prod.env <<'SRC'
NODE_ENV=production
EXPORT_TIMEOUT_MS=5000
SRC
cat > deploy/run.sh <<'SRC'
#!/usr/bin/env bash
set -a
. "$(dirname "$0")/prod.env"
exec node src/server.mjs
SRC
git add -A
git commit -qm "Cap the export timeout at 5 s so exports do not hold the shared worker pool"
cat > logs/export.log <<'SRC'
2026-09-30T10:02:11Z export job=880 start rows=4100
2026-09-30T10:02:12Z export job=880 done rows=4100
2026-09-30T10:03:40Z export job=881 start rows=120000
2026-09-30T10:03:45Z export job=881 timeout after 5000ms
2026-09-30T10:04:02Z export job=882 start rows=95000
2026-09-30T10:04:07Z export job=882 timeout after 5000ms
SRC
git add -A
git commit -qm "Add a sample of the production export log"
