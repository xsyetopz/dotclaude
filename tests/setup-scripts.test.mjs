// Setup scripts, run against a temporary HOME so real settings are never touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPTS = path.resolve(
  import.meta.dirname,
  "../skills/apply-settings-profile/scripts",
);

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-home-"));
  fs.mkdirSync(path.join(home, ".claude"));
  return home;
}

const SETUP = path.resolve(import.meta.dirname, "../skills/setup-integrations");

/** A small models_cache.json in the shape Codex writes, with the fields its catalog parser requires. */
function modelFixture(slug, extra = {}) {
  return {
    slug,
    display_name: slug,
    description: null,
    supported_reasoning_levels: [{ effort: "low", description: "Fast" }],
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    support_verbosity: true,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    truncation_policy: { mode: "tokens", limit: 10000 },
    experimental_supported_tools: [],
    ...extra,
  };
}

function writeModelCache(dir, fetchedAt = new Date().toISOString()) {
  const cache = {
    fetched_at: fetchedAt,
    etag: 'W/"x"',
    client_version: "0.157.0",
    models: [
      modelFixture("gpt-6-luna", {
        model_messages: {
          instructions_template: "Upstream template.",
          instructions_variables: null,
          persistent_instructions: "Upstream persistent.",
          multi_agent: {
            role: { root: "Upstream root.", subagent: "Upstream subagent." },
            mode: null,
          },
        },
      }),
      modelFixture("gpt-5.5", {
        model_messages: { instructions_template: "Other model template." },
      }),
      modelFixture("codex-auto-review", { visibility: "hide" }),
    ],
  };
  fs.writeFileSync(path.join(dir, "models_cache.json"), JSON.stringify(cache));
  return cache;
}

function run(script, home, ...args) {
  const res = spawnSync("bun", [path.join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

test("apply-settings previews without writing, then merges without removing user keys", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      theme: "auto",
      permissions: { allow: ["mcp__codegraph__*"], deny: ["Read(~/.ssh/**)"] },
    }),
  );
  const before = fs.readFileSync(file, "utf8");
  assert.match(run("apply-settings.mjs", home), /Dry run/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(merged.theme, "auto");
  assert.deepEqual(merged.permissions.allow, [
    "mcp__codegraph__*",
    "Bash(codex exec -p dotclaude-luna *)",
    "Bash(codex exec -p dotclaude-review *)",
  ]);
  assert.equal(
    merged.permissions.deny.filter((r) => r === "Read(~/.ssh/**)").length,
    1,
  );
  assert.equal(merged.fastMode, false);
  assert.equal(merged.env.CLAUDE_CODE_DISABLE_FAST_MODE, "1");
  assert.ok(
    fs
      .readdirSync(path.join(home, ".claude"))
      .some((f) => f.startsWith("settings.json.dotclaude-backup-")),
  );
  assert.match(run("apply-settings.mjs", home), /Already up to date/);
});

test("apply-settings replaces the model policy: availableModels and Agent(model:) denies", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      availableModels: ["claude-opus-5-5", "claude-sonnet-5"],
      env: { CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: "40", KEEP_ME: "1" },
      permissions: {
        deny: [
          "Read(~/.ssh/**)",
          "Agent(model:sonnet*)",
          "Agent(model:haiku*)",
          "Agent(model:claude-sonnet*)",
          "Agent(model:claude-haiku*)",
        ],
      },
    }),
  );
  assert.match(
    run("apply-settings.mjs", home),
    /remove "Agent\(model:sonnet\*\)"/,
  );
  run("apply-settings.mjs", home, "--apply");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(merged.availableModels, [
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-haiku-4-5",
  ]);
  assert.ok(merged.permissions.deny.includes("Read(~/.ssh/**)"));
  assert.ok(merged.permissions.deny.includes("Agent(model:claude-sonnet*)"));
  for (const gone of [
    "Agent(model:sonnet*)",
    "Agent(model:haiku*)",
    "Agent(model:claude-haiku*)",
  ])
    assert.ok(!merged.permissions.deny.includes(gone), gone);
  assert.equal(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-opus-5-5");
  // A retired env key the 0.2.0 profile set is removed; the user's own stays.
  assert.ok(
    !Object.hasOwn(merged.env, "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION"),
  );
  assert.equal(merged.env.KEEP_ME, "1");
});

test("apply-claude-md appends a marked section, replaces it in place, and removes it", () => {
  const home = tempHome();
  const file = path.join(home, ".claude", "CLAUDE.md");
  const source = path.join(home, "section.md");
  fs.writeFileSync(file, "## CodeGraph\n\nUser's own rules.\n");
  fs.writeFileSync(source, "First version.");
  assert.match(run("apply-claude-md.mjs", home, "--source", source), /Dry run/);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "## CodeGraph\n\nUser's own rules.\n",
  );

  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  let text = fs.readFileSync(file, "utf8");
  assert.match(
    text,
    /^## CodeGraph\n\nUser's own rules\.\n\n<!-- dotclaude:begin/,
  );
  assert.match(text, /First version\.\n<!-- dotclaude:end -->\n$/);

  fs.writeFileSync(source, "Second version.");
  run("apply-claude-md.mjs", home, "--source", source, "--apply");
  text = fs.readFileSync(file, "utf8");
  assert.equal(text.match(/dotclaude:begin/g).length, 1);
  assert.match(text, /Second version\./);
  assert.doesNotMatch(text, /First version/);

  run("apply-claude-md.mjs", home, "--remove", "--apply");
  assert.equal(
    fs.readFileSync(file, "utf8").trim(),
    "## CodeGraph\n\nUser's own rules.",
  );
});

test("setup-integrations status reports MCP servers, index, and Codex profiles", () => {
  const home = tempHome();
  const project = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-proj-")),
  );
  fs.mkdirSync(path.join(project, ".codegraph"));
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { headroom: { command: "headroom", env: { SECRET: "x" } } },
      projects: { [project]: { mcpServers: { codegraph: {} } } },
    }),
  );
  fs.mkdirSync(path.join(home, ".codex"));
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    'model = "gpt-6-luna"\nservice_tier = "default"\n[features]\nfast_mode = false\n[profiles.dotclaude-luna]\nmodel = "gpt-6-luna"\n',
  );
  writeModelCache(path.join(home, ".codex"), "2026-01-02T03:04:05Z");
  fs.writeFileSync(
    path.join(home, ".codex", "dotclaude-catalog-worker.json"),
    "{}",
  );
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
    }),
  ).toString("base64url");
  fs.writeFileSync(
    path.join(home, ".codex", "auth.json"),
    JSON.stringify({
      tokens: { id_token: `h.${claims}.sig`, access_token: "SECRET-TOKEN" },
    }),
  );
  const res = spawnSync(
    "bun",
    [
      path.resolve(
        import.meta.dirname,
        "../skills/setup-integrations/scripts/status.mjs",
      ),
      "--project",
      project,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: home, PATH: path.dirname(process.execPath) },
    },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /SECRET/);
  assert.equal(JSON.parse(res.stdout).codex.plan, "plus");
  const status = JSON.parse(res.stdout);
  assert.equal(status.codegraph.mcp, "local");
  assert.equal(status.codegraph.indexed, true);
  assert.equal(status.headroom.mcp, "user");
  assert.equal(status.codex.cli, null);
  assert.equal(status.codex.config.service_tier, "default");
  assert.equal(status.codex.config.fast_mode, false);
  assert.deepEqual(status.codex.config.legacy_profile_tables, [
    "dotclaude-luna",
  ]);
  assert.deepEqual(status.codex.catalogs, {
    interactive: false,
    worker: true,
    review: false,
  });
  assert.equal(status.codex.models_cache_fetched_at, "2026-01-02T03:04:05Z");
});

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
    "../skills/setup-integrations/scripts/configure-codex.mjs",
  );
  const run = (...args) => {
    const res = spawnSync("bun", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout;
  };
  assert.match(run("--plan", "plus"), /Dry run/);
  assert.match(fs.readFileSync(base, "utf8"), /service_tier = "fast"/);
  run("--plan", "plus", "--apply");
  const parsed = Bun.TOML.parse(fs.readFileSync(base, "utf8"));
  assert.equal(parsed.service_tier, "default");
  assert.equal(parsed.model, "gpt-6-luna", "Plus never defaults to Astra");
  assert.equal(parsed.features.fast_mode, false);
  assert.equal(parsed.features.goals, true, "other user keys stay");
  assert.equal(parsed.projects["/x"].trust_level, "trusted");
  const review = Bun.TOML.parse(
    fs.readFileSync(
      path.join(codexHome, "dotclaude-review.config.toml"),
      "utf8",
    ),
  );
  assert.equal(review.model, "gpt-6-sol", "no Astra on Plus");
  assert.equal(review.sandbox_mode, "read-only");
  const worker = Bun.TOML.parse(
    fs.readFileSync(path.join(codexHome, "dotclaude-luna.config.toml"), "utf8"),
  );
  assert.equal(worker.model, "gpt-6-luna");
  assert.equal(worker.features.goals, false);
  assert.equal(worker.agents.enabled, false);
  assert.match(run("--plan", "plus", "--apply"), /Already up to date/);
  run("--plan", "pro", "--apply");
  assert.equal(
    Bun.TOML.parse(
      fs.readFileSync(
        path.join(codexHome, "dotclaude-review.config.toml"),
        "utf8",
      ),
    ).model,
    "gpt-6-astra",
  );
});

function runConfigureCodex(codexHome, ...args) {
  return spawnSync(
    "bun",
    [path.join(SETUP, "scripts/configure-codex.mjs"), ...args],
    { encoding: "utf8", env: { ...process.env, CODEX_HOME: codexHome } },
  );
}

test("configure-codex writes a patched model catalog per audience and points each config at it", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  const cache = writeModelCache(codexHome, "2020-01-01T00:00:00Z");
  const dry = runConfigureCodex(codexHome, "--plan", "pro");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /more than 24 hours ago.*codex login/, "stale cache warns");
  assert.ok(
    !fs.existsSync(path.join(codexHome, "dotclaude-catalog-worker.json")),
  );

  const res = runConfigureCodex(codexHome, "--plan", "pro", "--apply");
  assert.equal(res.status, 0, res.stderr);
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
    assert.equal(config.model_catalog_json, catalogFile, configFile);
    const { models } = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    assert.deepEqual(
      models.map((m) => m.slug),
      cache.models.map((m) => m.slug),
      "every cached model is kept, in order",
    );
    const luna = models[0].model_messages;
    assert.ok(
      luna.instructions_template.includes(template(`base-${audience}`).trim()),
    );
    assert.ok(luna.instructions_template.includes(template("luna").trim()));
    assert.equal(luna.persistent_instructions, "");
    assert.deepEqual(luna.multi_agent.role, { root: "", subagent: "" });
    assert.deepEqual(models[1], cache.models[1], "other models untouched");
    assert.deepEqual(models[2], cache.models[2]);
  }
  for (const profile of ["dotclaude-luna", "dotclaude-review"]) {
    const config = Bun.TOML.parse(
      fs.readFileSync(path.join(codexHome, `${profile}.config.toml`), "utf8"),
    );
    assert.equal(config.include_collaboration_mode_instructions, false);
    assert.equal(config.include_apps_instructions, false);
    assert.equal(config.compact_prompt, undefined);
  }
  const again = runConfigureCodex(codexHome, "--plan", "pro", "--apply");
  assert.match(again.stdout, /Already up to date/);
});

test("configure-codex stops without writing when the model cache is missing", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
  const res = runConfigureCodex(codexHome, "--plan", "plus", "--apply");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /models_cache\.json does not exist.*codex login/is);
  assert.deepEqual(fs.readdirSync(codexHome), []);
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
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /more than 24 hours ago/);
  const worker = JSON.parse(
    fs.readFileSync(
      path.join(codexHome, "dotclaude-catalog-worker.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    worker.models.map((m) => m.slug),
    ["gpt-6-luna", "gpt-7-new"],
  );
  assert.equal(fs.readFileSync(auth, "utf8"), '{"secret":"x"}');
});
