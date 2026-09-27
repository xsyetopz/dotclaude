// configure-codex.mjs, run against a temporary CODEX_HOME.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  modelFixture,
  runConfigureCodex,
  SETUP,
  writeModelCache,
} from "../support/setup.mjs";

test("configure-codex installs plan-aware profiles and fixes the base tier idempotently", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  writeModelCache(codexHome);
  const base = path.join(codexHome, "config.toml");
  fs.writeFileSync(
    base,
    'model = "gpt-6-astra"\nservice_tier = "fast"\n\n[features]\nfast_mode = true\ngoals = true\n\n[projects."/x"]\ntrust_level = "trusted"\n',
  );
  const script = path.resolve(
    import.meta.dirname,
    "../../skills/setup-integrations/scripts/configure-codex.mjs",
  );
  const run = (...args) => {
    const res = spawnSync("bun", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    expect(res.status, res.stderr).toBe(0);
    return res.stdout;
  };
  expect(run("--plan", "plus")).toMatch(/Dry run/);
  expect(fs.readFileSync(base, "utf8")).toMatch(/service_tier = "fast"/);
  run("--plan", "plus", "--apply");
  const parsed = Bun.TOML.parse(fs.readFileSync(base, "utf8"));
  expect(parsed.service_tier).toBe("default");
  expect(parsed.model, "Plus never defaults to Astra").toBe("gpt-6-luna");
  expect(parsed.features.fast_mode).toBe(false);
  expect(parsed.features.goals, "other user keys stay").toBe(true);
  expect(parsed.projects["/x"].trust_level).toBe("trusted");
  const review = Bun.TOML.parse(
    fs.readFileSync(
      path.join(codexHome, "dotclaude-review.config.toml"),
      "utf8",
    ),
  );
  expect(review.model, "no Astra on Plus").toBe("gpt-6-sol");
  expect(review.sandbox_mode).toBe("read-only");
  const worker = Bun.TOML.parse(
    fs.readFileSync(path.join(codexHome, "dotclaude-luna.config.toml"), "utf8"),
  );
  expect(worker.model).toBe("gpt-6-luna");
  expect(worker.features.goals).toBe(false);
  expect(worker.agents.enabled).toBe(false);
  expect(run("--plan", "plus", "--apply")).toMatch(/Already up to date/);
  run("--plan", "pro", "--apply");
  expect(
    Bun.TOML.parse(
      fs.readFileSync(
        path.join(codexHome, "dotclaude-review.config.toml"),
        "utf8",
      ),
    ).model,
  ).toBe("gpt-6-astra");
});

test("configure-codex writes a patched model catalog per audience and points each config at it", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  const cache = writeModelCache(codexHome, "2020-01-01T00:00:00Z");
  const dry = runConfigureCodex(codexHome, "--plan", "pro");
  expect(dry.status, dry.stderr).toBe(0);
  expect(dry.stdout, "stale cache warns").toMatch(
    /more than 24 hours ago.*codex login/,
  );
  expect(
    !fs.existsSync(path.join(codexHome, "dotclaude-catalog-worker.json")),
  ).toBeTruthy();

  const res = runConfigureCodex(codexHome, "--plan", "pro", "--apply");
  expect(res.status, res.stderr).toBe(0);
  const template = (name) =>
    fs.readFileSync(path.join(SETUP, "codex/templates", `${name}.md`), "utf8");
  const configs = {
    interactive: "config.toml",
    worker: "dotclaude-luna.config.toml",
    review: "dotclaude-review.config.toml",
  };
  for (const [audience, configFile] of Object.entries(configs)) {
    const catalogFile = path.join(
      codexHome,
      `dotclaude-catalog-${audience}.json`,
    );
    const config = Bun.TOML.parse(
      fs.readFileSync(path.join(codexHome, configFile), "utf8"),
    );
    expect(config.model_catalog_json, configFile).toBe(catalogFile);
    const { models } = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    expect(
      models.map((m) => m.slug),
      "every cached model is kept, in order",
    ).toStrictEqual(cache.models.map((m) => m.slug));
    const luna = models[0].model_messages;
    expect(
      luna.instructions_template.includes(template(`base-${audience}`).trim()),
    ).toBeTruthy();
    expect(
      luna.instructions_template.includes(template("luna").trim()),
    ).toBeTruthy();
    expect(luna.persistent_instructions).toBe("");
    expect(luna.multi_agent.role).toStrictEqual({ root: "", subagent: "" });
    expect(models[1], "other models untouched").toStrictEqual(cache.models[1]);
    expect(models[2]).toStrictEqual(cache.models[2]);
  }
  for (const profile of ["dotclaude-luna", "dotclaude-review"]) {
    const config = Bun.TOML.parse(
      fs.readFileSync(path.join(codexHome, `${profile}.config.toml`), "utf8"),
    );
    expect(config.include_collaboration_mode_instructions).toBe(false);
    expect(config.include_apps_instructions).toBe(false);
    expect(config.compact_prompt).toBe(undefined);
  }
  const again = runConfigureCodex(codexHome, "--plan", "pro", "--apply");
  expect(again.stdout).toMatch(/Already up to date/);
});

test("configure-codex stops without writing when the model cache is missing", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  const res = runConfigureCodex(codexHome, "--plan", "plus", "--apply");
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(
    /models_cache\.json does not exist.*codex login/is,
  );
  expect(fs.readdirSync(codexHome)).toStrictEqual([]);
});

test("configure-codex builds catalogs from the live model list through a linked login", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  writeModelCache(codexHome, "2020-01-01T00:00:00Z");
  const auth = path.join(codexHome, "auth.json");
  fs.writeFileSync(auth, '{"secret":"x"}');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bin-"));
  const live = JSON.stringify({
    models: [modelFixture("gpt-6-luna"), modelFixture("gpt-7-new")],
  });
  // The fake prints the live list only when it runs under a separate
  // CODEX_HOME whose auth.json is a link to the real login.
  fs.writeFileSync(
    path.join(bin, "codex"),
    `#!/bin/sh\n[ "$CODEX_HOME" != "${codexHome}" ] && [ -L "$CODEX_HOME/auth.json" ] || exit 1\necho '${live}'\n`,
    { mode: 0o755 },
  );
  const res = spawnSync(
    "bun",
    [
      path.join(SETUP, "scripts/configure-codex.mjs"),
      "--plan",
      "plus",
      "--apply",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        PATH: `${bin}:${process.env.PATH}`,
      },
    },
  );
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).not.toMatch(/more than 24 hours ago/);
  const worker = JSON.parse(
    fs.readFileSync(
      path.join(codexHome, "dotclaude-catalog-worker.json"),
      "utf8",
    ),
  );
  expect(worker.models.map((m) => m.slug)).toStrictEqual([
    "gpt-6-luna",
    "gpt-7-new",
  ]);
  expect(fs.readFileSync(auth, "utf8")).toBe('{"secret":"x"}');
});
