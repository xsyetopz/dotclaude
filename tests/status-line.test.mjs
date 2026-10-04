import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function run(script, input, env = {}) {
  const res = Bun.spawnSync(["bun", join(root, "status-line", script)], {
    stdin: Buffer.from(
      typeof input === "string" ? input : JSON.stringify(input),
    ),
    env: { ...process.env, ...env },
  });
  return Bun.stripANSI(res.stdout.toString()).trimEnd();
}

const sec = (offsetMs) => Math.round((Date.now() + offsetMs) / 1000);
const session = (extra = {}) =>
  JSON.stringify({
    model: { id: "claude-opus-5-5" },
    effort: { level: "high" },
    context_window: { total_input_tokens: 87_000 },
    prompt_cache: {
      caching_observed: true,
      warm: true,
      expires_at: sec(40 * 60_000),
    },
    rate_limits: {
      five_hour: { used_percentage: 82.4, resets_at: sec(3_600_000) },
      seven_day: { used_percentage: 31, resets_at: sec(86_400_000 * 3) },
    },
    ...extra,
  });

test("shows context against the compaction point, cache expiry, and limits", () => {
  const out = run("main.mjs", session());
  expect(out).toContain("Opus 5.5 high");
  expect(out).toContain("87k/117k");
  expect(out).toMatch(/◷ (40|41)m/);
  expect(out).toContain("5h 82%");
  expect(out).toContain("7d 31%");
  expect(out).not.toContain("⚠");
});

test("shows a cold cache and no limits when the input has none", () => {
  const out = run("main.mjs", {
    model: { id: "claude-haiku-4-5-20251001" },
    context_window: { total_input_tokens: 5_000 },
    prompt_cache: { caching_observed: true, warm: false },
  });
  expect(out).toContain("Haiku 4.5");
  expect(out).toContain("5k/117k");
  expect(out).toContain("◌ cold");
  expect(out).not.toContain("5h");
});

test("warns on effort above the rule for the model", () => {
  const warn = (id, level) =>
    run("main.mjs", { model: { id }, effort: { level } });
  expect(warn("claude-sonnet-5-5", "high")).toContain("⚠");
  expect(warn("claude-sonnet-5-5", "medium")).not.toContain("⚠");
  expect(warn("claude-opus-5-5", "xhigh")).toContain("⚠");
  expect(warn("claude-opus-5-5", "high")).not.toContain("⚠");
  expect(warn("claude-haiku-4-5", "low")).toContain("⚠");
});

test("prints an empty line for bad input", () => {
  expect(run("main.mjs", "not json")).toBe("");
});

test("subagent rows give name, model, and context against the budget", () => {
  const out = run("subagents.mjs", {
    tasks: [
      {
        id: "a1",
        name: "worker",
        model: "claude-sonnet-5-5",
        tokenCount: 62_000,
      },
      { id: "b2", model: "claude-haiku-4-5", tokenCount: 0 },
      { name: "no-id" },
    ],
  })
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(out).toHaveLength(2);
  expect(out[0].id).toBe("a1");
  expect(Bun.stripANSI(out[0].content)).toContain("worker");
  expect(Bun.stripANSI(out[0].content)).toContain("Sonnet 5.5");
  expect(Bun.stripANSI(out[0].content)).toContain("62k/100k");
  expect(Bun.stripANSI(out[1].content)).toContain("agent");
});
