// count-tokens: opt-in token counts of the injected texts. No test calls the
// API: the table builder runs against a stub `fetch`.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildTable, render, sources } from "../../scripts/count-tokens.mjs";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../scripts/count-tokens.mjs",
);

test("without ANTHROPIC_API_KEY it exits 1 with a one-line message", () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const run = spawnSync("bun", [SCRIPT], { encoding: "utf8", env });
  expect(run.status).toBe(1);
  expect(run.stdout).toBe("");
  expect(run.stderr.trim().split("\n")).toEqual([
    "ANTHROPIC_API_KEY is not set. Set it to count tokens.",
  ]);
});

test("the table subtracts the baseline count and sends the documented request", async () => {
  const calls = [];
  const stub = async (url, init) => {
    const req = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, req });
    return Response.json({
      input_tokens: 10 + req.messages[0].content.length,
    });
  };
  const rows = await buildTable(
    [
      { name: "a", text: "x".repeat(25) },
      { name: "b", text: "x".repeat(6) },
    ],
    { key: "k", fetch: stub },
  );
  // The baseline "Hello" counts 15 here, so each row is its length minus 5.
  expect(rows).toEqual([
    { name: "a", tokens: 20 },
    { name: "b", tokens: 1 },
  ]);
  expect(calls).toHaveLength(3);
  expect(calls[0].url).toBe(
    "https://api.anthropic.com/v1/messages/count_tokens",
  );
  expect(calls[0].headers["x-api-key"]).toBe("k");
  expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
  expect(calls[0].req.model).toBe("claude-opus-5-5");
  expect(render(rows).split("\n")).toEqual([
    "Text  Tokens",
    "a         20",
    "b          1",
  ]);
});

test("an API error stops the table with its status", async () => {
  const stub = async () => new Response("bad key", { status: 401 });
  await expect(buildTable([], { key: "k", fetch: stub })).rejects.toThrow(
    "count_tokens 401: bad key",
  );
});

test("the sources hold the output style, the hook texts, and every agent", () => {
  const items = sources();
  const names = items.map((s) => s.name);
  expect(names).toContain("output style");
  expect(names).toContain("SubagentStart: conventions");
  expect(names).toContain("agent: reviewer");
  for (const s of items) expect(s.text.length, s.name).toBeGreaterThan(50);
});
