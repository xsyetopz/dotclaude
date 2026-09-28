// apply-statusline.mjs: previews, installs, and removes the status line in a
// temporary HOME.

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { stubText } from "../../hooks/lib/_status-line.mjs";
import { run, tempHome } from "../support/setup.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("apply-statusline previews, installs the stub, and removes only its own setting", () => {
  const home = tempHome();
  const settings = path.join(home, ".claude", "settings.json");
  const stub = path.join(home, ".claude", "dotclaude", "statusline.mjs");
  fs.writeFileSync(
    settings,
    JSON.stringify({ statusLine: { type: "command", command: "sh ~/x.sh" } }),
  );

  const preview = run("apply-statusline.mjs", home);
  expect(preview).toContain('"sh ~/x.sh" -> ');
  expect(preview).toMatch(/Dry run/);
  expect(read(settings).statusLine.command).toBe("sh ~/x.sh");
  expect(fs.existsSync(stub)).toBe(false);

  run("apply-statusline.mjs", home, "--apply");
  expect(read(settings).statusLine).toEqual({
    type: "command",
    command: `bun ${JSON.stringify(stub)}`,
    padding: 0,
  });
  expect(fs.readFileSync(stub, "utf8")).toBe(stubText());
  expect(
    fs.readdirSync(path.dirname(settings)).some((f) => f.includes("backup")),
  ).toBe(true);
  expect(run("apply-statusline.mjs", home)).toMatch(/Already up to date/);

  run("apply-statusline.mjs", home, "--remove", "--apply");
  expect(read(settings).statusLine).toBeUndefined();
  expect(fs.existsSync(stub)).toBe(false);

  fs.writeFileSync(
    settings,
    JSON.stringify({ statusLine: { type: "command", command: "sh ~/x.sh" } }),
  );
  expect(run("apply-statusline.mjs", home, "--remove", "--apply")).toMatch(
    /not dotclaude's; it stays/,
  );
  expect(read(settings).statusLine.command).toBe("sh ~/x.sh");
});
