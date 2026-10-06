import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  check,
  SECRET_PATTERNS,
} from "../../plugins/dotclaude-modder/um/publish.mjs";

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "um-publish-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function make(dir, files) {
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
}

test("publish check reports each kind of problem", async () => {
  // Fixtures are assembled at run time, so this file does not trip the check.
  const fakeKey = `FAL${"_KEY="}abcdefghijklmnopqrstuvwxyz0123`;
  const ghidraName = `FUN${"_00401000"}`;
  make(path.join(tmp, "mod"), {
    "src/Mod.cs": `int ${ghidraName}();\n// ${"Decompiled with ILSpy"}`,
    "README.md": "My mod, built with dnSpy notes",
    "config.txt": fakeKey,
  });
  make(path.join(tmp, "game"), { "data/big.bin": Buffer.alloc(4096, "x") });
  fs.writeFileSync(
    path.join(tmp, "mod", "copied.bin"),
    Buffer.alloc(4096, "x"),
  );
  const log = spyOn(console, "log").mockImplementation(() => {});
  let code;
  let out;
  try {
    code = await check(path.join(tmp, "mod"), path.join(tmp, "game"));
    out = log.mock.calls.map((c) => c.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
  expect(code).toBe(1);
  expect(out).toContain("game file copied verbatim");
  expect(out).toContain("FAL_KEY assignment");
  expect(out).toContain("Ghidra auto-name");
  expect(out).toContain("decompiler header x1 in src/Mod.cs");
  // A README that only names a decompiler is not code.
  const header = out.split("decompiler header").at(-1).split("\n")[0];
  expect(header).not.toContain("README.md");
});

describe("secret patterns", () => {
  const patterns = Object.fromEntries(SECRET_PATTERNS);
  const body = "Gh1jK2lM3nO4pQ5rS6tU7vW8xY9z0";
  const cases = [
    ["OpenAI key", `sk-${"proj-"}Ab3_dE-f${body.repeat(4)}`],
    ["OpenAI key", `sk-${"svcacct-"}Ab3_dE-f${body.repeat(4)}`],
    ["OpenAI key", `sk-${body.repeat(2)}`],
    [
      "GitHub token",
      `github${"_pat_"}11ABCDEFG0123456789abc_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9rS1t`,
    ],
    ["GitHub token", `gh${"p_"}aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z`],
  ];
  test.each(cases)("catches %s", (label, key) => {
    expect(patterns[label].test(`key = ${key}\n`)).toBe(true);
  });

  test("ignores ordinary text", () => {
    const text =
      "sk-learn-style-kebab-case-identifiers-are-not-keys and github_pat_ alone";
    expect(SECRET_PATTERNS.filter(([, rx]) => rx.test(text))).toEqual([]);
  });
});
