// Runs of `status-line/statusline.mjs` with status JSON on stdin, as Claude Code runs it with `node`.

import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONTEXT_WINDOW,
  USAGE_LEVELS,
} from "../../plugins/dotclaude/lib/budget.mjs";

const SCRIPT = path.join(
  import.meta.dirname,
  "../../plugins/dotclaude/status-line/statusline.mjs",
);
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "dc-status-"));

/** The status line for `input`, a status object or raw text. */
function line(input) {
  const r = Bun.spawnSync([Bun.which("node"), SCRIPT], {
    stdin: Buffer.from(
      typeof input === "string" ? input : JSON.stringify(input),
    ),
    cwd: EMPTY,
  });
  return r.stdout.toString().replace(/\n$/, "");
}
const status = (tokens, extra = {}) => ({
  model: { display_name: "Opus 5.5" },
  context_window: {
    total_input_tokens: tokens,
    context_window_size: 1_000_000,
  },
  workspace: { project_dir: EMPTY },
  ...extra,
});
const at = (pct) => Math.round((CONTEXT_WINDOW * pct) / 100);

test("the context part counts against the dotclaude window, not the model window", () => {
  expect(line(status(at(10)))).toBe(
    `Opus 5.5 · ${Math.round(at(10) / 1000)}k/${CONTEXT_WINDOW / 1000}k 10%`,
  );
  const small = line(
    status(1000, {
      context_window: {
        total_input_tokens: 1000,
        context_window_size: 200_000,
      },
    }),
  );
  expect(small).toContain("1k/200k 1%");
});

test("the context part is yellow and red at the usage levels", () => {
  expect(line(status(at(USAGE_LEVELS[0] - 1)))).not.toContain("\x1b[");
  expect(line(status(at(USAGE_LEVELS[0])))).toContain("\x1b[33m");
  expect(line(status(at(USAGE_LEVELS[1])))).toContain("\x1b[31m");
});

test("the line shows the effort and the 5-hour limit", () => {
  const out = line(
    status(0, {
      effort: { level: "high" },
      rate_limits: { five_hour: { used_percentage: 91.4 } },
    }),
  );
  expect(out).toStartWith("Opus 5.5 high · ");
  expect(out).toEndWith("\x1b[31m5h 91%\x1b[0m");
});

test("the line shows the newest OpenSpec change and its task count, and skips the archive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-status-"));
  const write = (id, text, mtime) => {
    const file = path.join(dir, "openspec/changes", id, "tasks.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, mtime, mtime);
  };
  write("old-change", "- [ ] a\n", 1);
  write("add-login", "## 1\n- [x] a\n- [X] b\n  - [ ] c\n* [ ] d\n- [] e\n", 2);
  write("archive", "- [x] a\n", 3);
  fs.mkdirSync(path.join(dir, "openspec/changes/no-tasks"));
  expect(line(status(0, { workspace: { project_dir: dir } }))).toEndWith(
    " · add-login 2/4",
  );
  fs.rmSync(dir, { recursive: true });
});

test("text that is not JSON prints an empty line, and JSON null prints only the context part", () => {
  expect(line("not json")).toBe("");
  expect(line("null")).toBe(`0k/${CONTEXT_WINDOW / 1000}k 0%`);
});
