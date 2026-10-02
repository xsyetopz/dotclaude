import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

const io = nodeIo();
const bun = (script, init) => io.run(["bun", "-e", script], init);

test("run gives the output and exit code of a command", async () => {
  const result = await bun("console.log('hi'); process.exit(3)");
  expect(result).toEqual({ exitCode: 3, stdout: "hi\n", stderr: "" });
});

test("run rejects when the output passes maxBytes", async () => {
  await expect(
    bun("console.log('x'.repeat(100)); setTimeout(() => {}, 10000)", {
      maxBytes: 10,
    }),
  ).rejects.toThrow("output passed 10 bytes");
});

test("run rejects when the command passes the timeout", async () => {
  await expect(
    bun("setTimeout(() => {}, 10000)", { timeoutMs: 200 }),
  ).rejects.toThrow("timed out");
});

test("run stops a command that ignores SIGTERM", async () => {
  const start = Date.now();
  await expect(
    bun("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", {
      timeoutMs: 300,
    }),
  ).rejects.toThrow("timed out");
  expect(Date.now() - start).toBeLessThan(3000);
});

test("a failed write leaves no temporary file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-write-"));
  try {
    // A folder with a file in it cannot be replaced, so the rename fails.
    fs.mkdirSync(path.join(dir, "target"));
    fs.writeFileSync(path.join(dir, "target", "x"), "");
    await expect(io.fs.write(path.join(dir, "target"), "y")).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual(["target"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
