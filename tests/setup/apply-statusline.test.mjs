// apply-statusline.mjs: previews, installs, and removes the status line in a
// temporary HOME.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { stubText } from "../../hooks/lib/_status-line.mjs";
import { run, tempHome } from "../support/setup.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const backups = (settings) =>
  fs
    .readdirSync(path.dirname(settings))
    .filter((f) => f.startsWith("settings.json.dotclaude-backup-"));

test("apply-statusline previews, installs the stub, and removes only its own setting", () => {
  const home = tempHome();
  const settings = path.join(home, ".claude", "settings.json");
  const stub = path.join(home, ".claude", "dotclaude", "statusline.mjs");
  fs.writeFileSync(
    settings,
    JSON.stringify({ statusLine: { type: "command", command: "sh ~/x.sh" } }),
  );

  const original = fs.readFileSync(settings, "utf8");
  const preview = run("apply-statusline.mjs", home);
  expect(preview).toContain('"sh ~/x.sh" -> ');
  expect(fs.readFileSync(settings, "utf8")).toBe(original);
  expect(backups(settings)).toStrictEqual([]);
  expect(fs.existsSync(stub)).toBe(false);

  run("apply-statusline.mjs", home, "--apply");
  expect(read(settings).statusLine).toEqual({
    type: "command",
    command: `bun ${JSON.stringify(stub)}`,
    padding: 0,
  });
  expect(fs.readFileSync(stub, "utf8")).toBe(stubText());
  expect(backups(settings).length).toBe(1);
  // A second --apply with nothing to change writes nothing and makes no backup.
  const installed = fs.readFileSync(settings, "utf8");
  run("apply-statusline.mjs", home, "--apply");
  expect(fs.readFileSync(settings, "utf8")).toBe(installed);
  expect(backups(settings).length).toBe(1);

  run("apply-statusline.mjs", home, "--remove", "--apply");
  expect(read(settings).statusLine).toBeUndefined();
  expect(fs.existsSync(stub)).toBe(false);

  fs.writeFileSync(settings, original);
  const count = backups(settings).length;
  run("apply-statusline.mjs", home, "--remove", "--apply");
  expect(fs.readFileSync(settings, "utf8")).toBe(original);
  expect(backups(settings).length).toBe(count);
});
