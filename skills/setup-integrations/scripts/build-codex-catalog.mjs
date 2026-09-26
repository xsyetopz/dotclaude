#!/usr/bin/env bun
// Build dotclaude's Codex model catalogs from Codex's own model cache.
//
//   bun build-codex-catalog.mjs [--apply]
//
// Fetches Codex's current model list (see fetchLiveModels), falling back to
// $CODEX_HOME/models_cache.json, and produces one catalog per audience,
// $CODEX_HOME/dotclaude-catalog-{interactive,worker,review}.json, for the
// `model_catalog_json` config key. Every model is copied whole; for the GPT-6
// models the base instructions become dotclaude's template for that audience
// plus a short per-model addendum, persistent-mode instructions are emptied,
// and the multi-agent role text is emptied. A catalog replaces Codex's model
// list entirely, which is why every cached model is kept. Without --apply it
// prints what it would write; configure-codex.mjs calls buildCatalogs() and
// writes the result with its own dry-run and backup flow.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexHome } from "../../../hooks/lib/_codex.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const templates = path.join(here, "..", "codex", "templates");

export const AUDIENCES = ["interactive", "worker", "review"];
const ADDENDA = {
  "gpt-6-astra": "astra",
  "gpt-6-sol": "sol",
  "gpt-6-luna": "luna",
};
// ModelInfo fields Codex requires when it parses a catalog (no serde default).
const REQUIRED = [
  "slug",
  "display_name",
  "supported_reasoning_levels",
  "shell_type",
  "visibility",
  "supported_in_api",
  "priority",
  "support_verbosity",
  "truncation_policy",
  "experimental_supported_tools",
];
const STALE_MS = 24 * 60 * 60 * 1000;

export function catalogPath(home, audience) {
  return path.join(home, `dotclaude-catalog-${audience}.json`);
}

function readTemplate(name) {
  return fs.readFileSync(path.join(templates, `${name}.md`), "utf8").trimEnd();
}

/** Recursively sort object keys so the output does not depend on cache key order. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  return value;
}

function patchModel(model, text) {
  const messages = { ...(model.model_messages ?? {}) };
  messages.instructions_template = text;
  messages.persistent_instructions = "";
  if (messages.multi_agent)
    messages.multi_agent = {
      ...messages.multi_agent,
      role: { ...(messages.multi_agent.role ?? {}), root: "", subagent: "" },
    };
  return { ...model, model_messages: messages };
}

/**
 * The model list Codex would fetch now, or null. A config with
 * model_catalog_json (which dotclaude sets) stops Codex from refreshing its
 * cache, so this runs `codex debug models` under an empty CODEX_HOME that holds
 * only a link to the real login; Codex reads the token through the link, and
 * this script never does. Offline, logged out, or no codex on PATH: null.
 */
export function fetchLiveModels(home = codexHome()) {
  const auth = path.join(home, "auth.json");
  if (!fs.existsSync(auth) || !Bun.which("codex")) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  try {
    fs.symlinkSync(auth, path.join(tmp, "auth.json"));
    const res = spawnSync("codex", ["debug", "models"], {
      env: { ...process.env, CODEX_HOME: tmp },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (res.status !== 0) return null;
    const models = JSON.parse(res.stdout)?.models;
    return Array.isArray(models) && models.length ? models : null;
  } catch {
    return null;
  } finally {
    // Removes the link, not the login it points to.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Build the three catalogs without writing them. `live` is a model list from
 * fetchLiveModels(); without one the cached list is used.
 * Returns { files: Map<absolute path, JSON text>, warnings: string[], fetchedAt }.
 * Throws with a readable message when the cache is missing or unusable.
 */
export function buildCatalogs(
  home = codexHome(),
  now = Date.now(),
  live = null,
) {
  if (live) return catalogsFrom(home, live, [], new Date(now).toISOString());
  const cacheFile = path.join(home, "models_cache.json");
  if (!fs.existsSync(cacheFile))
    throw new Error(
      `Could not fetch the current model list, and ${cacheFile} does not exist. Log in with \`codex login\`, then re-run this setup.`,
    );
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch (err) {
    throw new Error(`${cacheFile} is not valid JSON (${err.message}).`);
  }
  const models = cache?.models;
  if (!Array.isArray(models) || models.length === 0)
    throw new Error(`${cacheFile} has no models.`);

  const warnings = [];
  const fetchedAt = cache.fetched_at ?? null;
  const fetchedMs = Date.parse(fetchedAt ?? "");
  if (!Number.isFinite(fetchedMs) || now - fetchedMs > STALE_MS)
    warnings.push(
      `Could not fetch the current model list (logged out or offline), and ${cacheFile} was fetched ${fetchedAt ?? "at an unknown time"}, more than 24 hours ago. Log in with \`codex login\` and re-run this setup to pick up model changes.`,
    );
  return catalogsFrom(home, models, warnings, fetchedAt);
}

function catalogsFrom(home, models, warnings, fetchedAt) {
  const missing = Object.keys(ADDENDA).filter(
    (slug) => !models.some((m) => m?.slug === slug),
  );
  if (missing.length)
    warnings.push(
      `The model cache has no ${missing.join(", ")}; those models get no dotclaude instructions.`,
    );

  const files = new Map();
  for (const audience of AUDIENCES) {
    const base = readTemplate(`base-${audience}`);
    const catalog = {
      models: models.map((model) => {
        const addendum = ADDENDA[model?.slug];
        if (!addendum) return sortKeys(model);
        return sortKeys(
          patchModel(model, `${base}\n\n${readTemplate(addendum)}\n`),
        );
      }),
    };
    const text = `${JSON.stringify(catalog, null, 2)}\n`;
    const file = catalogPath(home, audience);
    const reparsed = JSON.parse(text);
    for (const model of reparsed.models) {
      const absent = REQUIRED.filter((key) => !(key in (model ?? {})));
      if (absent.length)
        throw new Error(
          `${file}: model ${model?.slug ?? "(no slug)"} lacks ${absent.join(", ")}; the cache format may have changed.`,
        );
    }
    files.set(file, text);
  }
  return { files, warnings, fetchedAt };
}

if (import.meta.main) {
  let result;
  try {
    result = buildCatalogs(codexHome(), Date.now(), fetchLiveModels());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
  const apply = process.argv.includes("--apply");
  for (const [file, text] of result.files) {
    if (apply) fs.writeFileSync(file, text);
    console.log(
      `  ${apply ? "wrote" : "would write"} ${file} (${text.length} bytes)`,
    );
  }
  if (!apply)
    console.log(
      "\nDry run: nothing was written. Re-run with --apply to write these files.",
    );
}
