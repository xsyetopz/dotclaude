// Preloaded by bunfig.toml before any test file. Every temporary folder the
// tests or the hooks they spawn create goes under one folder per run, removed
// at exit, so repeated runs leave nothing behind in the system temp folder.

import { afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-tests-"));
process.env.TMPDIR = root;
// The AI policy check must not reach the network from a test.
process.env.DOTCLAUDE_OFFLINE = "1";
// A preloaded afterAll runs once, after every test file.
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
