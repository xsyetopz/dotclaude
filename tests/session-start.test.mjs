import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLD_RESUME_MIN_TOKENS,
  MINIMAL_CODE_MAX_BYTES,
  RULES_MAX_BYTES,
} from "../hooks/lib/_budget.mjs";
import { contextFor } from "../hooks/session-start/context.mjs";

const RULES = join(import.meta.dir, "../hooks/session-start/rules.md");
const MINIMAL_CODE = join(
  import.meta.dir,
  "../hooks/session-start/minimal-code.md",
);

function project(notes) {
  const root = mkdtempSync(join(tmpdir(), "ss-"));
  mkdirSync(join(root, ".claude/handoffs"), { recursive: true });
  for (const [name, status] of Object.entries(notes))
    writeFileSync(
      join(root, ".claude/handoffs", name),
      `---\nstatus: ${status}\nwritten: 2026-10-04T00:00:00Z\n---\n\nbody\n`,
    );
  return root;
}

test("rules.md stays within its byte limit and keeps semicolons out", () => {
  const text = readFileSync(RULES);
  expect(text.length).toBeLessThanOrEqual(RULES_MAX_BYTES);
  expect(text.toString()).not.toContain(";");
});

test("rules.md asks for semantic line breaks, not column breaks", () => {
  const text = readFileSync(RULES, "utf8");
  expect(text).toContain("start each sentence on a new line");
  expect(text).toContain("Do not break lines at a column");
});

test("startup, clear, and compact add the rules", () => {
  const root = project({});
  for (const source of ["startup", "clear", "compact"])
    expect(contextFor({ source }, root)[0]).toContain("<working_rules>");
  expect(contextFor({ source: "resume" }, root)).toEqual([]);
});

test("startup and clear point at the newest in-progress note only", () => {
  const root = project({
    "2026-10-01-0900-a.md": "in-progress",
    "2026-10-03-0900-b.md": "in-progress",
    "2026-10-04-0900-c.md": "done",
  });
  const pointer = contextFor({ source: "startup" }, root).at(-1);
  expect(pointer).toContain("2026-10-03-0900-b.md");
  expect(pointer).toContain(
    "`done` only when each item in its **Open** section is done",
  );
  expect(contextFor({ source: "compact" }, root)).toHaveLength(2);
  expect(
    contextFor({ source: "startup" }, project({ "a.md": "done" })),
  ).toHaveLength(2);
});

test("the minimal code rules are on unless the plugin option is false", () => {
  const text = readFileSync(MINIMAL_CODE);
  expect(text.length).toBeLessThanOrEqual(MINIMAL_CODE_MAX_BYTES);
  expect(text.toString()).not.toContain(";");
  const root = project({});
  const parts = (option) =>
    contextFor({ source: "startup" }, root, "max20", option).join("\n");
  expect(parts(undefined)).toContain("<minimal_code>");
  expect(parts("true")).toContain("<minimal_code>");
  expect(parts("false")).not.toContain("<minimal_code>");
});

test("a resume with an expired cache names the cost and the advice", () => {
  const data = {
    source: "resume",
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 1.234,
  };
  const [note] = contextFor(data, "/x");
  expect(note).toContain("$1.23");
  expect(note).toContain("estimated_cache_write_usd");
  expect(note).toContain("`/clear`");
  expect(
    contextFor({ ...data, prompt_cache_likely_expired: false }, "/x"),
  ).toEqual([]);
});

test("a resume with a small context gets no cold cache note", () => {
  const data = { source: "resume", prompt_cache_likely_expired: true };
  const at = (tokens) => contextFor({ ...data, context_tokens: tokens }, "/x");
  expect(at(COLD_RESUME_MIN_TOKENS - 1)).toEqual([]);
  expect(at(COLD_RESUME_MIN_TOKENS)).toHaveLength(1);
  expect(contextFor(data, "/x")).toHaveLength(1);
});
