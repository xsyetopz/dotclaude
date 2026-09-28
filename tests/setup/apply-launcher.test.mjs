// apply-launcher.mjs and the prompt it installs, run against a temporary HOME
// so real shell startup files are never touched.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_ALLOWED } from "../../hooks/lib/_models.mjs";
import {
  renderPrompt,
  SHIPPED,
  syncPrompt,
} from "../../hooks/lib/_system-prompt.mjs";
import { hook } from "../support/hooks.mjs";
import { run, tempHome } from "../support/setup.mjs";

const launcher = (home, ...args) => run("apply-launcher.mjs", home, ...args);
const promptCopy = (home) =>
  path.join(home, ".claude", "dotclaude", "system-prompt.md");

// A `claude` on PATH that prints DOTCLAUDE_LAUNCHER in angle brackets, then
// each argument in square brackets.
function fakeClaude(home) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "claude"),
    '#!/bin/sh\nprintf "<%s>" "$DOTCLAUDE_LAUNCHER"\nfor a in "$@"; do printf "[%s]" "$a"; done; echo\n',
  );
  fs.chmodSync(path.join(bin, "claude"), 0o755);
  return bin;
}

test("the launcher block is added, replaced in place, and removed", () => {
  const home = tempHome();
  const rc = path.join(home, ".zshrc");
  fs.writeFileSync(rc, "export EDITOR=vim\n");
  expect(launcher(home, "--shell", "zsh", "--rc", rc)).toMatch(/Dry run/);
  expect(fs.readFileSync(rc, "utf8")).toBe("export EDITOR=vim\n");
  expect(fs.existsSync(promptCopy(home))).toBe(false);

  launcher(home, "--shell", "zsh", "--rc", rc, "--apply");
  const text = fs.readFileSync(rc, "utf8");
  expect(text).toMatch(
    /^export EDITOR=vim\n\n# >>> dotclaude system prompt >>>\n[\s\S]*claude\(\) \{[\s\S]*# <<< dotclaude system prompt <<<\n$/,
  );
  expect(fs.readFileSync(promptCopy(home), "utf8")).toBe(renderPrompt());
  expect(launcher(home, "--shell", "zsh", "--rc", rc)).toMatch(
    /Already up to date/,
  );

  fs.appendFileSync(rc, "alias claude='claude --verbose'\n");
  const out = launcher(home, "--shell", "zsh", "--rc", rc, "--apply");
  expect(out).toMatch(/also defines `alias claude`/);
  expect(
    fs.readFileSync(rc, "utf8").match(/dotclaude system prompt >>>/g),
  ).toHaveLength(1);

  launcher(home, "--shell", "zsh", "--rc", rc, "--remove", "--apply");
  expect(fs.readFileSync(rc, "utf8")).toBe(
    "export EDITOR=vim\n\nalias claude='claude --verbose'\n",
  );
  expect(fs.existsSync(promptCopy(home))).toBe(false);
});

test("the launcher warns when auto memory is on", () => {
  const home = tempHome();
  const rc = path.join(home, ".bashrc");
  expect(launcher(home, "--shell", "bash", "--rc", rc)).toMatch(
    /auto memory is on/,
  );
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ autoMemoryEnabled: false }),
  );
  expect(launcher(home, "--shell", "bash", "--rc", rc)).not.toMatch(
    /auto memory/,
  );
});

// Each shell runs its function against the fake `claude`: the flag goes first,
// so subcommands still parse, and the user's own prompt flag or
// DOTCLAUDE_SYSTEM_PROMPT=0 passes the arguments unchanged.
const SHELLS = {
  zsh: (rc) => [
    "zsh",
    "-c",
    `. ${rc}; claude plugin list; claude --system-prompt=x hi; DOTCLAUDE_SYSTEM_PROMPT=0 claude hi`,
  ],
  bash: (rc) => [
    "bash",
    "-c",
    `. ${rc}; claude plugin list; claude --system-prompt=x hi; DOTCLAUDE_SYSTEM_PROMPT=0 claude hi`,
  ],
  fish: (rc) => [
    "fish",
    "-c",
    `source ${rc}; claude plugin list; claude --system-prompt=x hi; DOTCLAUDE_SYSTEM_PROMPT=0 claude hi`,
  ],
  pwsh: (rc) => [
    "pwsh",
    "-NoProfile",
    "-Command",
    `. ${rc}; claude plugin list; claude --system-prompt=x hi; $env:DOTCLAUDE_SYSTEM_PROMPT='0'; claude hi`,
  ],
};

for (const [shell, command] of Object.entries(SHELLS)) {
  test.skipIf(!Bun.which(shell))(
    `the ${shell} function passes the prompt file first`,
    () => {
      const home = tempHome();
      const bin = fakeClaude(home);
      const rc = path.join(
        home,
        shell === "pwsh" ? "profile.ps1" : `rc.${shell}`,
      );
      launcher(home, "--shell", shell, "--rc", rc, "--apply");
      const [exe, ...args] = command(rc);
      const res = spawnSync(exe, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          DOTCLAUDE_SYSTEM_PROMPT: "",
          DOTCLAUDE_SYSTEM_PROMPT_FILE: "",
          DOTCLAUDE_LAUNCHER: "",
        },
      });
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout.split("\n").filter(Boolean)).toEqual([
        `<1>[--system-prompt-file][${promptCopy(home)}][plugin][list]`,
        "<1>[--system-prompt=x][hi]",
        "<1>[hi]",
      ]);
    },
    // A cold pwsh start on GitHub's ubuntu runners takes close to 5 s,
    // which is bun's default per-test timeout.
    30_000,
  );
}

test("session start updates an installed prompt copy that differs from the shipped one", () => {
  const home = tempHome();
  const config = path.join(home, ".claude");
  const start = (env = {}) =>
    hook(
      "session-start/warn-incomplete-setup.mjs",
      { hook_event_name: "SessionStart", source: "startup" },
      {
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_PLUGIN_OPTION_MODEL_LOCK: "false",
        CLAUDE_PLUGIN_OPTION_SECRET_REDACTION: "false",
        CLAUDE_CODE_EFFORT_LEVEL: "",
        DOTCLAUDE_SYSTEM_PROMPT: "",
        DOTCLAUDE_LAUNCHER: "1",
        ANTHROPIC_BASE_URL: "",
        HOME: home,
        SHELL: "/bin/zsh",
        ZDOTDIR: "",
        ...env,
      },
    );
  expect(start().systemMessage, "no copy means no launcher").toMatch(
    /the dotclaude system prompt is not installed, so this session has none of dotclaude's engineering or git rules/,
  );
  expect(start({ DOTCLAUDE_SYSTEM_PROMPT: "0" })).toBe(null);
  expect(fs.existsSync(promptCopy(home))).toBe(false);

  fs.mkdirSync(path.dirname(promptCopy(home)));
  fs.writeFileSync(promptCopy(home), "old prompt\n");
  expect(start().systemMessage).toMatch(/changed the dotclaude system prompt/);
  expect(fs.readFileSync(promptCopy(home), "utf8")).toBe(renderPrompt());
  expect(start()).toBe(null);

  // An IDE starts Claude Code without the shell function.
  expect(start({ DOTCLAUDE_LAUNCHER: "" }).systemMessage).toMatch(
    /did not start through dotclaude's `claude` shell function/,
  );
  expect(start({ DOTCLAUDE_LAUNCHER: "" }).systemMessage).toMatch(
    /Start Claude Code from a terminal that loads the function/,
  );
  // The function is in .zshrc, but this terminal started before it was added.
  fs.writeFileSync(
    path.join(home, ".zshrc"),
    "# >>> dotclaude system prompt >>>\nclaude() { :; }\n# <<< dotclaude system prompt <<<\n",
  );
  expect(start({ DOTCLAUDE_LAUNCHER: "" }).systemMessage).toMatch(
    /`~\/\.zshrc` has the function.*Run `source ~\/\.zshrc` or open a new terminal/,
  );
  expect(start({ DOTCLAUDE_LAUNCHER: "", DOTCLAUDE_SYSTEM_PROMPT: "0" })).toBe(
    null,
  );
  // `headroom wrap claude` runs the binary from PATH with its proxy URL set.
  expect(
    start({
      DOTCLAUDE_LAUNCHER: "",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8787",
    }).systemMessage,
  ).toMatch(
    /`DOTCLAUDE_LAUNCHER=1 headroom wrap claude --no-mcp --code-memory none -- --system-prompt-file [^`]+system-prompt\.md`.*stops it when the session ends/,
  );
});

test("the replacement prompt names the allowed models", () => {
  const text = fs.readFileSync(SHIPPED, "utf8");
  for (const id of DEFAULT_ALLOWED.split(","))
    expect(text).toContain(`\`${id}\``);
});

test("the prompt copy names the Claude Code version it runs on", () => {
  expect(renderPrompt("2.1.283")).toStartWith(
    "You are an agent running inside Claude Code v2.1.283, ",
  );
  expect(renderPrompt(null)).toStartWith(
    "You are an agent running inside Claude Code, ",
  );

  const copy = path.join(tempHome(), "system-prompt.md");
  fs.writeFileSync(copy, renderPrompt("2.1.283"));
  expect(syncPrompt(copy, "2.1.283")).toBe(false);
  expect(syncPrompt(copy, "2.1.290"), "a Claude Code update").toBe("version");
  expect(fs.readFileSync(copy, "utf8")).toBe(renderPrompt("2.1.290"));
  fs.writeFileSync(copy, "old prompt\n");
  expect(syncPrompt(copy, "2.1.290"), "a plugin update").toBe("content");
});
