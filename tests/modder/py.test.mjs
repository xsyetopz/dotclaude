// Runs the pytest cases of the Python groups in `tests/modder/py/`.
// `uv` supplies pytest, Pillow, and numpy, so the test skips without `uv`.

import { expect, test } from "bun:test";
import path from "node:path";

test.skipIf(!Bun.which("uv"))(
  "python group pytest cases pass",
  async () => {
    const proc = Bun.spawn(
      [
        "uv",
        "run",
        "--with",
        "pytest",
        "--with",
        "pillow",
        "--with",
        "numpy",
        "pytest",
        "-q",
        path.join(import.meta.dir, "py"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) console.error(out, err);
    expect(code).toBe(0);
  },
  120_000,
);
