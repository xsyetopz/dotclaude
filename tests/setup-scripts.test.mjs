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
});

test("configure-codex installs plan-aware profiles and fixes the base tier idempotently", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-codex-"));
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
