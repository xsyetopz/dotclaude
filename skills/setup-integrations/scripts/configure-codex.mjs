#!/usr/bin/env bun
// Install dotclaude's Codex profiles and base-config defaults.
//
//   bun configure-codex.mjs [--plan plus|prolite|pro] [--apply]
//
// Writes $CODEX_HOME/dotclaude-luna.config.toml (the bounded worker),
// $CODEX_HOME/dotclaude-review.config.toml (the reviewer, with its model
// picked for the ChatGPT plan), and the three model catalogs from
// build-codex-catalog.mjs, then sets `service_tier = "default"`,
// `model_catalog_json` (the interactive catalog), and
// `[features] fast_mode = false` in config.toml, leaving every other key as
// it is. Each profile points `model_catalog_json` at its own catalog. Without
// --apply it prints the changes and writes nothing; with it, changed files are
// backed up first and the result is re-parsed before anything is written.

import fs from "node:fs";
import path from "node:path";
import { codexHome, codexPlan } from "../../../hooks/lib/_codex.mjs";
import {
  buildCatalogs,
  catalogPath,
  fetchLiveModels,
} from "./build-codex-catalog.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const templates = path.join(here, "..", "codex");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const at = args.indexOf("--plan");
const plan = (at >= 0 ? args[at + 1] : codexPlan()) ?? "unknown";

// Reviewer per plan. Astra drains the Plus 5-hour window in minutes, so Plus
// (and an unknown plan) reviews with Sol; the Pro plans have no 5-hour window.
const REVIEW = {
  plus: { model: "gpt-6-sol", effort: "medium" },
  prolite: { model: "gpt-6-astra", effort: "medium" },
  pro: { model: "gpt-6-astra", effort: "medium" },
  unknown: { model: "gpt-6-sol", effort: "medium" },
};
const review = REVIEW[plan] ?? REVIEW.unknown;

const home = codexHome();
// The catalogs come first: the profiles and config.toml point at them, so a
// missing model cache stops the run before anything is written.
let catalogs;
try {
  catalogs = buildCatalogs(home, Date.now(), fetchLiveModels(home));
} catch (err) {
  console.error(`${err.message}\nNothing was written.`);
  process.exit(1);
}
const catalogValue = (audience) => JSON.stringify(catalogPath(home, audience));
const files = new Map([
  ...catalogs.files,
  [
    path.join(home, "dotclaude-luna.config.toml"),
    fs
      .readFileSync(path.join(templates, "dotclaude-luna.config.toml"), "utf8")
      .replaceAll("{{CATALOG}}", catalogValue("worker")),
  ],
  [
    path.join(home, "dotclaude-review.config.toml"),
    fs
      .readFileSync(
        path.join(templates, "dotclaude-review.config.toml"),
        "utf8",
      )
      .replaceAll("{{PLAN}}", plan)
      .replaceAll("{{MODEL}}", review.model)
      .replaceAll("{{EFFORT}}", review.effort)
      .replaceAll("{{CATALOG}}", catalogValue("review")),
  ],
]);

/** Set a top-level key: replace it before the first table, or insert it there. */
function setTopLevel(text, key, value) {
  const lines = text.split("\n");
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  const end = firstTable === -1 ? lines.length : firstTable;
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const at = lines.slice(0, end).findIndex((l) => re.test(l));
  if (at >= 0) lines[at] = `${key} = ${value}`;
  else
    lines.splice(
      end,
      0,
      `${key} = ${value}`,
      ...(firstTable === -1 ? [] : [""]),
    );
  return lines.join("\n");
}

/** Set a key inside [table]: replace it, add it to the table, or add the table. */
function setInTable(text, table, key, value) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[${table}]`);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  if (start === -1) {
    const trimmed = text.replace(/\s*$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}[${table}]\n${key} = ${value}\n`;
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  const at = lines.slice(start + 1, end).findIndex((l) => re.test(l));
  if (at >= 0) lines[start + 1 + at] = `${key} = ${value}`;
  else lines.splice(start + 1, 0, `${key} = ${value}`);
  return lines.join("\n");
}

const basePath = path.join(home, "config.toml");
const baseBefore = fs.existsSync(basePath)
  ? fs.readFileSync(basePath, "utf8")
  : "";
let base = setTopLevel(baseBefore, "service_tier", '"default"');
base = setTopLevel(base, "model_catalog_json", catalogValue("interactive"));
// On Plus a bare `codex` must not fall back to Astra (the catalog's first
// model), so pin the base model to Luna when it is unset or Astra.
let baseModelNote = null;
if (plan === "plus") {
  let current = null;
  try {
    current = Bun.TOML.parse(baseBefore).model ?? null;
  } catch {
    current = null;
  }
  if (!current || /astra/i.test(current)) {
    base = setTopLevel(base, "model", '"gpt-6-luna"');
    baseModelNote = `model = "gpt-6-luna" (was ${current ? `"${current}"` : "unset"})`;
  }
}
base = setInTable(base, "features", "fast_mode", "false");
if (!base.endsWith("\n")) base += "\n";
files.set(basePath, base);

// Refuse to write anything Codex would fail to load. buildCatalogs already
// re-parsed the catalogs; the TOML files are checked here.
const catalogFor = new Map([
  [basePath, catalogPath(home, "interactive")],
  [path.join(home, "dotclaude-luna.config.toml"), catalogPath(home, "worker")],
  [
    path.join(home, "dotclaude-review.config.toml"),
    catalogPath(home, "review"),
  ],
]);
for (const [file, text] of files) {
  if (!catalogFor.has(file)) continue;
  try {
    const parsed = Bun.TOML.parse(text);
    if (parsed.model_catalog_json !== catalogFor.get(file))
      throw new Error("model_catalog_json did not take effect");
    if (file === basePath) {
      if (
        parsed.service_tier !== "default" ||
        parsed.features?.fast_mode !== false
      )
        throw new Error("service_tier/fast_mode did not take effect");
      if (parsed.profiles || parsed.profile)
        console.log(
          `Note: ${file} has a legacy [profiles] table or profile key, which Codex 0.134+ rejects; move those settings into <name>.config.toml files.`,
        );
    }
  } catch (err) {
    console.error(
      `${file}: result would not be valid (${err.message}); nothing was written.`,
    );
    process.exit(1);
  }
}

console.log(`Codex home: ${home}`);
console.log(
  `ChatGPT plan: ${plan}; reviewer: ${review.model} at ${review.effort} effort.`,
);
console.log(`Model list fetched at: ${catalogs.fetchedAt ?? "unknown"}`);
for (const warning of catalogs.warnings) console.log(`Warning: ${warning}`);
const changed = [...files].filter(
  ([file, text]) =>
    !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text,
);
if (!changed.length) {
  console.log("Already up to date; nothing to change.");
  process.exit(0);
}
for (const [file] of changed)
  console.log(`  ${fs.existsSync(file) ? "update" : "create"} ${file}`);
if (baseBefore !== base) {
  console.log(
    `\nconfig.toml keys set: service_tier = "default", model_catalog_json = ${catalogValue("interactive")}, [features] fast_mode = false${baseModelNote ? `, ${baseModelNote}` : ""}`,
  );
}
if (!apply) {
  console.log(
    "\nDry run: nothing was written. Re-run with --apply to write these files.",
  );
  process.exit(0);
}
fs.mkdirSync(home, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const [file, text] of changed) {
  if (fs.existsSync(file))
    fs.copyFileSync(file, `${file}.dotclaude-backup-${stamp}`);
  fs.writeFileSync(file, text);
}
console.log(
  "\nWrote the files above (backups next to any file that existed). Check they load with: command codex -p dotclaude-luna debug prompt-input ok >/dev/null && command codex -p dotclaude-review debug prompt-input ok >/dev/null && echo ok",
);
