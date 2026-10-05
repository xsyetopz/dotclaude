import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backup,
  KEEP_BACKUPS,
  lspPlugins,
  memoryReport,
} from "../skills/setup/scripts/_files.mjs";

test("a backup keeps the newest backups of its file and deletes the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-"));
  const file = join(dir, "settings.json");
  writeFileSync(file, "{}");
  writeFileSync(join(dir, "CLAUDE.md.dotclaude-backup-2020"), "");
  const made = [];
  for (let day = 1; day <= 5; day++)
    made.push(backup(file, new Date(`2026-01-0${day}T00:00:00Z`)));
  const left = readdirSync(dir).filter((f) => f.includes("dotclaude-backup"));
  expect(left).toHaveLength(KEEP_BACKUPS + 1);
  expect(left).toContain("CLAUDE.md.dotclaude-backup-2020");
  expect(made[4].made).toContain("2026-01-05");
  expect(made[3].deleted).toEqual([made[0].made]);
  rmSync(dir, { recursive: true });
});

test("the memory report names a long MEMORY.md and old files, and deletes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-"));
  const memory = join(dir, "projects", "p", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, "MEMORY.md"), "x\n".repeat(250));
  writeFileSync(join(memory, "new.md"), "x");
  writeFileSync(join(memory, "old.md"), "x");
  const old = new Date(Date.now() - 40 * 86_400_000);
  utimesSync(join(memory, "old.md"), old, old);
  const report = memoryReport(dir).join("\n");
  expect(report).toContain("MEMORY.md: 251 lines");
  expect(report).toContain("old.md: not changed in 40 days");
  expect(report).not.toContain("new.md");
  expect(readdirSync(memory)).toHaveLength(3);
  expect(memoryReport(join(dir, "none"))).toEqual([]);
  rmSync(dir, { recursive: true });
});

test("setup names an LSP plugin for each language server on PATH with no plugin", () => {
  const which = (bin) => ["clangd", "sourcekit-lsp"].includes(bin);
  const installed = { plugins: { "clangd-lsp@claude-plugins-official": [] } };
  expect(lspPlugins(which, installed)).toEqual(["swift-lsp"]);
  expect(lspPlugins(() => false, {})).toEqual([]);
});
