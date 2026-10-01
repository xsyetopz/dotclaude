// Secret redaction end to end: the hook runs Betterleaks on a tool's output.
// The fake tokens are built at run time, so this file holds no secret.

import { expect, test } from "bun:test";
import { hook } from "../support/hooks.mjs";

const HOOK = "post-tool-use/redact-secrets.mjs";
const hasScanner = Bun.which("betterleaks") !== null;
if (!hasScanner)
  console.warn("betterleaks is not on PATH: skipping the redaction hook tests");

const alnum = (n) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i += 1)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const post = (tool_name, tool_response, env) =>
  hook(
    HOOK,
    {
      hook_event_name: "PostToolUse",
      tool_name,
      tool_input: {},
      tool_response,
    },
    env,
  );

test.skipIf(!hasScanner)(
  "a GitHub token in Bash output is redacted and the shape kept",
  () => {
    const token = `ghp_${alnum(36)}`;
    const out = post("Bash", {
      stdout: `line one\ntoken=${token}\nend\n`,
      stderr: "",
      interrupted: false,
    });
    const h = out.hookSpecificOutput;
    expect(h.hookEventName).toBe("PostToolUse");
    expect(JSON.stringify(h.updatedToolOutput)).not.toContain(token);
    expect(h.updatedToolOutput).toStrictEqual({
      stdout: "line one\ntoken=[REDACTED:github-pat]\nend\n",
      stderr: "",
      interrupted: false,
    });
    // The count, then the rule that matched, and never the value.
    expect(h.additionalContext).toMatch(/\b1\b.*`github-pat`/);
    expect(h.additionalContext).not.toContain(token);
  },
);

test.skipIf(!hasScanner)(
  "a generic API key in a Read result is redacted",
  () => {
    const hex = Array.from({ length: 100 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    const line = `export TYPESAFE_API_KEY="apikey_${hex}"`;
    const out = post("Read", {
      type: "text",
      file: { filePath: "/x/.zshrc", content: `# rc\n${line}\n` },
    });
    const text = JSON.stringify(out.hookSpecificOutput.updatedToolOutput);
    expect(text).not.toContain(hex);
    expect(text).toContain("[REDACTED:generic-api-key]");
  },
);

test.skipIf(!hasScanner)("clean output passes unchanged", () => {
  expect(post("Bash", { stdout: "hello world\n", stderr: "" })).toBeNull();
});

test("the guard_secrets option turns the hook off", () => {
  const token = `ghp_${alnum(36)}`;
  expect(
    post(
      "Bash",
      { stdout: token, stderr: "" },
      { CLAUDE_PLUGIN_OPTION_GUARD_SECRETS: "false" },
    ),
  ).toBeNull();
});
