import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact, scan, strings } from "../../hooks/lib/_secrets.mjs";

const find = (rule, secret) => ({ rule, secret });

test("redact replaces each secret in a string", () => {
  const { value, count } = redact("a=SECRET1 b=SECRET1", [
    find("r1", "SECRET1"),
  ]);
  expect(value).toBe("a=[REDACTED:r1] b=[REDACTED:r1]");
  expect(count).toBe(2);
});

test("redact keeps the shape of nested objects and arrays", () => {
  const out = {
    stdout: "key: TOKEN-A",
    stderr: "",
    interrupted: false,
    lines: ["x", { deep: "TOKEN-B and TOKEN-A" }],
    n: 3,
  };
  const { value, count } = redact(out, [
    find("a", "TOKEN-A"),
    find("b", "TOKEN-B"),
  ]);
  expect(value).toStrictEqual({
    stdout: "key: [REDACTED:a]",
    stderr: "",
    interrupted: false,
    lines: ["x", { deep: "[REDACTED:b] and [REDACTED:a]" }],
    n: 3,
  });
  expect(count).toBe(3);
});

test("a longer secret that contains a shorter one is replaced whole", () => {
  const { value } = redact("LONGSECRET-123 and SECRET", [
    find("short", "SECRET"),
    find("long", "LONGSECRET-123"),
  ]);
  expect(value).toBe("[REDACTED:long] and [REDACTED:short]");
});

test("no findings give the same value back", () => {
  const out = { stdout: "clean", code: 0 };
  expect(redact(out, [])).toStrictEqual({ value: out, count: 0 });
});

test("strings lists every string in order", () => {
  expect(strings({ a: "1", b: [2, "3", { c: "4" }], d: null })).toStrictEqual([
    "1",
    "3",
    "4",
  ]);
});

// A fake `betterleaks` first on PATH, so `scan` runs a known script.
const realPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = realPath;
});
const fakeScanner = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-bl-"));
  fs.writeFileSync(path.join(dir, "betterleaks"), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
  process.env.PATH = `${dir}${path.delimiter}${realPath}`;
};

test("scan gives stdin to the scanner and reads its JSON report", async () => {
  // The report's secret is the whole stdin, so the text must arrive intact.
  fakeScanner(`printf '[{"RuleID":"r","Secret":"%s"},{"Secret":""}]' "$(cat)"`);
  expect(await scan("héllo ✓")).toStrictEqual([
    { rule: "r", secret: "héllo ✓" },
  ]);
});

test("scan gives null when the scanner fails or prints no report", async () => {
  fakeScanner("cat >/dev/null; echo '[]'; exit 1");
  expect(await scan("x")).toBeNull();
  fakeScanner("cat >/dev/null; echo 'not json'");
  expect(await scan("x")).toBeNull();
  fakeScanner("cat >/dev/null; kill -TERM $$");
  expect(await scan("x")).toBeNull();
});

test("scan skips empty text and treats empty output as no findings", async () => {
  fakeScanner("cat >/dev/null");
  expect(await scan("")).toBeNull();
  expect(await scan("x")).toStrictEqual([]);
});
