// `git()` and the `git add` binary check against a fake or wrapped io. No
// guarded command runs: the rule engine only reads the command string.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../../hooks/lib/_bash-args.mjs";
import { check } from "../../hooks/lib/_bash-rules.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

const fake = (run) => ({ run });

test("git gives stdout on exit 0 and passes the 1 MiB and time limits", async () => {
  const calls = [];
  const io = fake(async (argv, init) => {
    calls.push({ argv, init });
    return { exitCode: 0, stdout: "out\n", stderr: "" };
  });
  expect(await git(io, "/r", ["status"])).toBe("out\n");
  expect(calls[0].argv).toEqual(["git", "-C", "/r", "status"]);
  expect(calls[0].init.maxBytes).toBe(1048576);
  expect(typeof calls[0].init.timeoutMs).toBe("number");
});

test("git gives undefined on a nonzero exit and on a rejected run", async () => {
  const failed = fake(async () => ({ exitCode: 1, stdout: "x", stderr: "" }));
  expect(await git(failed, "/r", ["status"])).toBeUndefined();
  const rejected = fake(async () => {
    throw new Error("output passed 1048576 bytes");
  });
  expect(await git(rejected, "/r", ["status"])).toBeUndefined();
});

test("git add warns for an ELF the hooks-module io cannot read", async () => {
  const repo = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-gitio-")),
  );
  try {
    execFileSync("git", ["init", "-q", repo]);
    const elf = [0x7f, 0x45, 0x4c, 0x46, 2, 1];
    const big = path.join(repo, "big.elf");
    fs.writeFileSync(big, Buffer.from(elf));
    fs.truncateSync(big, 5 * 1024 * 1024);
    fs.writeFileSync(path.join(repo, "notes.txt"), "text\n");
    fs.writeFileSync(path.join(repo, "small.elf"), Buffer.from(elf));
    const base = nodeIo();
    // The hooks-module io reads the whole file, so `head` rejects over 4 MiB.
    const io = {
      ...base,
      fs: {
        ...base.fs,
        head: async (file, bytes) => {
          if ((await base.fs.stat(file)).size > 4 * 1024 * 1024)
            throw new Error(`${file}: larger than 4 MiB`);
          return base.fs.head(file, bytes);
        },
      },
    };
    const c = { root: repo, cwd: repo, io };
    const warns = async (cmd) =>
      (await check(cmd, c)).some(([l]) => l === "warn");
    expect(await warns("git add big.elf")).toBe(true);
    expect(await warns("git add small.elf")).toBe(true);
    expect(await warns("git add notes.txt")).toBe(false);
    expect(await warns("git add missing.bin")).toBe(false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
